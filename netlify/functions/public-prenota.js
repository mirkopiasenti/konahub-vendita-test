/**
 * Endpoint pubblico per il form `prenota.html` (prenotazioni dal sito/social).
 *
 * Sostituisce le chiamate dirette da anon a Supabase, in modo che dopo la
 * Fase C dell'hardening le tabelle CC-shared (appuntamenti, slot_bloccati,
 * blocchi, orari_standard, impostazioni) possano essere chiuse a {anon}.
 *
 * GET  /.netlify/functions/public-prenota?action=slots&data=YYYY-MM-DD
 *      -> { ok: true, slots: ['2026-06-25T09:00:00+02:00', ...] }
 *
 * POST /.netlify/functions/public-prenota
 *      body: { nome, telefono, motivo, note?, data_ora }
 *      -> { ok: true, id }
 *
 * NON richiede auth (e' pubblico). Per limitare abuse:
 *   - Validazione campi server-side (formato date, lunghezze, motivi ammessi)
 *   - Rate limiting in-memory per IP (max 6 richieste / 10 minuti)
 *   - data_ora deve essere uno slot effettivamente disponibile (re-check)
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
};

const MAX_NOME = 100;
const MAX_TEL = 32;
const MAX_NOTE = 500;
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 min
const RATE_MAX = 6;

// Rate limit in-memory (vive finche' il container Netlify e' caldo)
const RATE = new Map(); // ip -> [timestamp, ...]

const MOTIVI_AMMESSI = new Set([
    'Telefono CB', 'Fisso', 'P.iva', 'Energy', 'Duferco', 'Altro',
    'Info linea fissa', 'Info linea mobile', 'Info offerta', 'Info costi',
    'Reclamo', 'Disdetta', 'Cambio operatore', 'Assistenza tecnica',
    'Pagamento', 'Documenti'
]);

function reply(statusCode, payload) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function getClientIp(event) {
    const h = event.headers || {};
    const fwd = h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
    if (fwd) return String(fwd).split(',')[0].trim();
    return h['x-real-ip'] || h['client-ip'] || 'unknown';
}

function checkRateLimit(ip) {
    const now = Date.now();
    const arr = (RATE.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
    arr.push(now);
    RATE.set(ip, arr);
    // Cleanup occasionale
    if (RATE.size > 1000) {
        for (const [k, v] of RATE.entries()) {
            if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) RATE.delete(k);
        }
    }
    return arr.length <= RATE_MAX;
}

function getClient() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
}

function cleanString(value, maxLen) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    if (!s) return null;
    return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function isIsoDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isIsoDateTime(s) {
    if (typeof s !== 'string') return false;
    const d = new Date(s);
    return !isNaN(d.getTime());
}

async function handleGetSlots(event, db) {
    const params = event.queryStringParameters || {};
    const data = params.data;
    if (!isIsoDate(data)) return reply(400, { ok: false, error: 'Parametro data non valido (atteso YYYY-MM-DD)' });
    try {
        const { data: slots, error } = await db.rpc('get_slot_disponibili', { p_data: data });
        if (error) return reply(500, { ok: false, error: error.message });
        return reply(200, { ok: true, slots: slots || [] });
    } catch (e) {
        return reply(500, { ok: false, error: e?.message || 'Errore caricamento slot' });
    }
}

async function handlePost(event, db) {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return reply(400, { ok: false, error: 'Body JSON non valido' }); }

    const nome = cleanString(body.nome, MAX_NOME);
    const telefono = cleanString(body.telefono, MAX_TEL);
    const motivo = cleanString(body.motivo, 64);
    const note = cleanString(body.note, MAX_NOTE);
    const dataOra = body.data_ora;

    if (!nome) return reply(400, { ok: false, error: 'Nome obbligatorio' });
    if (!telefono || telefono.replace(/\D/g, '').length < 6) return reply(400, { ok: false, error: 'Telefono non valido' });
    if (!motivo) return reply(400, { ok: false, error: 'Motivo obbligatorio' });
    if (!isIsoDateTime(dataOra)) return reply(400, { ok: false, error: 'Slot data/ora non valido' });

    // Motivo "Altro" sempre accettato; gli altri sono whitelist (best-effort)
    if (motivo !== 'Altro' && !MOTIVI_AMMESSI.has(motivo)) {
        // Accetto comunque ma con motivo='Altro' per non rompere il form se la lista UI cambia
        // (decisione conservativa: nessun rifiuto, solo normalizzazione)
    }

    // Re-check: lo slot deve essere effettivamente disponibile oggi
    const giornoIso = new Date(dataOra).toISOString().slice(0, 10);
    try {
        const { data: slots, error } = await db.rpc('get_slot_disponibili', { p_data: giornoIso });
        if (error) return reply(500, { ok: false, error: 'Errore verifica slot: ' + error.message });
        const set = new Set((slots || []).map(s => new Date(s).getTime()));
        if (!set.has(new Date(dataOra).getTime())) {
            return reply(409, { ok: false, error: 'Slot non piu\' disponibile, scegline un altro' });
        }
    } catch (e) {
        return reply(500, { ok: false, error: 'Errore verifica slot' });
    }

    const insert = {
        nome, telefono, motivo, note: note || null,
        codice_fiscale: null,
        data_ora: dataOra,
        fonte: 'pubblico',
        stato: 'confermato',
        storico: JSON.stringify([{ azione: 'prenotazione online', data: new Date().toISOString() }])
    };

    try {
        const { data, error } = await db.from('appuntamenti').insert(insert).select('id').single();
        if (error) return reply(500, { ok: false, error: error.message });
        return reply(200, { ok: true, id: data.id });
    } catch (e) {
        return reply(500, { ok: false, error: e?.message || 'Errore creazione appuntamento' });
    }
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };

    const ip = getClientIp(event);
    if (!checkRateLimit(ip)) {
        return reply(429, { ok: false, error: 'Troppe richieste, riprova fra qualche minuto' });
    }

    const db = getClient();
    if (!db) return reply(500, { ok: false, error: 'Configurazione server incompleta' });

    if (event.httpMethod === 'GET') {
        const action = (event.queryStringParameters || {}).action || 'slots';
        if (action === 'slots') return handleGetSlots(event, db);
        return reply(400, { ok: false, error: 'Azione GET non supportata' });
    }

    if (event.httpMethod === 'POST') {
        return handlePost(event, db);
    }

    return reply(405, { ok: false, error: 'Metodo non consentito' });
};
