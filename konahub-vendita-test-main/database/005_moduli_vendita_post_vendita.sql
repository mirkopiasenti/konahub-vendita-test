-- =============================================================================
-- 005 - Moduli Vendita / Post-Vendita
-- Crea le tabelle per: apri_chiudi, switch_sim, ordini_smartphone,
--                      simulatore_protecta, dispositivi_comodato, gestione_rimborsi
-- (segnalazioni esiste già)
-- =============================================================================

BEGIN;

-- =============================================================================
-- VENDITA - APRI / CHIUDI LINEA
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.vendita_apri_chiudi (
    id                    bigserial PRIMARY KEY,
    data_inserimento      timestamptz NOT NULL DEFAULT now(),
    operatore_id          uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL,
    operatore_nome        text NULL,
    stato                 text NOT NULL DEFAULT 'IN CORSO'
                          CHECK (stato IN ('IN CORSO','KO','CHIUSO')),

    -- Vecchio intestatario
    cluster_vecchio          text,
    ragione_sociale_vecchio  text,
    cf_piva_vecchio          text,

    -- Nuovo intestatario
    cluster_nuovo            text,
    ragione_sociale_nuovo    text,
    cf_piva_nuovo            text,

    sim_disattivare       text CHECK (sim_disattivare IN ('SI','NO')) DEFAULT 'NO',
    numero_sim            text,
    chiusura_linea        text CHECK (chiusura_linea IN ('IMMEDIATA','ATTENDERE')),
    note                  text,

    -- Dati disdetta (compilati in fase di chiusura)
    data_invio_disdetta   date,
    numero_ask            text,

    cartella_url          text,  -- compat. Drive (deprecato, opzionale)
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendita_apri_chiudi_stato      ON public.vendita_apri_chiudi(stato);
CREATE INDEX IF NOT EXISTS idx_vendita_apri_chiudi_operatore  ON public.vendita_apri_chiudi(operatore_id);
CREATE INDEX IF NOT EXISTS idx_vendita_apri_chiudi_data       ON public.vendita_apri_chiudi(data_inserimento DESC);


-- =============================================================================
-- VENDITA - SWITCH SIM
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.vendita_switch_sim (
    id                                 bigserial PRIMARY KEY,
    stato                              text NOT NULL DEFAULT 'ATTESA ATTIVAZIONE SIM'
                                       CHECK (stato IN ('ATTESA ATTIVAZIONE SIM','IN CORSO','CHIUSO','KO')),
    data_inserimento                   timestamptz NOT NULL DEFAULT now(),
    operatore_id                       uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL,
    operatore_nome                     text NULL,
    gestore                            text,  -- es. OPTIMA, E-MOBILE

    -- Intestatari
    ragione_sociale_attuale            text,
    cf_piva_attuale                    text,
    ragione_sociale_rientro            text,
    cf_piva_rientro                    text,

    -- Identificativi SIM
    numero_portabilita                 text,
    iccid_sim                          text,
    numero_provvisorio                 text,
    sim_definitiva_rientro             text,

    -- Date attivazione/portabilità
    giorno_attivazione                 date,
    giorno_portabilita                 date,
    giorno_rientro                     date,

    -- Ricariche
    prima_ricarica_giorno_pianificato  date,
    prima_ricarica_data_esecuzione     date,
    prima_ricarica_importo             numeric(10,2),
    seconda_ricarica_giorno_pianificato date,
    seconda_ricarica_data_esecuzione   date,
    seconda_ricarica_importo           numeric(10,2),

    offerta_rientro                    text,
    modalita_pagamento                 text,
    importo                            numeric(10,2),
    note                               text,

    cartella_url                       text,
    created_at                         timestamptz NOT NULL DEFAULT now(),
    updated_at                         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendita_switch_sim_stato     ON public.vendita_switch_sim(stato);
CREATE INDEX IF NOT EXISTS idx_vendita_switch_sim_operatore ON public.vendita_switch_sim(operatore_id);
CREATE INDEX IF NOT EXISTS idx_vendita_switch_sim_data      ON public.vendita_switch_sim(data_inserimento DESC);


-- =============================================================================
-- VENDITA - ORDINI SMARTPHONE
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.vendita_ordini_smartphone (
    id                  bigserial PRIMARY KEY,
    codice_ordine       text UNIQUE,  -- es. ORD-00013
    data_registrazione  timestamptz NOT NULL DEFAULT now(),
    operatore_id        uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL,
    operatore_nome      text NULL,

    nome_cognome        text NOT NULL,
    numero_cellulare    text,

    marca               text,        -- es. iPhone, Samsung, Xiaomi
    modello             text,
    memoria             text,        -- es. 128GB, 256GB
    colorazione         text,
    note                text,

    stato               text NOT NULL DEFAULT 'In attesa'
                        CHECK (stato IN ('In attesa','Ordinato','Venduto','Annullato')),

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendita_ordini_stato     ON public.vendita_ordini_smartphone(stato);
CREATE INDEX IF NOT EXISTS idx_vendita_ordini_operatore ON public.vendita_ordini_smartphone(operatore_id);
CREATE INDEX IF NOT EXISTS idx_vendita_ordini_data      ON public.vendita_ordini_smartphone(data_registrazione DESC);

-- Sequence per codice ordine
CREATE SEQUENCE IF NOT EXISTS vendita_ordini_smartphone_seq START 1;
CREATE OR REPLACE FUNCTION public.genera_codice_ordine_smartphone()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    n int;
BEGIN
    n := nextval('vendita_ordini_smartphone_seq');
    RETURN 'ORD-' || LPAD(n::text, 5, '0');
END;
$$;


-- =============================================================================
-- VENDITA - SIMULATORE PROTECTA (preventivi)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.vendita_simulatore_protecta (
    id                  bigserial PRIMARY KEY,
    data_preventivo     timestamptz NOT NULL DEFAULT now(),
    operatore_id        uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL,
    operatore_nome      text NULL,

    cliente             text NOT NULL,
    numero_cellulare    text,

    kit                 text NOT NULL,   -- es. 'Kit Casa', 'Kit Business'
    stato               text NOT NULL DEFAULT 'In corso'
                        CHECK (stato IN ('In corso','Vinto','Perso')),
    preventivo_payload  jsonb,           -- snapshot dati preventivo
    preventivo_pdf_url  text,            -- URL PDF su Supabase Storage

    note                text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendita_protecta_stato     ON public.vendita_simulatore_protecta(stato);
CREATE INDEX IF NOT EXISTS idx_vendita_protecta_operatore ON public.vendita_simulatore_protecta(operatore_id);
CREATE INDEX IF NOT EXISTS idx_vendita_protecta_data      ON public.vendita_simulatore_protecta(data_preventivo DESC);


-- =============================================================================
-- POST-VENDITA - DISPOSITIVI IN COMODATO
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.post_vendita_dispositivi_comodato (
    id                bigserial PRIMARY KEY,
    codice            text UNIQUE,  -- es. DISP-1776791725542
    nome              text NOT NULL,
    cognome           text NOT NULL,
    codice_fiscale    text,
    telefono          text,
    imei              text NOT NULL,
    sim_temporanea    text,

    data_uscita       date NOT NULL,
    data_rientro      date,
    operatore_uscita_id   uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL,
    operatore_uscita_nome text,
    operatore_rientro_id  uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL,
    operatore_rientro_nome text,

    stato             text NOT NULL DEFAULT 'fuori'
                      CHECK (stato IN ('fuori','rientrato')),

    note_uscita       text,
    note_rientro      text,
    cartella_url      text,

    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pv_comodato_stato ON public.post_vendita_dispositivi_comodato(stato);
CREATE INDEX IF NOT EXISTS idx_pv_comodato_cf    ON public.post_vendita_dispositivi_comodato(codice_fiscale);
CREATE INDEX IF NOT EXISTS idx_pv_comodato_nome  ON public.post_vendita_dispositivi_comodato(nome, cognome);

-- Generatore codice DISP-
CREATE OR REPLACE FUNCTION public.genera_codice_comodato()
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    RETURN 'DISP-' || (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint::text;
END;
$$;


-- =============================================================================
-- POST-VENDITA - GESTIONE RIMBORSI
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.post_vendita_gestione_rimborsi (
    id                  bigserial PRIMARY KEY,
    codice              text UNIQUE,           -- ID interno (es. RIMB-00001)
    nome                text NOT NULL,
    cognome             text NOT NULL,
    sesso               text CHECK (sesso IN ('M','F')),
    codice_fiscale      text,
    importo             numeric(10,2) NOT NULL,
    id_contratto        text,
    motivazione         text,
    note_interne        text,

    data_creazione      timestamptz NOT NULL DEFAULT now(),
    stato               text NOT NULL DEFAULT 'Aperto'
                        CHECK (stato IN ('Aperto','In Lavorazione','Consegnato','Annullato')),

    cartella_url        text,
    pdf_firmato_url     text,
    data_consegna       date,
    note_aggiuntive     text,

    operatore_id        uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL,
    operatore_nome      text NULL,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pv_rimborsi_stato ON public.post_vendita_gestione_rimborsi(stato);
CREATE INDEX IF NOT EXISTS idx_pv_rimborsi_cf    ON public.post_vendita_gestione_rimborsi(codice_fiscale);
CREATE INDEX IF NOT EXISTS idx_pv_rimborsi_data  ON public.post_vendita_gestione_rimborsi(data_creazione DESC);

CREATE SEQUENCE IF NOT EXISTS post_vendita_rimborsi_seq START 1;
CREATE OR REPLACE FUNCTION public.genera_codice_rimborso()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    n int;
BEGIN
    n := nextval('post_vendita_rimborsi_seq');
    RETURN 'RIMB-' || LPAD(n::text, 5, '0');
END;
$$;


-- =============================================================================
-- TRIGGER updated_at su tutte le tabelle nuove
-- =============================================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'vendita_apri_chiudi',
        'vendita_switch_sim',
        'vendita_ordini_smartphone',
        'vendita_simulatore_protecta',
        'post_vendita_dispositivi_comodato',
        'post_vendita_gestione_rimborsi'
    ])
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I;', 'trg_' || t || '_touch', t);
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();', 'trg_' || t || '_touch', t);
    END LOOP;
END;
$$;


-- =============================================================================
-- RLS: abilita e crea policy permissive per utenti autenticati
-- =============================================================================
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'vendita_apri_chiudi',
        'vendita_switch_sim',
        'vendita_ordini_smartphone',
        'vendita_simulatore_protecta',
        'post_vendita_dispositivi_comodato',
        'post_vendita_gestione_rimborsi'
    ])
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_authenticated_all', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true);',
            t || '_authenticated_all', t
        );
    END LOOP;
END;
$$;

-- =============================================================================
-- STORAGE: bucket suggeriti (creare manualmente da Dashboard Supabase se non esistono)
--   - apri-chiudi-files       (allegati doc identità vecchio/nuovo, fisso, sim)
--   - switch-sim-files
--   - protecta-files          (PDF preventivi)
--   - comodato-files          (foto, doc identità)
--   - rimborsi-files          (PDF firmato)
-- =============================================================================

COMMIT;
