-- Migration 021: campi specifici per categoria Assicurazioni
--
-- Per i contratti Assicurazioni il wizard raccoglie due dati extra:
--   - modalita_pagamento_assicurazione: RID | Carta di Credito | Carta di Debito
--   - ricorrenza_assicurazione:        Mensile | Annuale
--
-- Sono colonne separate dalla `modalita_pagamento` di Allarmi
-- (Finanziamento/Anticipo) per evitare collisioni di domini.

ALTER TABLE vendita_contratti
  ADD COLUMN IF NOT EXISTS modalita_pagamento_assicurazione text,
  ADD COLUMN IF NOT EXISTS ricorrenza_assicurazione text;

ALTER TABLE vendita_contratti
  DROP CONSTRAINT IF EXISTS vendita_contratti_modalita_pagamento_assicurazione_check;
ALTER TABLE vendita_contratti
  ADD CONSTRAINT vendita_contratti_modalita_pagamento_assicurazione_check
  CHECK (
    modalita_pagamento_assicurazione IS NULL
    OR modalita_pagamento_assicurazione IN ('RID', 'Carta di Credito', 'Carta di Debito')
  );

ALTER TABLE vendita_contratti
  DROP CONSTRAINT IF EXISTS vendita_contratti_ricorrenza_assicurazione_check;
ALTER TABLE vendita_contratti
  ADD CONSTRAINT vendita_contratti_ricorrenza_assicurazione_check
  CHECK (
    ricorrenza_assicurazione IS NULL
    OR ricorrenza_assicurazione IN ('Mensile', 'Annuale')
  );
