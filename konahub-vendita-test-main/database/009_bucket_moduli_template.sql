-- =============================================================================
-- 009 - Bucket pubblico per modulistica statica (template PDF da scaricare)
-- =============================================================================
-- Carica manualmente da Supabase Dashboard → Storage → moduli-template:
--   - disdetta_fisso_consumer.pdf
--   - disdetta_fisso_business.pdf
--   - disdetta_mobile_consumer.pdf
--   - disdetta_mobile_business.pdf
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('moduli-template', 'moduli-template', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Policy: lettura pubblica
DROP POLICY IF EXISTS "moduli_template_public_read" ON storage.objects;
CREATE POLICY "moduli_template_public_read" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'moduli-template');

-- Policy: upload solo autenticati
DROP POLICY IF EXISTS "moduli_template_auth_write" ON storage.objects;
CREATE POLICY "moduli_template_auth_write" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'moduli-template');

-- Policy: update/delete solo autenticati
DROP POLICY IF EXISTS "moduli_template_auth_update" ON storage.objects;
CREATE POLICY "moduli_template_auth_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'moduli-template')
    WITH CHECK (bucket_id = 'moduli-template');

DROP POLICY IF EXISTS "moduli_template_auth_delete" ON storage.objects;
CREATE POLICY "moduli_template_auth_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'moduli-template');
