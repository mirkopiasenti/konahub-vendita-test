-- Migrazione 020 - post_vendita_controllo_lg: campi per import CSV WindTre
-- Aggiunge i campi popolati dall'upload CSV nel modulo Controllo L&G:
--   - causale_stato_pratica  (colonna N del CSV)  — popolata solo se stato='Rifiutato'
--   - messaggio_esito_sap    (colonna O del CSV)  — popolata solo se stato='Rifiutato'
--   - causa_annullamento     (colonna P del CSV)  — popolata solo se stato='Rifiutato'
--   - ultimo_csv_upload_at   timestamptz          — quando e' avvenuto l'ultimo upload che ha aggiornato questa riga
--   - ultimo_csv_upload_da   uuid -> profili.id   — chi ha caricato l'ultimo CSV che ha aggiornato questa riga
-- Nessun CHECK constraint sulla colonna 'stato': l'utente vuole flessibilita' nel caso
-- il portale WindTre aggiunga stati futuri.

ALTER TABLE post_vendita_controllo_lg ADD COLUMN IF NOT EXISTS causale_stato_pratica text;
ALTER TABLE post_vendita_controllo_lg ADD COLUMN IF NOT EXISTS messaggio_esito_sap   text;
ALTER TABLE post_vendita_controllo_lg ADD COLUMN IF NOT EXISTS causa_annullamento    text;
ALTER TABLE post_vendita_controllo_lg ADD COLUMN IF NOT EXISTS ultimo_csv_upload_at  timestamptz;
ALTER TABLE post_vendita_controllo_lg ADD COLUMN IF NOT EXISTS ultimo_csv_upload_da  uuid REFERENCES profili(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.post_vendita_controllo_lg.causale_stato_pratica IS
  'Colonna N del CSV WindTre - popolata solo per stato=Rifiutato (es. Pre check SII KO).';
COMMENT ON COLUMN public.post_vendita_controllo_lg.messaggio_esito_sap IS
  'Colonna O del CSV WindTre - popolata solo per stato=Rifiutato (es. PRECHECK NON SUPERATO).';
COMMENT ON COLUMN public.post_vendita_controllo_lg.causa_annullamento IS
  'Colonna P del CSV WindTre - popolata solo per stato=Rifiutato (es. Revoca ai sensi del comma 6.3 del TIMOE).';
COMMENT ON COLUMN public.post_vendita_controllo_lg.ultimo_csv_upload_at IS
  'Timestamp dell''ultimo upload CSV che ha aggiornato lo stato di questa riga (sovrascrive sempre).';
COMMENT ON COLUMN public.post_vendita_controllo_lg.ultimo_csv_upload_da IS
  'Profilo che ha eseguito l''upload del CSV che ha aggiornato lo stato di questa riga.';
