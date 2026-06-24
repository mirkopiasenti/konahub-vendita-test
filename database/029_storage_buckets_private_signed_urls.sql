-- 029 — Hardening sicurezza Fase A: bucket privati + signed URLs
--
-- Cambia 7 bucket da public=true a public=false. Restano leggibili solo via
-- signed URL generato lato client da utenti autenticati. La policy SELECT
-- viene ristretta da {public} (chiunque, anche anon) a {authenticated}.
-- 'moduli-template' resta pubblico (template generali scaricabili).
--
-- Effetti sul CC prod (mirox-crm.netlify.app): nessuno. Il CC non legge
-- alcun bucket Storage di questo elenco.
--
-- Effetti sul Mirox: getPublicUrl() smetterà di funzionare per questi bucket.
-- Il client deve passare a createSignedUrl() (gestito da js/mirox-storage.js).

BEGIN;

-- 1) Bucket: public=false
UPDATE storage.buckets
SET public = false
WHERE id IN (
    'contratti-vendita',
    'segnalazioni-files',
    'apri-chiudi-files',
    'switch-sim-files',
    'protecta-files',
    'comodato-files',
    'rimborsi-files'
);

-- 2) SELECT policy: ristretta da {public} a {authenticated}
DROP POLICY IF EXISTS "Lettura pubblica contratti-vendita" ON storage.objects;
CREATE POLICY "Lettura authenticated contratti-vendita"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'contratti-vendita');

DROP POLICY IF EXISTS "Read segnalazioni files" ON storage.objects;
CREATE POLICY "Read auth segnalazioni files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'segnalazioni-files');

DROP POLICY IF EXISTS "public_read_modules" ON storage.objects;
CREATE POLICY "auth_read_modules"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = ANY (ARRAY[
    'apri-chiudi-files',
    'switch-sim-files',
    'protecta-files',
    'comodato-files',
    'rimborsi-files'
]));

-- 3) INSERT/DELETE policy: ristrette da {public} a {authenticated}
DROP POLICY IF EXISTS "Upload segnalazioni files" ON storage.objects;
CREATE POLICY "Upload auth segnalazioni files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'segnalazioni-files');

DROP POLICY IF EXISTS "Delete segnalazioni files" ON storage.objects;
CREATE POLICY "Delete auth segnalazioni files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'segnalazioni-files');

COMMIT;
