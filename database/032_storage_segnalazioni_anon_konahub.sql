-- 032 — Riaperture anon per konahub legacy su `segnalazioni` + bucket
--
-- Contesto: il konahub (CRM provvisorio, deploy separato) usa il modulo
-- `moduli/segnalazioni.html` da mesi senza Supabase Auth: tutte le chiamate
-- sono fatte come role `anon`. Le migration 029 (bucket privati + RLS
-- storage solo authenticated) e 030 (RLS solo authenticated sulla tabella
-- `segnalazioni`) avevano rotto il modulo del konahub: niente INSERT, SELECT,
-- UPDATE, niente upload/list file, niente signed URL.
--
-- Compromesso: le policy authenticated restano in piedi → Mirox (sempre
-- authenticated) NON è toccato. Aggiungiamo SOLO policy anon additive sul
-- minimo necessario per il konahub:
--   - tabella `segnalazioni`: SELECT + INSERT + UPDATE (no DELETE — il konahub
--     non cancella e limitare DELETE riduce rischio abuso anon)
--   - bucket `segnalazioni-files`: SELECT + INSERT (no DELETE per lo stesso
--     motivo). Bucket resta `public=false`, accesso solo via signed URL.
--
-- Le altre tabelle e bucket NON sono toccati.
--
-- DA REVOCARE quando il konahub verrà dismesso (vedi CLAUDE.md
-- "Note operative consapevoli"). Cleanup:
--   DROP POLICY "segnalazioni_anon_select"  ON segnalazioni;
--   DROP POLICY "segnalazioni_anon_insert"  ON segnalazioni;
--   DROP POLICY "segnalazioni_anon_update"  ON segnalazioni;
--   DROP POLICY "Read anon segnalazioni files"   ON storage.objects;
--   DROP POLICY "Upload anon segnalazioni files" ON storage.objects;

BEGIN;

-- Tabella segnalazioni: anon SELECT + INSERT + UPDATE
DROP POLICY IF EXISTS "segnalazioni_anon_select" ON segnalazioni;
CREATE POLICY "segnalazioni_anon_select"
ON segnalazioni FOR SELECT
TO anon
USING (true);

DROP POLICY IF EXISTS "segnalazioni_anon_insert" ON segnalazioni;
CREATE POLICY "segnalazioni_anon_insert"
ON segnalazioni FOR INSERT
TO anon
WITH CHECK (true);

DROP POLICY IF EXISTS "segnalazioni_anon_update" ON segnalazioni;
CREATE POLICY "segnalazioni_anon_update"
ON segnalazioni FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

-- Bucket segnalazioni-files: anon SELECT (per signed URL + list) + INSERT (upload)
DROP POLICY IF EXISTS "Read anon segnalazioni files" ON storage.objects;
CREATE POLICY "Read anon segnalazioni files"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'segnalazioni-files');

DROP POLICY IF EXISTS "Upload anon segnalazioni files" ON storage.objects;
CREATE POLICY "Upload anon segnalazioni files"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'segnalazioni-files');

COMMIT;
