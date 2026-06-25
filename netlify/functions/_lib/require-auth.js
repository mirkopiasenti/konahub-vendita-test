/**
 * Helper di autenticazione per Netlify functions.
 *
 * Le functions Mirox usano SUPABASE_SERVICE_ROLE_KEY e bypassano le RLS,
 * quindi DEVONO validare loro stesse l'identità di chi le chiama. Senza
 * questo controllo chiunque conosca l'URL della function può invocarla
 * (data manipulation, cost burn, spam mail).
 *
 * Uso tipico:
 *
 *   const { requireAuth, jsonError } = require('./_lib/require-auth');
 *
 *   exports.handler = async (event) => {
 *     const auth = await requireAuth(event);
 *     if (!auth.ok) return jsonError(auth.status, auth.error);
 *     const { user, profilo } = auth;
 *     // ... business logic
 *   };
 *
 * Per richiedere ruolo admin:
 *   const auth = await requireAuth(event, { adminOnly: true });
 *
 * Per accettare anche OPTIONS preflight CORS:
 *   if (event.httpMethod === 'OPTIONS') return jsonOk(200, '', corsHeaders);
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Client singleton riusato finche' il container Netlify e' caldo
let _adminClient = null;
function getAdminClient() {
    if (_adminClient) return _adminClient;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
    _adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    return _adminClient;
}

// Cache token -> {user, profilo, expires} per evitare 2 round-trip a Supabase
// (getUser + lookup profili) ad ogni invocazione. TTL breve per limitare il
// rischio di servire profili stale dopo logout/disable.
const PROFILO_TTL_MS = 60 * 1000; // 60s
const PROFILO_CACHE = new Map(); // token -> { user, profilo, expires }

function cacheGet(token) {
    const entry = PROFILO_CACHE.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
        PROFILO_CACHE.delete(token);
        return null;
    }
    return entry;
}

function cacheSet(token, user, profilo) {
    PROFILO_CACHE.set(token, { user, profilo, expires: Date.now() + PROFILO_TTL_MS });
    // Cleanup periodico per evitare crescita illimitata
    if (PROFILO_CACHE.size > 500) {
        const now = Date.now();
        for (const [k, v] of PROFILO_CACHE.entries()) {
            if (now > v.expires) PROFILO_CACHE.delete(k);
        }
    }
}

function getBearer(event) {
    const h = (event.headers || {});
    // Netlify normalizza header in lowercase ma alcuni proxy mantengono case
    const raw = h.authorization || h.Authorization || '';
    if (!raw) return null;
    const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
    return m ? m[1].trim() : null;
}

/**
 * Valida il JWT Supabase passato in Authorization e ritorna il profilo Mirox.
 *
 * @param {object} event - Netlify event
 * @param {object} [opts]
 * @param {boolean} [opts.adminOnly=false] - se true, richiede profilo.ruolo='admin'
 * @returns {Promise<{ok: true, user, profilo} | {ok: false, status, error}>}
 */
async function requireAuth(event, opts = {}) {
    const admin = getAdminClient();
    if (!admin) {
        return { ok: false, status: 500, error: 'Configurazione server incompleta (SUPABASE_URL/SERVICE_ROLE_KEY mancanti)' };
    }

    const token = getBearer(event);
    if (!token) {
        return { ok: false, status: 401, error: 'Manca header Authorization Bearer' };
    }

    // Cache hit: salta i 2 round-trip Supabase
    const cached = cacheGet(token);
    if (cached) {
        if (cached.profilo.attivo === false) {
            return { ok: false, status: 403, error: 'Account disabilitato' };
        }
        if (opts.adminOnly && cached.profilo.ruolo !== 'admin') {
            return { ok: false, status: 403, error: 'Operazione riservata agli amministratori' };
        }
        return { ok: true, user: cached.user, profilo: cached.profilo };
    }

    let user;
    try {
        const { data, error } = await admin.auth.getUser(token);
        if (error || !data?.user) {
            return { ok: false, status: 401, error: 'Token non valido o sessione scaduta' };
        }
        user = data.user;
    } catch (e) {
        return { ok: false, status: 401, error: 'Errore validazione token: ' + (e?.message || String(e)) };
    }

    // Carica profilo per controlli aggiuntivi (attivo, ruolo)
    let profilo = null;
    try {
        const { data, error } = await admin.from('profili').select('*').eq('id', user.id).single();
        if (error || !data) {
            return { ok: false, status: 403, error: 'Profilo non trovato' };
        }
        profilo = data;
    } catch (e) {
        return { ok: false, status: 500, error: 'Errore lettura profilo: ' + (e?.message || String(e)) };
    }

    cacheSet(token, user, profilo);

    if (profilo.attivo === false) {
        return { ok: false, status: 403, error: 'Account disabilitato' };
    }

    if (opts.adminOnly && profilo.ruolo !== 'admin') {
        return { ok: false, status: 403, error: 'Operazione riservata agli amministratori' };
    }

    return { ok: true, user, profilo };
}

function jsonError(statusCode, message, extraHeaders = {}) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            ...extraHeaders
        },
        body: JSON.stringify({ ok: false, error: message })
    };
}

module.exports = { requireAuth, jsonError, getBearer, getAdminClient };
