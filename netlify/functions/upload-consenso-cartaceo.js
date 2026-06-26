/**
 * POST /.netlify/functions/upload-consenso-cartaceo
 *
 * Multipart form-data:
 *   - file: PDF scansione del modulo firmato a mano (max 20 MB, application/pdf)
 *   - anagrafica_id: uuid
 *   - consenso_marketing: 'true' | 'false'
 *   - pratica_id: uuid (opzionale, riferimento di origine)
 *
 * Logica:
 *  1) Valida campi + file
 *  2) Carica scansione su bucket consensi-privacy
 *  3) Crea record vendita_consensi_privacy con stato='confermato',
 *     modalita='cartaceo', valido_fino_al = now()+48mo
 *
 * Response 200:
 *   {
 *     success: true,
 *     consenso_id,
 *     pdf_storage_path,
 *     pdf_filename,
 *     valido_fino_al
 *   }
 *
 * Auth: Bearer obbligatorio.
 */

const Busboy = require('busboy');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { requireAuth } = require('./_lib/require-auth');
const { INFORMATIVA_VERSIONE } = require('./_lib/pdf-consenso');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
const VALIDITA_MESI = 48;
const BUCKET_CONSENSI = 'consensi-privacy';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

function response(statusCode, payload) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function sanitizeSegment(value, fallback = 'cliente') {
    const normalized = String(value || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized || fallback;
}

function formatDateDdMmYyyy(d = new Date()) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    return `${dd}_${mm}_${yyyy}`;
}

function addMonthsClamped(date, months) {
    const d = new Date(date.getTime());
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day) d.setDate(0);
    return d;
}

function getClientIp(event) {
    const h = event.headers || {};
    return (
        h['x-nf-client-connection-ip']
        || (h['x-forwarded-for'] || '').split(',')[0].trim()
        || h['client-ip']
        || null
    );
}

