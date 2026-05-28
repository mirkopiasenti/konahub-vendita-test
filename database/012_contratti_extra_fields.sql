-- =============================================================================
-- Migration 012: Campi extra per vendita_contratti
-- =============================================================================
-- Estende la tabella `vendita_contratti` con 4 nuovi campi richiesti dal
-- workflow Mirox (modifiche al modulo upload contratti):
--
--   1. pod_pdr               text     — Codice POD (elettrico) o PDR (gas) del
--                                       contatore. Obbligatorio in UI quando la
--                                       categoria è "Energia".
--
--   2. numero_contratto_energia text — Numero contratto Energia. Predisposto in
--                                       schema ma NON visibile/obbligatorio in
--                                       UI: verrà popolato a posteriori da BO.
--
--   3. prezzo_fisso           numeric(10,2) — Prezzo a cui è stato venduto il
--                                       contratto Fisso. Chiesto via popup
--                                       al passaggio dalla pagina 2 alla 3.
--
--   4. reload_exchange        boolean  — Flag "Reload Exchange". Visibile in UI
--                                       solo per categorie "Mobile" e
--                                       "Customer Base".
-- =============================================================================
BEGIN;

ALTER TABLE public.vendita_contratti
    ADD COLUMN IF NOT EXISTS pod_pdr text,
    ADD COLUMN IF NOT EXISTS numero_contratto_energia text,
    ADD COLUMN IF NOT EXISTS prezzo_fisso numeric(10,2),
    ADD COLUMN IF NOT EXISTS reload_exchange boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vendita_contratti.pod_pdr IS
    'Codice POD (elettrico) o PDR (gas) del contatore. Obbligatorio in UI quando categoria = Energia.';
COMMENT ON COLUMN public.vendita_contratti.numero_contratto_energia IS
    'Numero contratto Energia. Predisposto ma popolato in BO a posteriori (non obbligatorio in UI).';
COMMENT ON COLUMN public.vendita_contratti.prezzo_fisso IS
    'Prezzo di vendita per contratti Fisso. Chiesto in UI tramite popup al passaggio step 2 → 3.';
COMMENT ON COLUMN public.vendita_contratti.reload_exchange IS
    'Flag Reload Exchange. Disponibile in UI solo per categorie Mobile e Customer Base.';

-- Indice opzionale su pod_pdr per ricerche future
CREATE INDEX IF NOT EXISTS idx_vendita_contratti_pod_pdr
    ON public.vendita_contratti(pod_pdr) WHERE pod_pdr IS NOT NULL;

COMMIT;
