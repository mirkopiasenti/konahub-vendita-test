/**
 * GET /.netlify/functions/genera-pdf-consenso-cartaceo
 *   ?anagrafica_id=<uuid>
 *   &consenso_marketing=true|false   (default false)
 *
 * Genera al volo il PDF dell'informativa privacy in modalita' "cartacea"
 * (riquadro firma vuoto, da firmare a mano dal cliente). Il client lo
 * scarica, lo stampa, lo fa firmare, poi lo ricarica via
 * upload-consenso-cartaceo.
 *
 * Risposta: PDF binary (Content-Type: application/pdf,
 * Content-Disposition: attachment).
 *
 * Auth: Bearer obbligatorio.
 */

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_lib/require-auth');
const { generateConsensoPdf } = require('./_lib/pdf-consenso');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

function jsonResponse(statusCode, payload) {
    return {
        statusCode,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    };
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

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return jsonResponse(405, { success: false, error: 'Metodo non consentito: usa GET' });
    }

    const auth = await requireAuth(event);
    if (!auth.ok) return jsonResponse(auth.status, { success: false, error: auth.error });

    const qs = event.queryStringParameters || {};
    const anagraficaId = String(qs.anagrafica_id || '').trim().toLowerCase();
    if (!anagraficaId || !UUID_REGEX.test(anagraficaId)) {
        return jsonResponse(400, { success: false, error: 'anagrafica_id mancante o non valido' });
    }
    const consensoMarketing = ['1', 'true', 'yes', 'si'].includes(String(qs.consenso_marketing || '').toLowerCase());

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE) {
        return jsonResponse(500, { success: false, error: 'Configurazione server incompleta' });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    try {
        const { data: anagrafica, error: anagraficaErr } = await supabase
            .from('anagrafica')
            .select('id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, email, provincia, comune, via, civico')
            .eq('id', anagraficaId)
            .maybeSingle();
        if (anagraficaErr) {
            return jsonResponse(500, { success: false, error: 'Errore lettura anagrafica: ' + anagraficaErr.message });
        }
        if (!anagrafica) {
            return jsonResponse(404, { success: false, error: 'Anagrafica non trovata' });
        }

        const { buffer } = await generateConsensoPdf({
            modalita: 'cartaceo',
            anagrafica,
            consensoContratto: true,
            consensoMarketing,
            dataCompilazione: new Date().toISOString()
        });

        const ragSocSafe = sanitizeSegment(anagrafica.ragione_sociale, 'cliente').toUpperCase().slice(0, 60);
        const cfPiva = sanitizeSegment(anagrafica.cf_piva, 'cf').toUpperCase();
        const dataPart = formatDateDdMmYyyy(new Date());
        const fileName = `Privacy_${ragSocSafe}_${cfPiva}_${dataPart}.pdf`;

        return {
            statusCode: 200,
            headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${fileName}"`,
                'Cache-Control': 'no-store'
            },
            body: buffer.toString('base64'),
            isBase64Encoded: true
        };
    } catch (e) {
        return jsonResponse(500, { success: false, error: 'Errore generazione PDF: ' + (e?.message || String(e)) });
    }
};
