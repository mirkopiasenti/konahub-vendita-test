-- Migrazione 022 - post_vendita_controllo_assicurazioni
-- Crea la tabella di follow-up per i contratti Assicurazioni dopo la conferma in
-- moduli/verifica_contratti.html. Nessuna logica di stato/transizioni: i dati
-- vengono letti dal join con vendita_contratti + anagrafica (operatore_id,
-- nome_offerta_snapshot, modalita_pagamento_assicurazione, ricorrenza_assicurazione).

-- 1) Tabella principale
CREATE TABLE IF NOT EXISTS post_vendita_controllo_assicurazioni (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contratto_id uuid NOT NULL UNIQUE REFERENCES vendita_contratti(id) ON DELETE CASCADE,
  pratica_id uuid REFERENCES vendita_pratiche(id) ON DELETE SET NULL,
  anagrafica_id uuid REFERENCES anagrafica(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Indici
CREATE INDEX IF NOT EXISTS idx_pvas_anagrafica ON post_vendita_controllo_assicurazioni(anagrafica_id);
CREATE INDEX IF NOT EXISTS idx_pvas_pratica    ON post_vendita_controllo_assicurazioni(pratica_id);
CREATE INDEX IF NOT EXISTS idx_pvas_created    ON post_vendita_controllo_assicurazioni(created_at DESC);

-- 3) RLS (pattern identico agli altri post_vendita_*)
ALTER TABLE post_vendita_controllo_assicurazioni ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS post_vendita_controllo_assicurazioni_authenticated_all ON post_vendita_controllo_assicurazioni;
CREATE POLICY post_vendita_controllo_assicurazioni_authenticated_all
  ON post_vendita_controllo_assicurazioni
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 4) Trigger updated_at (funzione touch_updated_at gia' esistente)
DROP TRIGGER IF EXISTS trg_post_vendita_controllo_assicurazioni_touch ON post_vendita_controllo_assicurazioni;
CREATE TRIGGER trg_post_vendita_controllo_assicurazioni_touch
  BEFORE UPDATE ON post_vendita_controllo_assicurazioni
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- 5) Funzione + trigger di creazione automatica
-- Quando un contratto Assicurazioni passa da 'da_controllare' a 'controllato' viene
-- creata una riga nella tabella. Idempotente grazie a ON CONFLICT (contratto_id) DO NOTHING.
CREATE OR REPLACE FUNCTION fn_vendita_contratti_to_controllo_assicurazioni()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_assicurazioni_id uuid;
BEGIN
  IF NEW.stato_controllo = 'controllato'
     AND COALESCE(OLD.stato_controllo, '') <> 'controllato' THEN
    SELECT id INTO v_assicurazioni_id
      FROM vendita_categorie
     WHERE nome = 'Assicurazioni'
     LIMIT 1;
    IF NEW.categoria_id = v_assicurazioni_id THEN
      INSERT INTO post_vendita_controllo_assicurazioni (contratto_id, pratica_id, anagrafica_id)
      VALUES (NEW.id, NEW.pratica_id, NEW.anagrafica_id)
      ON CONFLICT (contratto_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_vendita_contratti_to_controllo_assicurazioni ON vendita_contratti;
CREATE TRIGGER trg_vendita_contratti_to_controllo_assicurazioni
  AFTER UPDATE OF stato_controllo ON vendita_contratti
  FOR EACH ROW EXECUTE FUNCTION fn_vendita_contratti_to_controllo_assicurazioni();

-- 6) Backfill: porta dentro i contratti Assicurazioni gia' 'controllato' (idempotente)
INSERT INTO post_vendita_controllo_assicurazioni (contratto_id, pratica_id, anagrafica_id)
SELECT vc.id, vc.pratica_id, vc.anagrafica_id
  FROM vendita_contratti vc
  JOIN vendita_categorie cat ON cat.id = vc.categoria_id
 WHERE vc.stato_controllo = 'controllato'
   AND cat.nome = 'Assicurazioni'
ON CONFLICT (contratto_id) DO NOTHING;
