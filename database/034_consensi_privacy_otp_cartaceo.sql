-- =============================================================
-- 034 - Sistema consensi privacy (OTP via SMS + cartaceo)
-- =============================================================
-- Contesto:
-- Mirox archivia documenti sensibili dei clienti (PDA WindTre,
-- documento d'identita') in un CRM separato da WindTre. Per
-- essere conforme GDPR (art. 13 informativa + art. 7 consenso)
-- serve raccogliere un consenso esplicito del cliente al
-- trattamento dei dati nel CRM di Kona Tech S.r.l., con un
-- meccanismo probatorio robusto.
--
-- Flusso (2 modalita'):
--
--   A) Firma elettronica via OTP SMS (preferita)
--      1. Wizard genera HTML informativa con i dati cliente
--      2. Operatore clicca "Invia OTP" -> Smshosting invia
--         codice 6 cifre al cellulare del cliente
--      3. Cliente legge il codice all'operatore
--      4. Operatore digita codice -> verifica server-side
--      5. Backend genera PDF finale con metadata firma
--         (timestamp, IP, cellulare, hash documento) e lo salva
--         nel bucket consensi-privacy
--      6. Il record stato passa a 'confermato' e
--         valido_fino_al = now() + 48 mesi
--
--   B) Cartaceo (fallback per turisti senza numero IT, ecc.)
--      1. Wizard genera PDF informativa precompilato
--      2. Operatore lo stampa, cliente firma a mano
--      3. Operatore scansiona e carica scansione
--      4. Backend salva direttamente con stato='confermato' e
--         valido_fino_al = now() + 48 mesi
--
-- Dedupe 48 mesi:
-- Al click "Invia pratica" il wizard chiama check-consenso-privacy
-- per anagrafica_id. Se esiste un consenso 'confermato' non scaduto
-- e non revocato, salta tutto il flusso OTP/cartaceo e procede
-- direttamente all'upload pratica.
--
-- Modello dati:
-- Il consenso e' legato all'anagrafica (identita' cliente), non
-- alla pratica. La pratica_id e' solo riferimento di origine
-- (in quale pratica e' stato raccolto). Cosi' lo stesso consenso
-- copre tutte le pratiche future dello stesso cliente nei 48 mesi.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1) Tabella vendita_consensi_privacy
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendita_consensi_privacy (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Cliente di riferimento (identita' del consenso)
    anagrafica_id uuid NOT NULL REFERENCES public.anagrafica(id) ON DELETE CASCADE,

    -- Pratica in cui e' stato raccolto (solo riferimento, no cascade)
    pratica_id uuid NULL REFERENCES public.vendita_pratiche(id) ON DELETE SET NULL,

    -- Modalita' raccolta: OTP via SMS oppure cartaceo (scansione)
    modalita text NOT NULL,

    -- Cellulare usato per l'OTP (puo' differire da anagrafica.cellulare)
    -- NULL per modalita='cartaceo'
    cellulare_usato text NULL,

    -- OTP: hash + salt, mai in chiaro. NULL per modalita='cartaceo'.
    otp_hash text NULL,
    otp_salt text NULL,
    otp_inviato_at timestamptz NULL,
    otp_scade_at timestamptz NULL,
    otp_confermato_at timestamptz NULL,
    otp_tentativi int NOT NULL DEFAULT 0,
    otp_reinvii int NOT NULL DEFAULT 0,

    -- ID messaggio Smshosting (audit trail)
    sms_provider_id text NULL,

    -- Stato workflow
    stato text NOT NULL DEFAULT 'pending',

    -- Versione informativa mostrata (es. 'v1_2026_06_25')
    informativa_versione text NOT NULL,
    -- SHA256 del PDF finale generato (integrita' del documento)
    informativa_hash text NULL,

    -- Consenso base (informativa GDPR) - obbligatorio per generare la pratica
    consenso_contratto boolean NOT NULL DEFAULT true,
    -- Consenso marketing - opzionale (ricontatto telefonico per nuove offerte)
    consenso_marketing boolean NOT NULL DEFAULT false,

    -- Validita': popolato a confermato_at = now() + 48 mesi
    valido_fino_al timestamptz NULL,

    -- Storage PDF finale (bucket privato consensi-privacy)
    pdf_storage_path text NULL,
    pdf_filename text NULL,

    -- Snapshot dati anagrafica al momento del consenso (audit)
    snapshot_anagrafica jsonb NULL,

    -- Operatore + metadata di contesto
    operatore_id uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL,
    ip_operatore text NULL,
    user_agent_operatore text NULL,

    -- Revoca (gestita manualmente da admin)
    revocato_at timestamptz NULL,
    revocato_motivo text NULL,
    revocato_da uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Trigger auto-update updated_at
CREATE OR REPLACE FUNCTION public.vendita_consensi_privacy_touch_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vendita_consensi_privacy_updated_at ON public.vendita_consensi_privacy;
CREATE TRIGGER trg_vendita_consensi_privacy_updated_at
    BEFORE UPDATE ON public.vendita_consensi_privacy
    FOR EACH ROW EXECUTE FUNCTION public.vendita_consensi_privacy_touch_updated_at();

-- -------------------------------------------------------------
-- 2) CHECK constraints
-- -------------------------------------------------------------
ALTER TABLE public.vendita_consensi_privacy
    DROP CONSTRAINT IF EXISTS vcp_modalita_chk;
ALTER TABLE public.vendita_consensi_privacy
    ADD CONSTRAINT vcp_modalita_chk
    CHECK (modalita IN ('otp_sms','cartaceo'));

ALTER TABLE public.vendita_consensi_privacy
    DROP CONSTRAINT IF EXISTS vcp_stato_chk;
ALTER TABLE public.vendita_consensi_privacy
    ADD CONSTRAINT vcp_stato_chk
    CHECK (stato IN ('pending','confermato','scaduto','fallito','revocato'));

-- OTP SMS: cellulare obbligatorio
ALTER TABLE public.vendita_consensi_privacy
    DROP CONSTRAINT IF EXISTS vcp_otp_requires_cellulare_chk;
ALTER TABLE public.vendita_consensi_privacy
    ADD CONSTRAINT vcp_otp_requires_cellulare_chk
    CHECK (modalita <> 'otp_sms' OR cellulare_usato IS NOT NULL);

-- Confermato: deve avere valido_fino_al + pdf_storage_path
ALTER TABLE public.vendita_consensi_privacy
    DROP CONSTRAINT IF EXISTS vcp_confermato_completo_chk;
ALTER TABLE public.vendita_consensi_privacy
    ADD CONSTRAINT vcp_confermato_completo_chk
    CHECK (
        stato <> 'confermato'
        OR (valido_fino_al IS NOT NULL AND pdf_storage_path IS NOT NULL)
    );

-- -------------------------------------------------------------
-- 3) Indici
-- -------------------------------------------------------------
-- Lookup dedupe: per anagrafica, consenso confermato e non scaduto
CREATE INDEX IF NOT EXISTS idx_vcp_anagrafica_valido
    ON public.vendita_consensi_privacy (anagrafica_id, valido_fino_al DESC)
    WHERE stato = 'confermato' AND revocato_at IS NULL;

-- Cleanup pending vecchi (cron giornaliero)
CREATE INDEX IF NOT EXISTS idx_vcp_pending_scadenza
    ON public.vendita_consensi_privacy (otp_scade_at)
    WHERE stato = 'pending';

-- Drill-down per pratica
CREATE INDEX IF NOT EXISTS idx_vcp_pratica
    ON public.vendita_consensi_privacy (pratica_id)
    WHERE pratica_id IS NOT NULL;

-- -------------------------------------------------------------
-- 4) RLS — pattern Mirox: SELECT a tutti gli authenticated,
--    mutazioni solo via service_role (functions Netlify).
-- -------------------------------------------------------------
ALTER TABLE public.vendita_consensi_privacy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendita_consensi_privacy_authenticated_select
    ON public.vendita_consensi_privacy;