function parseMultipart(event) {
    return new Promise((resolve, reject) => {
        const headers = event.headers || {};
        const contentType = headers['content-type'] || headers['Content-Type'] || '';
        if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
            return reject(new Error('Content-Type non valido: usare multipart/form-data'));
        }

        const bb = Busboy({ headers: { 'content-type': contentType }, limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
        const fields = {};
        const fileBuf = { name: null, mime: null, chunks: [], truncated: false, size: 0 };

        bb.on('field', (name, value) => { fields[name] = value; });
        bb.on('file', (name, file, info) => {
            fileBuf.name = info.filename;
            fileBuf.mime = info.mimeType || info.mime || 'application/octet-stream';
            file.on('data', (d) => { fileBuf.chunks.push(d); fileBuf.size += d.length; });
            file.on('limit', () => { fileBuf.truncated = true; });
            file.on('end', () => { /* nothing */ });
        });
        bb.on('error', reject);
        bb.on('finish', () => {
            if (fileBuf.truncated) return reject(new Error(`File troppo grande (max ${MAX_FILE_BYTES / 1024 / 1024} MB)`));
            const buffer = fileBuf.chunks.length ? Buffer.concat(fileBuf.chunks) : null;
            resolve({ fields, file: buffer ? { name: fileBuf.name, mime: fileBuf.mime, buffer, size: buffer.length } : null });
        });

        const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body || '', 'utf8');
        bb.end(body);
    });
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return response(405, { success: false, error: 'Metodo non consentito: usa POST' });
    }

    const auth = await requireAuth(event);
    if (!auth.ok) return response(auth.status, { success: false, error: auth.error });
    const operatoreId = auth.user?.id || null;

    let parsed;
    try { parsed = await parseMultipart(event); }
    catch (e) { return response(400, { success: false, error: e.message || 'Errore parsing multipart' }); }

    const fields = parsed.fields || {};
    const file = parsed.file;
    if (!file) {
        return response(400, { success: false, error: 'File scansione mancante (campo "file")' });
    }
    if (file.mime !== 'application/pdf') {
        return response(400, { success: false, error: 'Tipo file non valido: solo application/pdf' });
    }

    const anagraficaId = String(fields.anagrafica_id || '').trim().toLowerCase();
    if (!anagraficaId || !UUID_REGEX.test(anagraficaId)) {
        return response(400, { success: false, error: 'anagrafica_id mancante o non valido' });
    }
    const consensoMarketing = ['1', 'true', 'yes', 'si'].includes(String(fields.consenso_marketing || '').toLowerCase());
    const praticaId = (fields.pratica_id && UUID_REGEX.test(String(fields.pratica_id))) ? String(fields.pratica_id).toLowerCase() : null;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE) {
        return response(500, { success: false, error: 'Configurazione server incompleta' });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    let uploadedPath = null;

    try {
        const { data: anagrafica, error: anagraficaErr } = await supabase
            .from('anagrafica')
            .select('id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, email, provincia, comune, via, civico')
            .eq('id', anagraficaId)
            .maybeSingle();
        if (anagraficaErr) {
            return response(500, { success: false, error: 'Errore lettura anagrafica: ' + anagraficaErr.message });
        }
        if (!anagrafica) {
            return response(404, { success: false, error: 'Anagrafica non trovata' });
        }

        // 2) Naming + upload
        const ora = new Date();
        const ragSocSafe = sanitizeSegment(anagrafica.ragione_sociale, 'cliente').toUpperCase().slice(0, 60);
        const cfPiva = sanitizeSegment(anagrafica.cf_piva, 'cf').toUpperCase();
        const dataPart = formatDateDdMmYyyy(ora);
        const baseFileName = `Privacy_${ragSocSafe}_${cfPiva}_${dataPart}.pdf`;
        const year = String(ora.getFullYear());
        const month = String(ora.getMonth() + 1).padStart(2, '0');
        let attemptFileName = baseFileName;
        let attemptPath = `${year}/${month}/${attemptFileName}`;
        let uploaded = false;
        let lastUploadError = null;

        for (let attempt = 0; attempt < 3 && !uploaded; attempt += 1) {
            const { error: uploadErr } = await supabase.storage
                .from(BUCKET_CONSENSI)
                .upload(attemptPath, file.buffer, {
                    contentType: 'application/pdf',
                    upsert: false
                });
            if (!uploadErr) { uploaded = true; uploadedPath = attemptPath; break; }
            lastUploadError = uploadErr;
            const isConflict = /exist|duplicate|already|409/i.test(String(uploadErr.message || ''));
            if (!isConflict) break;
            const suffix = crypto.randomBytes(3).toString('hex');
            attemptFileName = baseFileName.replace(/\.pdf$/i, '') + '_' + suffix + '.pdf';
            attemptPath = `${year}/${month}/${attemptFileName}`;
        }
        if (!uploaded) {
            return response(500, { success: false, error: 'Errore upload PDF scansione: ' + (lastUploadError?.message || 'sconosciuto') });
        }

        const informativaHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
        const validoFinoAl = addMonthsClamped(ora, VALIDITA_MESI);

        const snapshotAnagrafica = {
            cf_piva: anagrafica.cf_piva,
            cluster: anagrafica.cluster,
            ragione_sociale: anagrafica.ragione_sociale,
            nome_referente: anagrafica.nome_referente,
            cellulare: anagrafica.cellulare,
            email: anagrafica.email,
            provincia: anagrafica.provincia,
            comune: anagrafica.comune,
            via: anagrafica.via,
            civico: anagrafica.civico
        };

        // 3) INSERT record confermato
        const { data: inserted, error: insertErr } = await supabase
            .from('vendita_consensi_privacy')
            .insert({
                anagrafica_id: anagraficaId,
                pratica_id: praticaId,
                modalita: 'cartaceo',
                cellulare_usato: null,
                stato: 'confermato',
                informativa_versione: INFORMATIVA_VERSIONE,
                informativa_hash: informativaHash,
                consenso_contratto: true,
                consenso_marketing: consensoMarketing,
                valido_fino_al: validoFinoAl.toISOString(),
                pdf_storage_path: attemptPath,
                pdf_filename: attemptFileName,
                operatore_id: operatoreId,
                ip_operatore: getClientIp(event),
                user_agent_operatore: (event.headers?.['user-agent'] || '').slice(0, 500) || null,
                snapshot_anagrafica: snapshotAnagrafica
            })
            .select('id, valido_fino_al')
            .single();
        if (insertErr) {
            // Cleanup file
            await supabase.storage.from(BUCKET_CONSENSI).remove([attemptPath]).catch(() => {});
            return response(500, { success: false, error: 'Errore creazione record consenso: ' + insertErr.message });
        }

        return response(200, {
            success: true,
            consenso_id: inserted.id,
            pdf_storage_path: attemptPath,
            pdf_filename: attemptFileName,
            valido_fino_al: inserted.valido_fino_al,
            informativa_versione: INFORMATIVA_VERSIONE
        });
    } catch (e) {
        if (uploadedPath) {
            try { await supabase.storage.from(BUCKET_CONSENSI).remove([uploadedPath]); } catch (_) { /* ignore */ }
        }
        return response(500, { success: false, error: 'Errore inatteso: ' + (e?.message || String(e)) });
    }
};
