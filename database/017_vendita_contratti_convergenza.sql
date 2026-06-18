-- Migrazione 017 - vendita_contratti.convergenza
-- Aggiunge colonna 'convergenza' (text + CHECK) per i contratti Fisso.
-- Valori ammessi: Mobile, L&G, Allarme, Assicurazione, Sim Interna, NO Convergenza, Coupon.
-- NULL ammesso a livello DB (le righe storiche non hanno il dato).
-- Il wizard upload-contratti la richiede insieme al prezzo_fisso nel popup di step 2 Fisso.

ALTER TABLE vendita_contratti ADD COLUMN IF NOT EXISTS convergenza text;

ALTER TABLE vendita_contratti DROP CONSTRAINT IF EXISTS vendita_contratti_convergenza_chk;

ALTER TABLE vendita_contratti
  ADD CONSTRAINT vendita_contratti_convergenza_chk
  CHECK (
    convergenza IS NULL
    OR convergenza IN ('Mobile','L&G','Allarme','Assicurazione','Sim Interna','NO Convergenza','Coupon')
  );
