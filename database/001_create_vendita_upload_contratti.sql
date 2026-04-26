-- Migrazione iniziale area vendita/upload contratti KonaHub.
-- Punteggi ufficiali:
--   punteggio_gara = obbligatorio/primario
--   punteggio_extra_gara = opzionale, default 0

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS vendita_categorie (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome text NOT NULL UNIQUE,
    descrizione text,
    attiva boolean NOT NULL DEFAULT true,
    ordine integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendita_offerte (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    categoria_id uuid NOT NULL REFERENCES vendita_categorie(id),
    cluster_cliente text NOT NULL CHECK (cluster_cliente IN ('Consumer', 'Business')),
    nome_offerta text NOT NULL,
    descrizione text,
    punteggio_gara numeric(10,2) NOT NULL DEFAULT 0,
    punteggio_extra_gara numeric(10,2) NOT NULL DEFAULT 0,
    attiva boolean NOT NULL DEFAULT true,
    valid_from date,
    valid_to date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendita_offerte_categoria_cluster_nome
    ON vendita_offerte (categoria_id, cluster_cliente, nome_offerta);

CREATE TABLE IF NOT EXISTS vendita_opzioni (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    categoria_id uuid REFERENCES vendita_categorie(id),
    offerta_id uuid REFERENCES vendita_offerte(id),
    cluster_cliente text NOT NULL CHECK (cluster_cliente IN ('Consumer', 'Business')),
    nome_opzione text NOT NULL,
    descrizione text,
    punteggio_gara numeric(10,2) NOT NULL DEFAULT 0,
    punteggio_extra_gara numeric(10,2) NOT NULL DEFAULT 0,
    attiva boolean NOT NULL DEFAULT true,
    valid_from date,
    valid_to date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendita_reload (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome text NOT NULL UNIQUE,
    attivo boolean NOT NULL DEFAULT true,
    ordine integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendita_pratiche (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    anagrafica_id uuid NOT NULL REFERENCES anagrafica(id),
    appuntamento_id uuid NULL,
    chiamata_id uuid NULL,
    operatore_id uuid NULL,
    data_pratica timestamptz NOT NULL DEFAULT now(),
    origine_pratica text NOT NULL DEFAULT 'spontaneo',
    stato_pratica text NOT NULL DEFAULT 'bozza',
    nome_cartella_storage text,
    storage_base_path text,
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid,
    updated_by uuid,
    CONSTRAINT vendita_pratiche_origine_pratica_chk CHECK (origine_pratica IN ('appuntamento_callcenter','contatto_callcenter_entro_10_giorni','spontaneo')),
    CONSTRAINT vendita_pratiche_stato_pratica_chk CHECK (stato_pratica IN ('bozza','inviata','annullata'))
);

CREATE TABLE IF NOT EXISTS vendita_contratti (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pratica_id uuid NOT NULL REFERENCES vendita_pratiche(id) ON DELETE CASCADE,
    anagrafica_id uuid NOT NULL REFERENCES anagrafica(id),
    appuntamento_id uuid NULL,
    chiamata_id uuid NULL,
    operatore_id uuid NULL,
    data_contratto timestamptz NOT NULL DEFAULT now(),
    cluster_cliente text CHECK (cluster_cliente IS NULL OR cluster_cliente IN ('Consumer', 'Business')),
    categoria_id uuid REFERENCES vendita_categorie(id),
    offerta_id uuid REFERENCES vendita_offerte(id),
    opzione_id uuid REFERENCES vendita_opzioni(id),
    reload_id uuid REFERENCES vendita_reload(id),
    categoria_snapshot text,
    nome_offerta_snapshot text,
    nome_opzione_snapshot text,
    nome_reload_snapshot text,
    punteggio_gara_offerta numeric(10,2) NOT NULL DEFAULT 0,
    punteggio_gara_opzione numeric(10,2) NOT NULL DEFAULT 0,
    punteggio_gara_totale numeric(10,2) NOT NULL DEFAULT 0,
    punteggio_extra_gara_offerta numeric(10,2) NOT NULL DEFAULT 0,
    punteggio_extra_gara_opzione numeric(10,2) NOT NULL DEFAULT 0,
    punteggio_extra_gara_totale numeric(10,2) NOT NULL DEFAULT 0,
    punteggio_offerta numeric(10,2) NOT NULL DEFAULT 0,
    punteggio_opzione numeric(10,2) NOT NULL DEFAULT 0,
    punteggio_extra numeric(10,2) NOT NULL DEFAULT 0,
    punteggio_totale numeric(10,2) NOT NULL DEFAULT 0,
    tipo_attivazione text,
    apri_chiudi text,
    intestatario text,
    switch_sim text,
    modalita_pagamento text,
    dispositivo_associato boolean NOT NULL DEFAULT false,
    imei text,
    fascia_prezzo text,
    tipo_acquisto text,
    finanziaria text,
    kolme boolean,
    stato_controllo text NOT NULL DEFAULT 'da_controllare',
    controllato_da uuid,
    controllato_at timestamptz,
    note_controllo text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid,
    updated_by uuid,
    CONSTRAINT vendita_contratti_stato_controllo_chk CHECK (stato_controllo IN ('da_controllare','controllato','errore','annullato'))
);

CREATE TABLE IF NOT EXISTS vendita_documenti (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pratica_id uuid NOT NULL REFERENCES vendita_pratiche(id) ON DELETE CASCADE,
    contratto_id uuid REFERENCES vendita_contratti(id) ON DELETE CASCADE,
    anagrafica_id uuid NOT NULL REFERENCES anagrafica(id),
    tipo_documento text NOT NULL,
    storage_bucket text NOT NULL DEFAULT 'contratti-vendita',
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text,
    file_size bigint,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    uploaded_by uuid
);

CREATE TABLE IF NOT EXISTS vendita_documenti_regole (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    categoria_id uuid REFERENCES vendita_categorie(id),
    offerta_id uuid REFERENCES vendita_offerte(id),
    opzione_id uuid REFERENCES vendita_opzioni(id),
    campo_condizione text,
    valore_condizione text,
    tipo_documento text NOT NULL,
    obbligatorio boolean NOT NULL DEFAULT true,
    attiva boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendita_compensi_regole (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    categoria_id uuid REFERENCES vendita_categorie(id),
    nome_regola text NOT NULL,
    tipo_calcolo text NOT NULL DEFAULT 'pezzi',
    min_pezzi integer,
    max_pezzi integer,
    min_punteggio numeric(10,2),
    max_punteggio numeric(10,2),
    compenso_euro numeric(10,2) NOT NULL DEFAULT 0,
    mese_riferimento date,
    attiva boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT vendita_compensi_regole_tipo_calcolo_chk CHECK (tipo_calcolo IN ('pezzi','punteggio','misto'))
);

CREATE TABLE IF NOT EXISTS vendita_log_modifiche (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tabella text NOT NULL,
    record_id uuid NOT NULL,
    azione text NOT NULL,
    dati_precedenti jsonb,
    dati_nuovi jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_vendita_pratiche_anagrafica_id ON vendita_pratiche(anagrafica_id);
CREATE INDEX IF NOT EXISTS idx_vendita_pratiche_data_pratica ON vendita_pratiche(data_pratica);
CREATE INDEX IF NOT EXISTS idx_vendita_pratiche_origine_pratica ON vendita_pratiche(origine_pratica);
CREATE INDEX IF NOT EXISTS idx_vendita_contratti_pratica_id ON vendita_contratti(pratica_id);
CREATE INDEX IF NOT EXISTS idx_vendita_contratti_anagrafica_id ON vendita_contratti(anagrafica_id);
CREATE INDEX IF NOT EXISTS idx_vendita_contratti_data_contratto ON vendita_contratti(data_contratto);
CREATE INDEX IF NOT EXISTS idx_vendita_contratti_stato_controllo ON vendita_contratti(stato_controllo);
CREATE INDEX IF NOT EXISTS idx_vendita_contratti_categoria_id ON vendita_contratti(categoria_id);
CREATE INDEX IF NOT EXISTS idx_vendita_contratti_operatore_id ON vendita_contratti(operatore_id);
CREATE INDEX IF NOT EXISTS idx_vendita_documenti_pratica_id ON vendita_documenti(pratica_id);
CREATE INDEX IF NOT EXISTS idx_vendita_documenti_contratto_id ON vendita_documenti(contratto_id);
CREATE INDEX IF NOT EXISTS idx_vendita_documenti_anagrafica_id ON vendita_documenti(anagrafica_id);

CREATE OR REPLACE FUNCTION vendita_update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION vendita_calcola_punteggio_totale()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.punteggio_gara_totale = coalesce(NEW.punteggio_gara_offerta, 0) + coalesce(NEW.punteggio_gara_opzione, 0);
    NEW.punteggio_extra_gara_totale = coalesce(NEW.punteggio_extra_gara_offerta, 0) + coalesce(NEW.punteggio_extra_gara_opzione, 0);
    NEW.punteggio_offerta = coalesce(NEW.punteggio_gara_offerta, 0);
    NEW.punteggio_opzione = coalesce(NEW.punteggio_gara_opzione, 0);
    NEW.punteggio_extra = 0;
    NEW.punteggio_totale = NEW.punteggio_gara_totale;
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_vendita_contratti_calcola_punteggio_totale') THEN
        CREATE TRIGGER trg_vendita_contratti_calcola_punteggio_totale
        BEFORE INSERT OR UPDATE ON vendita_contratti
        FOR EACH ROW
        EXECUTE FUNCTION vendita_calcola_punteggio_totale();
    END IF;
END;
$$;

INSERT INTO vendita_categorie (nome, ordine)
VALUES ('Mobile', 10), ('Customer Base', 20), ('Fisso', 30), ('Energia', 40), ('Assicurazioni', 50), ('Allarmi', 60)
ON CONFLICT (nome) DO NOTHING;

DROP VIEW IF EXISTS view_vendita_dashboard_giornaliera;
DROP VIEW IF EXISTS view_vendita_dashboard_mensile;

CREATE VIEW view_vendita_dashboard_giornaliera AS
SELECT
    date_trunc('day', data_contratto)::date AS giorno,
    operatore_id,
    categoria_snapshot,
    count(*) AS pezzi,
    coalesce(sum(punteggio_gara_totale), 0)::numeric(10,2) AS punteggio_gara_totale,
    coalesce(sum(punteggio_extra_gara_totale), 0)::numeric(10,2) AS punteggio_extra_gara_totale,
    coalesce(sum(punteggio_totale), 0)::numeric(10,2) AS punteggio_totale
FROM vendita_contratti
WHERE stato_controllo IN ('da_controllare', 'controllato')
GROUP BY 1, 2, 3;

CREATE VIEW view_vendita_dashboard_mensile AS
SELECT
    date_trunc('month', data_contratto)::date AS mese,
    operatore_id,
    categoria_snapshot,
    count(*) AS pezzi,
    coalesce(sum(punteggio_gara_totale), 0)::numeric(10,2) AS punteggio_gara_totale,
    coalesce(sum(punteggio_extra_gara_totale), 0)::numeric(10,2) AS punteggio_extra_gara_totale,
    coalesce(sum(punteggio_totale), 0)::numeric(10,2) AS punteggio_totale
FROM vendita_contratti
WHERE stato_controllo IN ('da_controllare', 'controllato')
GROUP BY 1, 2, 3;

COMMIT;
