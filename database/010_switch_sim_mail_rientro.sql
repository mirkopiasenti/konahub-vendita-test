-- =============================================================================
-- 010 - Switch SIM: tracking notifica email rientro
-- Aggiunge colonna per evitare doppi invii dell'email "rientro oggi"
-- =============================================================================

BEGIN;

ALTER TABLE public.vendita_switch_sim
    ADD COLUMN IF NOT EXISTS mail_rientro_inviata_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_switch_mail_rientro
    ON public.vendita_switch_sim(giorno_rientro)
    WHERE mail_rientro_inviata_at IS NULL;

COMMIT;
