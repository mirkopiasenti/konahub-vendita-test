-- Migrazione 019 - vendita_contratti.ex_fornitore + post_vendita_controllo_lg
-- Aggiunge la colonna 'ex_fornitore' su vendita_contratti (obbligatoria lato UI per
-- Energia, compilata in moduli/verifica_contratti.html). Crea la tabella di follow-up
-- per i contratti L&G (categoria Energia) dopo la conferma in Verifica Contratti.
-- Stato 'stato' lasciato come text nullable senza CHECK: i valori saranno definiti in
-- un secondo momento (l'utente vuole prepararlo, le regole arriveranno).

-- 1) Colonna ex_fornitore su vendita_contratti (idempotente)
ALTER TABLE vendita_contratti ADD COLUMN IF NOT EXISTS ex_fornitore text;
COMMENT ON COLUMN public.vendita_contratti.ex_fornitore IS
  'Nome del fornitore precedente del cliente (solo Energia, obbligatorio in fase di verifica).';

-- 2) Tabella post_vendita_controllo_lg
CREATE TABLE IF NOT EXISTS post_vendita_controllo_lg (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contratto_id uuid NOT NULL UNIQUE REFERENCES vendita_contratti(id) ON DELETE CASCADE,
  pratica_id uuid REFERENCES vendita_pratiche(id) ON DELETE SET NULL,
  anagrafica_id uuid REFERENCES anagrafica(id) ON DELETE SET NULL,
  stato text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) Indici utili per ricerca/filtraggio
CREATE INDEX IF NOT EXISTS idx_pvlg_stato       ON post_vendita_controllo_lg(stato);
CREATE INDEX IF NOT EXISTS idx_pvlg_anagrafica  ON post_vendita_controllo_lg(anagrafica_id);
CREATE INDEX IF NOT EXISTS idx_pvlg_pratica     ON post_vendita_controllo_lg(pratica_id);
CREATE INDEX IF NOT EXISTS idx_pvlg_created     ON post_vendita_controllo_lg(created_at DESC);

-- 4) RLS - pattern identico agli altri post_vendita_* (permissivo per authenticated)
ALTER TABLE post_vendita_controllo_lg ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS post_vendita_controllo_lg_authenticated_all ON post_vendita_controllo_lg;
CREATE POLICY post_vendita_controllo_lg_authenticated_all
  ON post_vendita_controllo_lg
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 5) Trigger updated_at (funzione touch_updated_at gia' esistente)
DROP TRIGGER IF EXISTS trg_post_vendita_controllo_lg_touch ON post_vendita_controllo_lg;
CREATE TRIGGER trg_post_vendita_controllo_lg_touch
  BEFORE UPDATE ON post_vendita_controllo_lg
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- 6) Funzione + trigger di creazione automatica
-- Quando un contratto Energia passa da 'da_controllare' a 'controllato' (= conferma in
-- moduli/verifica_contratti.html) viene creata una riga in post_vendita_controllo_lg.
-- Idempotente grazie a ON CONFLICT (contratto_id) DO NOTHING.
CREATE OR REPLACE FUNCTION fn_vendita_contratti_to_controllo_lg()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_energia_id uuid;
BEGIN
  IF NEW.stato_controllo = 'controllato'
     AND COALESCE(OLD.stato_controllo, '') <> 'controllato' THEN
    SELECT id INTO v_energia_id
      FROM vendita_categorie
     WHERE nome = 'Energia'
     LIMIT 1;
    IF NEW.categoria_id = v_energia_id THEN
      INSERT INTO post_vendita_controllo_lg (contratto_id, pratica_id, anagrafica_id)
      VALUES (NEW.id, NEW.pratica_id, NEW.anagrafica_id)
      ON CONFLICT (contratto_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_vendita_contratti_to_controllo_lg ON vendita_contratti;
CREATE TRIGGER trg_vendita_contratti_to_controllo_lg
  AFTER UPDATE OF stato_controllo ON vendita_contratti
  FOR EACH ROW EXECUTE FUNCTION fn_vendita_contratti_to_controllo_lg();

-- 7) Backfill: porta dentro i contratti Energia gia' 'controllato' (idempotente)
INSERT INTO post_vendita_controllo_lg (contratto_id, pratica_id, anagrafica_id)
SELECT vc.id, vc.pratica_id, vc.anagrafica_id
  FROM vendita_contratti vc
  JOIN vendita_categorie cat ON cat.id = vc.categoria_id
 WHERE vc.stato_controllo = 'controllato'
   AND cat.nome = 'Energia'
ON CONFLICT (contratto_id) DO NOTHING;
