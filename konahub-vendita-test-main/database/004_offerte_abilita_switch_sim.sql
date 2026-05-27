BEGIN;

ALTER TABLE vendita_offerte
  ADD COLUMN IF NOT EXISTS abilita_switch_sim boolean NOT NULL DEFAULT false;

UPDATE vendita_offerte
SET abilita_switch_sim = COALESCE(abilita_switch_sim, false);

ALTER TABLE vendita_offerte
  ALTER COLUMN abilita_switch_sim SET DEFAULT false,
  ALTER COLUMN abilita_switch_sim SET NOT NULL;

COMMIT;
