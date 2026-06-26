/**
 * POST /.netlify/functions/garantisci-anagrafica
 *
 * Trova o crea un'anagrafica a partire dai dati cliente passati nel body.
 * Usata dal wizard upload-contratti-vendita PRIMA della raccolta consenso
 * privacy: il consenso ha bisogno di anagrafica_id valido, quindi se il
 * cliente e' nuovo va creato qui.
 *
 * La logica e' la stessa di crea-vendita-pratica-carrello (lookup per
 * cf_piva, se esiste aggiorna campi vuoti / cambiati, se non esiste insert).
 *
 * Body JSON:
 *   {
 *     cliente: {
 *       cf_piva, cluster, ragione_sociale, nome_referente,
 *       cellulare, email, provincia, comune, via, civico
 *     }
 *   }
 *
 * Response 200:
 *   {
 *     success: true,
 *     anagrafica_id: uuid,
 *     created: bool          // true se appena creata, false se aggiornata
 *   }
 *
 * Auth: Bearer obbligatorio.
 */

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_lib/require-auth');

const CLUSTER_AMMESSI = new Set(['Consumer', 'Business', 'Turista']);

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

function response(statusCode, payload) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function cleanString(value) {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
}

function normalizeCfPiva(value) {
    return String(value || '').trim().toUpperCase();
}

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

function normalizeCluster(value) {
    const raw = cleanString(value);
    if (!raw) throw new Error('cluster mancante');
    const normalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    if (!CLUSTER_AMMESSI.has(normalized)) throw new Error('cluster non valido (Consumer/Business/Turista)');
    return normalized;
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

    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch (_) { return response(400, { success: false, error: 'JSON non valido' }); }

    const cliente = payload.cliente || {};

    const cfPiva = normalizeCfPiva(cliente.cf_piva);
    const ragioneSociale = cleanString(cliente.ragione_sociale);
    const nomeReferente = cleanString(cliente.nome_referente);
    const cellulare = cleanString(cliente.cellulare);
    const email = cleanString(cliente.email);
    const provincia = cleanString(cliente.provincia);
    const comune = cleanString(cliente.comune);
    const via = cleanString(cliente.via);
    const civico = cleanString(cliente.civico);

    let cluster;
    try { cluster = normalizeCluster(cliente.cluster); }
    catch (e) { return response(400, { success: false, error: e.message }); }

    if (!cfPiva) return response(400, { success: false, error: 'cf_piva mancante' });
    if (!ragioneSociale) return response(400, { success: false, error: 'ragione_sociale mancante' });
    if (!cellulare) return response(400, { success: false, error: 'cellulare mancante' });
    if (!email) return response(400, { success: false, error: 'email mancante' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response(400, { success: false, error: 'email non valida' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE) {
        return response(500, { success: false, error: 'Configurazione server incompleta' });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    try {
        const { data: rows, error: lookupError } = await supabase
            .from('anagrafica')
            .select('id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, email, provincia, comune, via, civico')
            .ilike('cf_piva', cfPiva)
            .limit(1);
        if (lookupError) {
            return response(500, { success: false, error: 'Errore ricerca anagrafica: ' + lookupError.message });
        }
        const esistente = Array.isArray(rows) ? rows[0] || null : null;

        if (esistente) {
            const updates = {};
            const candidates = {
                cluster, ragione_sociale: ragioneSociale, nome_referente: nomeReferente,
                cellulare, email, provincia, comune, via, civico
            };
            if (cleanString(esistente.cf_piva) !== cfPiva) updates.cf_piva = cfPiva;
            Object.entries(candidates).forEach(([col, v]) => {
                if (isBlank(v)) return;
                const cur = esistente[col];
                if (isBlank(cur) || String(cur).trim() !== String(v).trim()) updates[col] = v;
            });

            if (Object.keys(updates).length > 0) {
                const { error: updErr } = await supabase
                    .from('anagrafica')
                    .update(updates)
                    .eq('id', esistente.id);
                if (updErr) return response(500, { success: false, error: 'Errore update anagrafica: ' + updErr.message });
            }
            return response(200, { success: true, anagrafica_id: esistente.id, created: false });
        }

        const { data: nuova, error: insertErr } = await supabase
            .from('anagrafica')
            .insert({
                cf_piva: cfPiva,
                cluster,
                ragione_sociale: ragioneSociale,
                nome_referente: nomeReferente,
                cellulare,
                email,
                provincia,
                comune,
                via,
                civico
            })
            .select('id')
            .single();
        if (insertErr) {
            return response(500, { success: false, error: 'Errore creazione anagrafica: ' + insertErr.message });
        }
        return response(200, { success: true, anagrafica_id: nuova.id, created: true });
    } catch (e) {
        return response(500, { success: false, error: 'Errore inatteso: ' + (e?.message || String(e)) });
    }
};
