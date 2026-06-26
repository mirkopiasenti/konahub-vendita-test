-- =============================================================================
-- Migration 035: Reload Forever + Smartphone Reload nei contratti vendita
-- =============================================================================
-- Aggiunge a `vendita_contratti`:
--   1. reload_forever (boolean) — flag parallelo a `reload_exchange`, stesso
--      pattern: visibile solo per Mobile/Customer Base nel wizard, default false.
--   2. smartphone_reload (boolean) — risposta alla riga del PDA WindTre
--      "È stata richiesta l'attivazione contestuale dell'opzione SMARTPHONE
--      RELOAD SI [X] NO [X]". true=Si, false=No, NULL=non specificato.
--      Visibile solo nella sezione Dispositivo (quando dispositivo_associato=true).
--      Pre-compilato dall'OCR (vedi prompt in ocr-pda.js).
--   3. smartphone_reload_modalita (text) — solo se smartphone_reload=true.
--      Enum {'Mantenere attivo','Disattivazione cliente'}. Manuale operatore
--      (non estraibile dal PDA).
--
-- Tutte additive: nessuna colonna rimossa, niente DROP/RENAME.
-- =============================================================================
BEGIN;

ALTER TABLE public.vendita_contratti
  ADD COLUMN IF NOT EXISTS reload_forever boolean NOT NULL DEFAULT false;

ALTER TABLE public.vendita_contratti
  ADD COLUMN IF NOT EXISTS smartphone_reload boolean NULL;

ALTER TABLE public.vendita_contratti
  ADD COLUMN IF NOT EXISTS smartphone_reload_modalita text NULL;

-- Enum modalita: solo i 2 valori ammessi (oppure NULL)
ALTER TABLE public.vendita_contratti
  DROP CONSTRAINT IF EXISTS vc_smartphone_reload_modalita_chk;
ALTER TABLE public.vendita_contratti
  ADD CONSTRAINT vc_smartphone_reload_modalita_chk
  CHECK (
    smartphone_reload_modalita IS NULL
    OR smartphone_reload_modalita IN ('Mantenere attivo','Disattivazione cliente')
  );

-- Coerenza: modalita NOT NULL solo se smartphone_reload=true.
-- Se smartphone_reload IS NULL o FALSE, modalita deve essere NULL.
ALTER TABLE public.vendita_contratti
  DROP CONSTRAINT IF EXISTS vc_smartphone_reload_coerenza_chk;
ALTER TABLE public.vendita_contratti
  ADD CONSTRAINT vc_smartphone_reload_coerenza_chk
  CHECK (
    (smartphone_reload IS TRUE  AND smartphone_reload_modalita IS NOT NULL)
    OR
    (smartphone_reload IS NOT TRUE AND smartphone_reload_modalita IS NULL)
  );

COMMENT ON COLUMN public.vendita_contratti.reload_forever IS
  'Flag Reload Forever (parallelo a reload_exchange). Mostrato solo per Mobile/Customer Base nel wizard upload-contratti-vendita. Default false. Migration 035.';

COMMENT ON COLUMN public.vendita_contratti.smartphone_reload IS
  'Risposta alla riga "SMARTPHONE RELOAD SI/NO" del PDA WindTre. Solo per contratti con dispositivo_associato=true. NULL=non specificato, true=Si, false=No. Auto-compilato dall''OCR. Migration 035.';

COMMENT ON COLUMN public.vendita_contratti.smartphone_reload_modalita IS
  'Modalita scelta quando smartphone_reload=true: "Mantenere attivo" o "Disattivazione cliente". Manuale operatore (non estraibile dal PDA). NULL altrimenti. CHECK di coerenza con smartphone_reload. Migration 035.';

COMMIT;
