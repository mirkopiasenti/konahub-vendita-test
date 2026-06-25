-- 031 — Hardening sicurezza Fase C.2: chiusura RLS anon su tabelle CC-shared
--
-- PREREQUISITO: il form pubblico prenota.html DEVE essere gia' refactorato
-- per parlare con la Netlify function `public-prenota.js` (che usa
-- service_role) invece di chiamare Supabase direttamente. Diversamente il
-- form non riuscira' piu' a leggere slot ne' creare appuntamenti.
--
-- Le policy attuali permettono al ruolo {anon} (= utenti non autenticati)
-- di leggere/scrivere su tabelle che contengono PII clienti
-- (appuntamenti) o configurazione operativa (slot_bloccati, blocchi,
-- orari_standard, impostazioni). Dopo questa migration solo gli utenti
-- {authenticated} possono leggere/scrivere queste tabelle dal client.
--
-- Effetti sul CC prod (mirox-crm.netlify.app):
--   - Operatori CC: nessuno (sono autenticati Supabase Auth)
--   - Form pubblico (se il CC prod ne ha uno): potrebbe rompersi se chiama
--     queste tabelle senza auth. Da verificare insieme all'utente prima
--     dell'apply.
--
-- Le policy 'modify' (blocchi_modify, orari_modify, impostazioni_modify)
-- gia' filtrate da crm_can_access_page() restano invariate.

BEGIN;

-- ============================================================
-- APPUNTAMENTI
-- ============================================================
DROP POLICY IF EXISTS appuntamenti_select ON public.appuntamenti;
CREATE POLICY appuntamenti_select
ON public.appuntamenti
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS appuntamenti_insert ON public.appuntamenti;
CREATE POLICY appuntamenti_insert
ON public.appuntamenti
FOR INSERT
TO authenticated
WITH CHECK (true);

-- appuntamenti_update gia' filtrata da (auth.uid() IS NOT NULL): la lascio
-- ma stringo i roles a {authenticated} per uniformita'.
DROP POLICY IF EXISTS appuntamenti_update ON public.appuntamenti;
CREATE POLICY appuntamenti_update
ON public.appuntamenti
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- ============================================================
-- SLOT_BLOCCATI
-- ============================================================
DROP POLICY IF EXISTS slot_select ON public.slot_bloccati;
CREATE POLICY slot_select
ON public.slot_bloccati
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS slot_insert ON public.slot_bloccati;
CREATE POLICY slot_insert
ON public.slot_bloccati
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS slot_delete ON public.slot_bloccati;
CREATE POLICY slot_delete
ON public.slot_bloccati
FOR DELETE
TO authenticated
USING (true);

-- ============================================================
-- BLOCCHI / ORARI_STANDARD / IMPOSTAZIONI (solo SELECT da chiudere)
-- ============================================================
DROP POLICY IF EXISTS blocchi_select ON public.blocchi;
CREATE POLICY blocchi_select
ON public.blocchi
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS orari_select ON public.orari_standard;
CREATE POLICY orari_select
ON public.orari_standard
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS impostazioni_select ON public.impostazioni;
CREATE POLICY impostazioni_select
ON public.impostazioni
FOR SELECT
TO authenticated
USING (true);

COMMIT;