CREATE POLICY vendita_consensi_privacy_authenticated_select
    ON public.vendita_consensi_privacy
    FOR SELECT
    TO authenticated
    USING (true);

-- -------------------------------------------------------------
-- 5) Comments per documentazione introspect
-- -------------------------------------------------------------
COMMENT ON TABLE public.vendita_consensi_privacy IS
    'Consensi privacy GDPR raccolti dal wizard upload-contratti-vendita. Modalita'' OTP via SMS o cartaceo (scansione modulo firmato). Validi 48 mesi. Vedi CLAUDE.md "Sistema consensi privacy".';
COMMENT ON COLUMN public.vendita_consensi_privacy.modalita IS
    'otp_sms (firma elettronica semplice + SMS) | cartaceo (modulo PDF firmato a mano e scansionato)';
COMMENT ON COLUMN public.vendita_consensi_privacy.stato IS
    'pending (in attesa OTP) | confermato (valido) | scaduto (OTP non confermato in tempo) | fallito (max tentativi superati) | revocato (revoca esplicita cliente)';
COMMENT ON COLUMN public.vendita_consensi_privacy.otp_hash IS
    'SHA256(otp || salt). Mai in chiaro. Verifica via re-hash del codice inserito.';
COMMENT ON COLUMN public.vendita_consensi_privacy.valido_fino_al IS
    'Confermato_at + 48 mesi. Usato dalla check-consenso-privacy per dedupe.';
COMMENT ON COLUMN public.vendita_consensi_privacy.informativa_versione IS
    'Versione testo informativa mostrata al cliente (es. v1_2026_06_25). Permette di tracciare quale testo ha visto se il template viene aggiornato.';
COMMENT ON COLUMN public.vendita_consensi_privacy.informativa_hash IS
    'SHA256 del PDF finale generato. Garantisce integrita'' del documento (qualunque modifica al PDF nel bucket invalida l''hash).';
COMMENT ON COLUMN public.vendita_consensi_privacy.consenso_marketing IS
    'Opzionale: consenso al ricontatto telefonico per nuove offerte commerciali. Separato dal consenso al trattamento (obbligatorio).';

-- -------------------------------------------------------------
-- 6) Bucket Storage consensi-privacy (privato)
-- -------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'consensi-privacy',
    'consensi-privacy',
    false,
    20971520,  -- 20 MB
    ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 20971520,
    allowed_mime_types = ARRAY['application/pdf']::text[];

-- Policy: SELECT authenticated (lettura via signed URL on-demand)
DROP POLICY IF EXISTS "Read auth consensi privacy" ON storage.objects;
CREATE POLICY "Read auth consensi privacy"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'consensi-privacy');

-- Niente INSERT/UPDATE/DELETE policy: le scritture passano per le
-- Netlify functions con service_role (bypass RLS).

COMMIT;
