/**
 * Mirox API client — wrapper attorno a fetch che inietta il JWT Supabase
 * nell'header Authorization e gestisce automaticamente il refresh della
 * sessione. Da usare per TUTTE le chiamate alle Netlify functions Mirox.
 *
 * Comportamento:
 *   - Prima di ogni fetch legge il token corrente. Se vicino a scadenza
 *     (< 60s) forza `db.auth.refreshSession()` in modo trasparente.
 *   - Se la function risponde 401, tenta un refresh e riprova la richiesta
 *     UNA sola volta. All'utente non arriva mai un errore "sessione scaduta"
 *     nella casistica normale.
 *   - Se anche il refresh fallisce (refresh_token davvero morto), mostra un
 *     toast e redireziona a index.html per un login pulito.
 *   - Refresh proattivo anche quando la tab torna visibile (`visibilitychange`,
 *     `pageshow`) e via heartbeat ogni 5 min: gestisce il caso "PC in sleep
 *     tutta la notte" o "tab in background per ore" in cui il timer interno
 *     di supabase-js viene throttled dal browser.
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
 *   MiroxApi.refreshSession() -> string|null   (forza un refresh e ritorna il nuovo JWT)
 */
(function (root) {
    'use strict';
    if (root.MiroxApi) return;

    // Cache del token per evitare N getSession() in un ciclo di render.
    // Include la scadenza (parsata dal JWT) e il timestamp del caching.
    let _tokenCache = { value: null, exp: 0, cachedAt: 0 };
    const TOKEN_TTL_MS = 30 * 1000;

    // Se al token restano meno di 60s, forza un refresh preventivo.
    // 60s è ampio abbastanza da coprire la latenza dell'upload + la validazione
    // server-side, evitando 401 sul boundary temporale.
    const REFRESH_MARGIN_MS = 60 * 1000;

    // Anti thundering-herd: se più fetch scattano in parallelo tutte con
    // token scaduto, un solo refresh viene fatto e le altre lo aspettano.
    let _refreshInFlight = null;

    // Anti doppio-redirect quando più fetch in parallelo falliscono con 401.
    let _redirectingToLogin = false;

    function parseJwtExp(jwt) {
        try {
            const payload = jwt.split('.')[1];
            if (!payload) return 0;
            const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
            const json = JSON.parse(decoded);
            return typeof json.exp === 'number' ? json.exp * 1000 : 0;
        } catch (_) { return 0; }
    }

    function setTokenCache(token) {
        _tokenCache = {
            value: token || null,
            exp: token ? parseJwtExp(token) : 0,
            cachedAt: Date.now()
        };
    }

    function bindAuthListener() {
        try {
            const client = root.db;
            if (!client || !client.auth || typeof client.auth.onAuthStateChange !== 'function') return;
            client.auth.onAuthStateChange((event, session) => {
                if (event === 'SIGNED_OUT') {
                    _tokenCache = { value: null, exp: 0, cachedAt: 0 };
                    return;
                }
                setTokenCache(session?.access_token || null);
            });
        } catch (_) { /* ignore */ }
    }

    async function readSessionToken() {
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

    async function forceRefresh() {
        if (_refreshInFlight) return _refreshInFlight;
        const client = root.db;
        if (!client || !client.auth || typeof client.auth.refreshSession !== 'function') {
            return null;
        }
        _refreshInFlight = (async () => {
            try {
                const { data, error } = await client.auth.refreshSession();
                if (error || !data?.session?.access_token) {
                    console.warn('[MiroxApi] refreshSession failed', error?.message || 'no session');
                    return null;
                }
                setTokenCache(data.session.access_token);
                return data.session.access_token;
            } catch (e) {
                console.warn('[MiroxApi] refreshSession error', e?.message || e);
                return null;
            } finally {
                _refreshInFlight = null;
            }
        })();
        return _refreshInFlight;
    }

    async function getAccessToken(options) {
        const forceFresh = !!(options && options.forceFresh);
        const now = Date.now();

        if (_refreshInFlight) {
            const refreshed = await _refreshInFlight;
            if (refreshed) return refreshed;
        }

        if (!forceFresh
            && _tokenCache.value
            && _tokenCache.exp > now + REFRESH_MARGIN_MS
            && now - _tokenCache.cachedAt < TOKEN_TTL_MS) {
            return _tokenCache.value;
        }

        const tok = await readSessionToken();
        setTokenCache(tok);

        if (!tok) return null;

        // Se il token letto è scaduto o entro il margine di refresh, forza refresh.
        if (_tokenCache.exp && _tokenCache.exp <= now + REFRESH_MARGIN_MS) {
            const refreshed = await forceRefresh();
            if (refreshed) return refreshed;
            // Refresh fallito: ritorna comunque quello che abbiamo — se davvero
            // scaduto, il 401 lato function scatenerà la logica di retry.
        }

        return _tokenCache.value;
    }

    async function headers(extra) {
        const token = await getAccessToken();
        const h = { ...(extra || {}) };
        if (token) h['Authorization'] = 'Bearer ' + token;
        return h;
    }

    function isRetriableBody(body) {
        if (body == null) return true;
        if (typeof body === 'string') return true;
        if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
        if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return true;
        if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
        if (typeof ArrayBuffer !== 'undefined' && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) return true;
        // ReadableStream non è ri-consumabile: no retry.
        return false;
    }

    function redirectToLogin() {
        if (_redirectingToLogin) return;
        _redirectingToLogin = true;
        try {
            if (root.MiroxUI && typeof root.MiroxUI.toast === 'function') {
                root.MiroxUI.toast('Sessione scaduta, effettua di nuovo l\'accesso', 'warning');
            }
        } catch (_) { /* ignore */ }
        const target = root.location.pathname.includes('/moduli/') ? '../index.html' : 'index.html';
        setTimeout(() => { root.location.href = target; }, 800);
    }

    async function authFetch(url, opts) {
        const originalOpts = opts || {};
        const merged = { ...originalOpts };
        merged.headers = await headers(originalOpts.headers || {});

        const response = await fetch(url, merged);
        if (response.status !== 401) return response;

        // 401: probabilmente token scaduto. Se possiamo, refresh + retry una volta.
        if (originalOpts.__miroxRetry) return response;
        if (!isRetriableBody(originalOpts.body)) return response;

        const fresh = await forceRefresh();
        if (!fresh) {
            redirectToLogin();
            return response;
        }

        const retryOpts = { ...originalOpts, __miroxRetry: true };
        retryOpts.headers = await headers(originalOpts.headers || {});
        const retryResponse = await fetch(url, retryOpts);

        // Se anche il retry fallisce 401, il refresh_token è davvero morto.
        if (retryResponse.status === 401) redirectToLogin();

        return retryResponse;
    }

    // Refresh proattivo quando la tab torna visibile / al wake-up del browser.
    // Copre il caso "PC in sleep, tab in background" in cui il timer interno
    // di supabase-js viene throttled dal browser e non fa il refresh a metà TTL.
    function attachLifecycleHooks() {
        try {
            if (root.document && typeof root.document.addEventListener === 'function') {
                root.document.addEventListener('visibilitychange', () => {
                    if (root.document.visibilityState !== 'visible') return;
                    getAccessToken().catch(() => { /* silent */ });
                });
            }
            if (typeof root.addEventListener === 'function') {
                root.addEventListener('pageshow', () => {
                    getAccessToken().catch(() => { /* silent */ });
                });
            }
        } catch (_) { /* ignore */ }
    }

    // Heartbeat: mantiene la sessione sveglia anche se la tab resta aperta
    // per ore senza interazioni. Costo trascurabile (una lettura locale del
    // localStorage + eventuale refresh su rete quando serve).
    function startHeartbeat() {
        try {
            setInterval(() => {
                getAccessToken().catch(() => { /* silent */ });
            }, 5 * 60 * 1000);
        } catch (_) { /* ignore */ }
    }

    function init() {
        bindAuthListener();
        attachLifecycleHooks();
        startHeartbeat();
    }

    if (root.db && root.db.auth) init();
    else if (root.addEventListener) root.addEventListener('DOMContentLoaded', init, { once: true });

    root.MiroxApi = {
        fetch: authFetch,
        getAccessToken: getAccessToken,
        headers: headers,
        refreshSession: forceRefresh
    };
})(window);
