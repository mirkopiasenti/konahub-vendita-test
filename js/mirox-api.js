/**
 * Mirox API client — wrapper attorno a fetch che inietta il JWT Supabase
 * nell'header Authorization. Da usare per TUTTE le chiamate alle Netlify
 * functions Mirox dopo l'hardening Fase B (le functions ora richiedono auth).
 *
 * Uso:
 *   const res = await MiroxApi.fetch('/.netlify/functions/admin-vendita-config', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ action: 'list' })
 *   });
 *
 * Per upload multipart (FormData):
 *   const res = await MiroxApi.fetch(url, { method: 'POST', body: formData });
 *   // NON settare Content-Type manualmente, il browser lo aggiunge con boundary
 *
 * Espone anche:
 *   MiroxApi.getAccessToken() -> string|null   (JWT della sessione corrente)
 *   MiroxApi.headers()        -> object        (headers da fondere col fetch tuo)
 */
(function (root) {
    'use strict';
    if (root.MiroxApi) return;

    // Memoizza il JWT per evitare di chiamare getSession() ad ogni fetch.
    // TTL breve: il token Supabase dura un'ora ma vogliamo limitare lo stale
    // post-logout. 30s e' un buon compromesso (i refresh sono comunque async
    // gestiti da supabase-js, qui leggiamo l'access_token corrente).
    let _tokenCache = { value: null, expires: 0 };
    const TOKEN_TTL_MS = 30 * 1000;

    // Quando l'auth state cambia (login, logout, refresh), invalida la cache
    function bindAuthListener() {
        try {
            const client = root.db;
            if (!client || !client.auth || typeof client.auth.onAuthStateChange !== 'function') return;
            client.auth.onAuthStateChange((_event, session) => {
                _tokenCache = {
                    value: session?.access_token || null,
                    expires: session?.access_token ? Date.now() + TOKEN_TTL_MS : 0
                };
            });
        } catch (_) { /* ignore */ }
    }
    // Bind appena db e' disponibile (può capitare dopo che mirox-api e' valutato)
    if (root.db && root.db.auth) bindAuthListener();
    else if (root.addEventListener) root.addEventListener('DOMContentLoaded', bindAuthListener, { once: true });

    async function getAccessToken() {
        const now = Date.now();
        if (_tokenCache.value && now < _tokenCache.expires) return _tokenCache.value;
        const client = root.db;
        if (!client || !client.auth) return null;
        try {
            const { data } = await client.auth.getSession();
            const tok = data?.session?.access_token || null;
            _tokenCache = { value: tok, expires: tok ? now + TOKEN_TTL_MS : 0 };
            return tok;
        } catch (e) {
            console.warn('[MiroxApi] getSession error', e?.message || e);
            return null;
        }
    }

    async function headers(extra = {}) {
        const token = await getAccessToken();
        const h = { ...(extra || {}) };
        if (token) h['Authorization'] = 'Bearer ' + token;
        return h;
    }

    async function authFetch(url, opts = {}) {
        const merged = { ...opts };
        merged.headers = await headers(opts.headers || {});
        return fetch(url, merged);
    }

    root.MiroxApi = {
        fetch: authFetch,
        getAccessToken: getAccessToken,
        headers: headers
    };
})(window);
