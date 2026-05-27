BEGIN;

ALTER TABLE vendita_offerte
  ADD COLUMN IF NOT EXISTS abilita_dispositivo boolean NOT NULL DEFAULT false;

UPDATE vendita_offerte
SET abilita_dispositivo = COALESCE(abilita_dispositivo, false);

ALTER TABLE vendita_offerte
  ALTER COLUMN abilita_dispositivo SET DEFAULT false,
  ALTER COLUMN abilita_dispositivo SET NOT NULL;

COMMIT;
