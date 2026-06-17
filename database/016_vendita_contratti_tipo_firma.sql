-- Migration 016: aggiunge tipo_firma a vendita_contratti
--
-- Solo per categorie con PDA (Mobile / Customer Base / Fisso) il wizard
-- raccoglie lo step "Firma": 'elettronica' (default, niente upload extra)
-- oppure 'cartacea' (richiede upload contratto firmato in storage).
-- Per categorie senza PDA (Energia / Allarmi / Assicurazioni) il campo
-- resta NULL.

ALTER TABLE vendita_contratti
  ADD COLUMN IF NOT EXISTS tipo_firma text;

ALTER TABLE vendita_contratti
  DROP CONSTRAINT IF EXISTS vendita_contratti_tipo_firma_check;

ALTER TABLE vendita_contratti
  ADD CONSTRAINT vendita_contratti_tipo_firma_check
  CHECK (tipo_firma IS NULL OR tipo_firma IN ('elettronica', 'cartacea'));
