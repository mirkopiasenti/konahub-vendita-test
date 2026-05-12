-- =============================================================================
-- 008 - Pulizia stati ordini smartphone
-- Rimuove lo stato "Arrivato" dal CHECK constraint
-- =============================================================================

BEGIN;

-- Aggiorna eventuali record già in stato 'Arrivato' a 'Ordinato'
UPDATE public.vendita_ordini_smartphone
SET stato = 'Ordinato'
WHERE stato = 'Arrivato';

-- Rimuovi il vecchio constraint e ricrealo senza 'Arrivato'
ALTER TABLE public.vendita_ordini_smartphone
    DROP CONSTRAINT IF EXISTS vendita_ordini_smartphone_stato_check;

ALTER TABLE public.vendita_ordini_smartphone
    ADD CONSTRAINT vendita_ordini_smartphone_stato_check
    CHECK (stato IN ('In attesa','Ordinato','Venduto','Annullato'));

COMMIT;
