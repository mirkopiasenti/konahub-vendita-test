-- Migrazione 018 - post_vendita_controllo_fissi
-- Tabella post-vendita per il follow-up dei contratti Fisso dopo conferma in Verifica Contratti.
-- Workflow stati: Da completare -> In Attivazione -> (Attivo | KO).
-- Popolata in automatico da un trigger su vendita_contratti quando stato_controllo passa
-- da 'da_controllare' a 'controllato' e categoria_id = Fisso.

-- 1) Tabella principale
CREATE TABLE IF NOT EXISTS post_vendita_controllo_fissi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contratto_id uuid NOT NULL UNIQUE REFERENCES vendita_contratti(id) ON DELETE CASCADE,
  pratica_id uuid REFERENCES vendita_pratiche(id) ON DELETE SET NULL,
  anagrafica_id uuid REFERENCES anagrafica(id) ON DELETE SET NULL,
  stato text NOT NULL DEFAULT 'Da completare',
  codice_cliente text,
  tecnologia text,
  cod_contratto text,
  cod_pos text,
  numero_fisso text,
  attivazione_prevista date,
  data_attivazione date,
  motivo_ko text,
  storico_chat jsonb NOT NULL DEFAULT '[]'::jsonb,
  compilazione_completata_at timestamptz,
  compilazione_completata_da uuid REFERENCES profili(id) ON DELETE SET NULL,
  stato_cambiato_at timestamptz,
  stato_cambiato_da uuid REFERENCES profili(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) CHECK constraints (idempotenti)
ALTER TABLE post_vendita_controllo_fissi DROP CONSTRAINT IF EXISTS pvcf_stato_chk;
ALTER TABLE post_vendita_controllo_fissi
  ADD CONSTRAINT pvcf_stato_chk
  CHECK (stato IN ('Da completare','In Attivazione','Attivo','KO'));

ALTER TABLE post_vendita_controllo_fissi DROP CONSTRAINT IF EXISTS pvcf_tecnologia_chk;
ALTER TABLE post_vendita_controllo_fissi
  ADD CONSTRAINT pvcf_tecnologia_chk
  CHECK (tecnologia IS NULL OR tecnologia IN ('FTTC','FWA OUT','FWA IN','FWA VOCE','FTTH_OF','FTTH_FWCOP'));

ALTER TABLE post_vendita_controllo_fissi DROP CONSTRAINT IF EXISTS pvcf_cod_pos_chk;
ALTER TABLE post_vendita_controllo_fissi
  ADD CONSTRAINT pvcf_cod_pos_chk
  CHECK (cod_pos IS NULL OR cod_pos IN ('9001415852','900822241'));

-- 3) Indici
CREATE INDEX IF NOT EXISTS idx_pvcf_stato ON post_vendita_controllo_fissi(stato);
CREATE INDEX IF NOT EXISTS idx_pvcf_anagrafica ON post_vendita_controllo_fissi(anagrafica_id);
CREATE INDEX IF NOT EXISTS idx_pvcf_pratica ON post_vendita_controllo_fissi(pratica_id);

-- 4) RLS - pattern identico agli altri post_vendita_* (permissivo per authenticated)
ALTER TABLE post_vendita_controllo_fissi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS post_vendita_controllo_fissi_authenticated_all ON post_vendita_controllo_fissi;
CREATE POLICY post_vendita_controllo_fissi_authenticated_all
  ON post_vendita_controllo_fissi
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 5) Trigger updated_at (funzione touch_updated_at gia' esistente)
DROP TRIGGER IF EXISTS trg_post_vendita_controllo_fissi_touch ON post_vendita_controllo_fissi;
CREATE TRIGGER trg_post_vendita_controllo_fissi_touch
  BEFORE UPDATE ON post_vendita_controllo_fissi
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- 6) Funzione + trigger di creazione automatica
-- Quando un contratto Fisso passa da 'da_controllare' a 'controllato' (= conferma in
-- modulo Verifica Contratti) viene creata una riga in post_vendita_controllo_fissi.
-- Idempotente grazie a ON CONFLICT (contratto_id) DO NOTHING.
CREATE OR REPLACE FUNCTION fn_vendita_contratti_to_controllo_fissi()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_fisso_id uuid;
BEGIN
  IF NEW.stato_controllo = 'controllato'
     AND COALESCE(OLD.stato_controllo, '') <> 'controllato' THEN
    SELECT id INTO v_fisso_id
      FROM vendita_categorie
     WHERE nome = 'Fisso'
     LIMIT 1;
    IF NEW.categoria_id = v_fisso_id THEN
      INSERT INTO post_vendita_controllo_fissi (contratto_id, pratica_id, anagrafica_id)
      VALUES (NEW.id, NEW.pratica_id, NEW.anagrafica_id)
      ON CONFLICT (contratto_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_vendita_contratti_to_controllo_fissi ON vendita_contratti;
CREATE TRIGGER trg_vendita_contratti_to_controllo_fissi
  AFTER UPDATE OF stato_controllo ON vendita_contratti
  FOR EACH ROW EXECUTE FUNCTION fn_vendita_contratti_to_controllo_fissi();

-- 7) Backfill: porta dentro i contratti Fisso gia' 'controllato' (idempotente)
INSERT INTO post_vendita_controllo_fissi (contratto_id, pratica_id, anagrafica_id)
SELECT vc.id, vc.pratica_id, vc.anagrafica_id
  FROM vendita_contratti vc
  JOIN vendita_categorie cat ON cat.id = vc.categoria_id
 WHERE vc.stato_controllo = 'controllato'
   AND cat.nome = 'Fisso'
ON CONFLICT (contratto_id) DO NOTHING;
