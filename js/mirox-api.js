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

    async function getAccessToken() {
        const client = root.db;
        if (!client || !client.auth) return null;
        try {
            const { data } = await client.auth.getSession();
            return data?.session?.access_token || null;
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
