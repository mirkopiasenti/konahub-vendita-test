-- Migrazione 023 - post_vendita_controllo_allarmi
-- Crea la tabella di follow-up per i contratti Allarmi dopo la conferma in
-- moduli/verifica_contratti.html. Nessuna logica di stato/transizioni: i dati
-- vengono letti dal join con vendita_contratti + anagrafica (operatore_id,
-- nome_offerta_snapshot, modalita_pagamento per Allarmi = Finanziamento|Anticipo).

-- 1) Tabella principale
CREATE TABLE IF NOT EXISTS post_vendita_controllo_allarmi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contratto_id uuid NOT NULL UNIQUE REFERENCES vendita_contratti(id) ON DELETE CASCADE,
  pratica_id uuid REFERENCES vendita_pratiche(id) ON DELETE SET NULL,
  anagrafica_id uuid REFERENCES anagrafica(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Indici
CREATE INDEX IF NOT EXISTS idx_pval_anagrafica ON post_vendita_controllo_allarmi(anagrafica_id);
CREATE INDEX IF NOT EXISTS idx_pval_pratica    ON post_vendita_controllo_allarmi(pratica_id);
CREATE INDEX IF NOT EXISTS idx_pval_created    ON post_vendita_controllo_allarmi(created_at DESC);

-- 3) RLS (pattern identico agli altri post_vendita_*)
ALTER TABLE post_vendita_controllo_allarmi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS post_vendita_controllo_allarmi_authenticated_all ON post_vendita_controllo_allarmi;
CREATE POLICY post_vendita_controllo_allarmi_authenticated_all
  ON post_vendita_controllo_allarmi
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 4) Trigger updated_at
DROP TRIGGER IF EXISTS trg_post_vendita_controllo_allarmi_touch ON post_vendita_controllo_allarmi;
CREATE TRIGGER trg_post_vendita_controllo_allarmi_touch
  BEFORE UPDATE ON post_vendita_controllo_allarmi
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- 5) Funzione + trigger di creazione automatica
-- Quando un contratto Allarmi passa da 'da_controllare' a 'controllato' viene
-- creata una riga nella tabella. Idempotente.
CREATE OR REPLACE FUNCTION fn_vendita_contratti_to_controllo_allarmi()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_allarmi_id uuid;
BEGIN
  IF NEW.stato_controllo = 'controllato'
     AND COALESCE(OLD.stato_controllo, '') <> 'controllato' THEN
    SELECT id INTO v_allarmi_id
      FROM vendita_categorie
     WHERE nome = 'Allarmi'
     LIMIT 1;
    IF NEW.categoria_id = v_allarmi_id THEN
      INSERT INTO post_vendita_controllo_allarmi (contratto_id, pratica_id, anagrafica_id)
      VALUES (NEW.id, NEW.pratica_id, NEW.anagrafica_id)
      ON CONFLICT (contratto_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_vendita_contratti_to_controllo_allarmi ON vendita_contratti;
CREATE TRIGGER trg_vendita_contratti_to_controllo_allarmi
  AFTER UPDATE OF stato_controllo ON vendita_contratti
  FOR EACH ROW EXECUTE FUNCTION fn_vendita_contratti_to_controllo_allarmi();

-- 6) Backfill: porta dentro i contratti Allarmi gia' 'controllato' (idempotente)
INSERT INTO post_vendita_controllo_allarmi (contratto_id, pratica_id, anagrafica_id)
SELECT vc.id, vc.pratica_id, vc.anagrafica_id
  FROM vendita_contratti vc
  JOIN vendita_categorie cat ON cat.id = vc.categoria_id
 WHERE vc.stato_controllo = 'controllato'
   AND cat.nome = 'Allarmi'
ON CONFLICT (contratto_id) DO NOTHING;
