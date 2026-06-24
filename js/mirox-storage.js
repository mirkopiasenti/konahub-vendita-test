/**
 * MIROX Storage helper — signed URLs per bucket privati.
 *
 * Dopo la migration 029 i bucket dati clienti sono privati. Per aprire un
 * file il client deve generare un signed URL on-demand (scadenza breve).
 *
 * API:
 *   await MiroxStorage.signedUrl(bucket, path, expiresIn=300) -> string|null
 *   await MiroxStorage.openAttachment(bucket, path)            -> apre in nuova tab
 *
 * Per binding inline negli innerHTML usare:
 *   <a href="#" onclick="MiroxStorage.openAttachment('contratti-vendita','2026/...'); return false;">Apri</a>
 *
 * Richiede `window.db` (client Supabase, da js/config.js).
 */
(function (root) {
    'use strict';
    if (root.MiroxStorage) return;

    const DEFAULT_EXPIRES = 300; // 5 minuti
    const FALLBACK_MSG = 'Documento non disponibile o sessione scaduta. Riprova dopo aver effettuato il login.';

    async function signedUrl(bucket, path, expiresIn) {
        if (!bucket || !path) return null;
        const client = root.db;
        if (!client || !client.storage) {
            console.warn('[MiroxStorage] window.db non disponibile');
            return null;
        }
        const exp = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_EXPIRES;
        try {
            const { data, error } = await client.storage.from(bucket).createSignedUrl(path, exp);
            if (error) {
                console.warn('[MiroxStorage] createSignedUrl error', bucket, path, error.message);
                return null;
            }
            return data?.signedUrl || null;
        } catch (e) {
            console.warn('[MiroxStorage] createSignedUrl exception', bucket, path, e?.message || e);
            return null;
        }
    }

    async function openAttachment(bucket, path) {
        const url = await signedUrl(bucket, path);
        if (!url) {
            try {
                if (root.MiroxUI && typeof root.MiroxUI.alert === 'function') {
                    await root.MiroxUI.alert(FALLBACK_MSG);
                } else {
                    alert(FALLBACK_MSG);
                }
            } catch (_) { alert(FALLBACK_MSG); }
            return;
        }
        // noopener evita che la nuova tab abbia accesso a window.opener
        root.open(url, '_blank', 'noopener');
    }

    root.MiroxStorage = {
        signedUrl: signedUrl,
        openAttachment: openAttachment,
        DEFAULT_EXPIRES: DEFAULT_EXPIRES
    };
})(window);
