-- 030 — Hardening sicurezza Fase C.1: chiusura RLS su tabelle solo-Mirox
--
-- segnalazioni: la policy "Accesso completo segnalazioni" era cmd=ALL
-- roles={public} qual=true, quindi anche utenti non autenticati (anon)
-- potevano leggere/inserire/modificare/cancellare qualsiasi segnalazione.
-- La tabella contiene PII clienti (CF/PIVA, telefono, dettagli) e va
-- ristretta solo agli utenti autenticati Mirox.
--
-- Effetti sul CC prod: nessuno (segnalazioni è tabella esclusivamente Mirox,
-- il CC non la legge ne' la scrive).

BEGIN;

DROP POLICY IF EXISTS "Accesso completo segnalazioni" ON public.segnalazioni;

CREATE POLICY "segnalazioni_authenticated_all"
ON public.segnalazioni
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

COMMIT;
