BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Catalogo opzioni: punti intrinseci + ordine.
ALTER TABLE vendita_opzioni
  ADD COLUMN IF NOT EXISTS punti_base numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS punti_extra_piva numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ordine integer DEFAULT 0;

UPDATE vendita_opzioni
SET
  punti_base = COALESCE(punti_base, punteggio_gara, 0),
  punti_extra_piva = COALESCE(punti_extra_piva, punteggio_extra_gara, 0),
  ordine = COALESCE(ordine, 0);

ALTER TABLE vendita_opzioni
  ALTER COLUMN punti_base SET DEFAULT 0,
  ALTER COLUMN punti_extra_piva SET DEFAULT 0,
  ALTER COLUMN ordine SET DEFAULT 0;

ALTER TABLE vendita_opzioni
  ALTER COLUMN punti_base SET NOT NULL,
  ALTER COLUMN punti_extra_piva SET NOT NULL,
  ALTER COLUMN ordine SET NOT NULL;

-- 2) Catalogo reload: punti intrinseci.
ALTER TABLE vendita_reload
  ADD COLUMN IF NOT EXISTS punti_base numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS punti_extra_piva numeric(10,2) DEFAULT 0;

UPDATE vendita_reload
SET
  punti_base = COALESCE(punti_base, 0),
  punti_extra_piva = COALESCE(punti_extra_piva, 0);

ALTER TABLE vendita_reload
  ALTER COLUMN punti_base SET DEFAULT 0,
  ALTER COLUMN punti_extra_piva SET DEFAULT 0;

ALTER TABLE vendita_reload
  ALTER COLUMN punti_base SET NOT NULL,
  ALTER COLUMN punti_extra_piva SET NOT NULL;

-- 3) Tabelle ponte offerta-opzioni / offerta-reload.
CREATE TABLE IF NOT EXISTS vendita_offerte_opzioni (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offerta_id uuid NOT NULL REFERENCES vendita_offerte(id) ON DELETE CASCADE,
  opzione_id uuid NOT NULL REFERENCES vendita_opzioni(id) ON DELETE CASCADE,
  ordine integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendita_offerte_reload (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offerta_id uuid NOT NULL REFERENCES vendita_offerte(id) ON DELETE CASCADE,
  reload_id uuid NOT NULL REFERENCES vendita_reload(id) ON DELETE CASCADE,
  ordine integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendita_offerte_opzioni
  ON vendita_offerte_opzioni(offerta_id, opzione_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendita_offerte_reload
  ON vendita_offerte_reload(offerta_id, reload_id);

CREATE INDEX IF NOT EXISTS idx_vendita_offerte_opzioni_offerta
  ON vendita_offerte_opzioni(offerta_id);

CREATE INDEX IF NOT EXISTS idx_vendita_offerte_opzioni_opzione
  ON vendita_offerte_opzioni(opzione_id);

CREATE INDEX IF NOT EXISTS idx_vendita_offerte_reload_offerta
  ON vendita_offerte_reload(offerta_id);

CREATE INDEX IF NOT EXISTS idx_vendita_offerte_reload_reload
  ON vendita_offerte_reload(reload_id);

-- 4) Migrazione dati legacy opzioni->offerta (se già presenti in vecchio modello).
INSERT INTO vendita_offerte_opzioni (offerta_id, opzione_id, ordine)
SELECT
  o.offerta_id,
  o.id,
  COALESCE(o.ordine, 0)
FROM vendita_opzioni o
WHERE o.offerta_id IS NOT NULL
ON CONFLICT (offerta_id, opzione_id) DO NOTHING;

-- NOTE COMPATIBILITA':
-- - Non rimuoviamo colonne legacy in questa fase (es. vendita_opzioni.offerta_id/categoria_id/cluster_cliente
--   o campi punteggio_gara/punteggio_extra_gara), così il sistema resta retrocompatibile.
-- - La nuova UI usa punti_base/punti_extra_piva e le tabelle ponte.

COMMIT;
