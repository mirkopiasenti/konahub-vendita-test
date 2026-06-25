-- =============================================================
-- 033 - Reinserimenti contratti (anti-doppio-conteggio dashboard)
-- =============================================================
-- Scenario:
-- Quando una pratica va in KO post-vendita (Fisso/Allarmi)
-- o viene Rifiutata/Annullata (Energia/L&G) e l'operatore la
-- ricarica come pratica nuova dopo qualche giorno, la dashboard
-- mensile rischia di contare 2 pezzi quando in realta' e' una
-- singola vendita. Idem per Assicurazioni KO.
--
-- Soluzione: il wizard upload-contratti, all'apertura dello step
-- "Dati contratto", verifica se per (anagrafica_id, categoria)
-- esiste un contratto precedente negli ultimi 90 giorni in uno
-- stato "non-positivo" (KO / In Attivazione / Rifiutato / ...).
-- Se si', mostra un popup che chiede all'operatore se la nuova
-- pratica e' un REINSERIMENTO. La scelta viene salvata su
-- vendita_contratti.stato_inserimento + FK al contratto originale.
-- La dashboard escludera' i reinserimenti dal conteggio.
--
-- Mapping stati per categoria (validato dall'utente):
--   Fisso         -> post_vendita_controllo_fissi.stato IN ('KO','In Attivazione')
--   Energia (L&G) -> post_vendita_controllo_lg.stato IN ('Rifiutato','Annullato','Nuovo','In lavorazione','In attivazione')
--   Allarmi       -> post_vendita_controllo_allarmi.stato IN ('KO','In Attivazione')
--   Assicurazioni -> post_vendita_controllo_assicurazioni.stato = 'KO'
--   Mobile / Customer Base -> nessun check (non c'e' post-vendita)
--
-- Le tabelle post_vendita_controllo_allarmi e
-- post_vendita_controllo_assicurazioni NON avevano un campo
-- `stato`: lo aggiungiamo qui (CHECK custom per categoria).
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1) vendita_contratti: flag reinserimento + FK al contratto originale
-- -------------------------------------------------------------
ALTER TABLE public.vendita_contratti
  ADD COLUMN IF NOT EXISTS stato_inserimento text NOT NULL DEFAULT 'inserimento',
  ADD COLUMN IF NOT EXISTS reinserimento_di_contratto_id uuid NULL;

ALTER TABLE public.vendita_contratti
  DROP CONSTRAINT IF EXISTS vendita_contratti_stato_inserimento_chk;
ALTER TABLE public.vendita_contratti
  ADD CONSTRAINT vendita_contratti_stato_inserimento_chk
  CHECK (stato_inserimento IN ('inserimento','reinserimento'));

-- Coerenza flag <-> FK:
--   stato_inserimento='reinserimento' => reinserimento_di_contratto_id NOT NULL
--   stato_inserimento='inserimento'   => reinserimento_di_contratto_id IS NULL
ALTER TABLE public.vendita_contratti
  DROP CONSTRAINT IF EXISTS vendita_contratti_reinserimento_coerenza_chk;
ALTER TABLE public.vendita_contratti
  ADD CONSTRAINT vendita_contratti_reinserimento_coerenza_chk
  CHECK (
    (stato_inserimento = 'reinserimento' AND reinserimento_di_contratto_id IS NOT NULL)
    OR
    (stato_inserimento = 'inserimento'   AND reinserimento_di_contratto_id IS NULL)
  );

-- FK auto-referenziale (un contratto non puo' essere reinserimento di se' stesso:
-- garantito dal fatto che il padre esiste gia' prima del figlio).
ALTER TABLE public.vendita_contratti
  DROP CONSTRAINT IF EXISTS vendita_contratti_reinserimento_di_fk;
ALTER TABLE public.vendita_contratti
  ADD CONSTRAINT vendita_contratti_reinserimento_di_fk
  FOREIGN KEY (reinserimento_di_contratto_id)
  REFERENCES public.vendita_contratti(id)
  ON DELETE SET NULL;

-- Indice per query reinserimenti: lookup (anagrafica_id, categoria_id) ordinato per data
CREATE INDEX IF NOT EXISTS idx_vendita_contratti_anagrafica_categoria_data
  ON public.vendita_contratti (anagrafica_id, categoria_id, data_contratto DESC);

-- Indice per drill-down "tutti i reinserimenti di un contratto"
CREATE INDEX IF NOT EXISTS idx_vendita_contratti_reinserimento_di
  ON public.vendita_contratti (reinserimento_di_contratto_id)
  WHERE reinserimento_di_contratto_id IS NOT NULL;

COMMENT ON COLUMN public.vendita_contratti.stato_inserimento IS
  'inserimento = pratica nuova (default). reinserimento = pratica gia'' inviata in passato (KO/in lavorazione/rifiutata) ricaricata per riprovare. La dashboard esclude i reinserimenti dal conteggio mensile (evita doppi conteggi).';
COMMENT ON COLUMN public.vendita_contratti.reinserimento_di_contratto_id IS
  'FK al contratto originale (KO o In Attivazione) di cui questa pratica e'' un reinserimento. Valorizzato solo se stato_inserimento=''reinserimento''.';

-- -------------------------------------------------------------
-- 2) post_vendita_controllo_assicurazioni: campo stato (OK/KO)
-- -------------------------------------------------------------
ALTER TABLE public.post_vendita_controllo_assicurazioni
  ADD COLUMN IF NOT EXISTS stato text NULL,
  ADD COLUMN IF NOT EXISTS stato_cambiato_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS stato_cambiato_da uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL;

ALTER TABLE public.post_vendita_controllo_assicurazioni
  DROP CONSTRAINT IF EXISTS pvca_stato_chk;
ALTER TABLE public.post_vendita_controllo_assicurazioni
  ADD CONSTRAINT pvca_stato_chk
  CHECK (stato IS NULL OR stato IN ('OK','KO'));

COMMENT ON COLUMN public.post_vendita_controllo_assicurazioni.stato IS
  'Esito post-vendita Assicurazioni. NULL = ancora da valutare; OK = contratto andato a buon fine; KO = non lavorabile (potra'' essere ricaricato come reinserimento).';

-- -------------------------------------------------------------
-- 3) post_vendita_controllo_allarmi: campo stato (In Attivazione / OK / KO)
-- -------------------------------------------------------------
ALTER TABLE public.post_vendita_controllo_allarmi
  ADD COLUMN IF NOT EXISTS stato text NOT NULL DEFAULT 'In Attivazione',
  ADD COLUMN IF NOT EXISTS stato_cambiato_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS stato_cambiato_da uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL;

ALTER TABLE public.post_vendita_controllo_allarmi
  DROP CONSTRAINT IF EXISTS pvcal_stato_chk;
ALTER TABLE public.post_vendita_controllo_allarmi
  ADD CONSTRAINT pvcal_stato_chk
  CHECK (stato IN ('In Attivazione','OK','KO'));

COMMENT ON COLUMN public.post_vendita_controllo_allarmi.stato IS
  'Esito post-vendita Allarmi. Default ''In Attivazione'' (creato in automatico dal trigger); poi l''operatore lo passa a OK (attivato) o KO (non lavorabile, potra'' essere ricaricato come reinserimento).';

COMMIT;
