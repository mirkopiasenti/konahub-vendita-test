BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE vendita_categorie (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome text NOT NULL UNIQUE,
    descrizione text,
    attiva boolean NOT NULL DEFAULT true,
    ordine integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vendita_offerte (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    categoria_id uuid NOT NULL REFERENCES vendita_categorie(id),
    cluster_cliente text,
    nome_offerta text NOT NULL,
    descrizione text,
    punteggio_default numeric(10,2) NOT NULL DEFAULT 0,
    attiva boolean NOT NULL DEFAULT true,
    valid_from date,
    valid_to date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_vendita_offerte_categoria_cluster_nome
    ON vendita_offerte (categoria_id, coalesce(cluster_cliente, ''), nome_offerta);

CREATE TABLE vendita_opzioni (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    categoria_id uuid REFERENCES vendita_categorie(id),
    offerta_id uuid REFERENCES vendita_offerte(id),
    cluster_cliente text,
    nome_opzione text NOT NULL,
    descrizione text,
    punteggio_default numeric(10,2) NOT NULL DEFAULT 0,
    attiva boolean NOT NULL DEFAULT true,
    valid_from date,
    valid_to date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vendita_reload (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome text NOT NULL UNIQUE,
    attivo boolean NOT NULL DEFAULT true,
    ordine integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vendita_pratiche (
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
    CONSTRAINT vendita_pratiche_origine_pratica_chk CHECK (
        origine_pratica IN (
            'appuntamento_callcenter',
            'contatto_callcenter_entro_10_giorni',
            'spontaneo'
        )
    ),
    CONSTRAINT vendita_pratiche_stato_pratica_chk CHECK (
        stato_pratica IN ('bozza', 'inviata', 'annullata')
    )
);

CREATE TABLE vendita_contratti (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pratica_id uuid NOT NULL REFERENCES vendita_pratiche(id) ON DELETE CASCADE,
    anagrafica_id uuid NOT NULL REFERENCES anagrafica(id),
    appuntamento_id uuid NULL,
    chiamata_id uuid NULL,
    operatore_id uuid NULL,
    data_contratto timestamptz NOT NULL DEFAULT now(),

    cluster_cliente text,
    categoria_id uuid REFERENCES vendita_categorie(id),
    offerta_id uuid REFERENCES vendita_offerte(id),
    opzione_id uuid REFERENCES vendita_opzioni(id),
    reload_id uuid REFERENCES vendita_reload(id),

    categoria_snapshot text,
    nome_offerta_snapshot text,
    nome_opzione_snapshot text,
    nome_reload_snapshot text,

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
    CONSTRAINT vendita_contratti_stato_controllo_chk CHECK (
        stato_controllo IN ('da_controllare', 'controllato', 'errore', 'annullato')
    )
);

CREATE TABLE vendita_documenti (
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

CREATE TABLE vendita_documenti_regole (
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

CREATE TABLE vendita_compensi_regole (
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
    CONSTRAINT vendita_compensi_regole_tipo_calcolo_chk CHECK (
        tipo_calcolo IN ('pezzi', 'punteggio', 'misto')
    )
);

CREATE TABLE vendita_log_modifiche (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tabella text NOT NULL,
    record_id uuid NOT NULL,
    azione text NOT NULL,
    dati_precedenti jsonb,
    dati_nuovi jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid
);

CREATE INDEX idx_vendita_pratiche_anagrafica_id ON vendita_pratiche(anagrafica_id);
CREATE INDEX idx_vendita_pratiche_data_pratica ON vendita_pratiche(data_pratica);
CREATE INDEX idx_vendita_pratiche_origine_pratica ON vendita_pratiche(origine_pratica);

CREATE INDEX idx_vendita_contratti_pratica_id ON vendita_contratti(pratica_id);
CREATE INDEX idx_vendita_contratti_anagrafica_id ON vendita_contratti(anagrafica_id);
CREATE INDEX idx_vendita_contratti_data_contratto ON vendita_contratti(data_contratto);
CREATE INDEX idx_vendita_contratti_stato_controllo ON vendita_contratti(stato_controllo);
CREATE INDEX idx_vendita_contratti_categoria_id ON vendita_contratti(categoria_id);
CREATE INDEX idx_vendita_contratti_operatore_id ON vendita_contratti(operatore_id);

CREATE INDEX idx_vendita_documenti_pratica_id ON vendita_documenti(pratica_id);
CREATE INDEX idx_vendita_documenti_contratto_id ON vendita_documenti(contratto_id);
CREATE INDEX idx_vendita_documenti_anagrafica_id ON vendita_documenti(anagrafica_id);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendita_categorie_updated_at
BEFORE UPDATE ON vendita_categorie
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_vendita_offerte_updated_at
BEFORE UPDATE ON vendita_offerte
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_vendita_opzioni_updated_at
BEFORE UPDATE ON vendita_opzioni
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_vendita_reload_updated_at
BEFORE UPDATE ON vendita_reload
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_vendita_pratiche_updated_at
BEFORE UPDATE ON vendita_pratiche
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_vendita_contratti_updated_at
BEFORE UPDATE ON vendita_contratti
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_vendita_documenti_regole_updated_at
BEFORE UPDATE ON vendita_documenti_regole
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_vendita_compensi_regole_updated_at
BEFORE UPDATE ON vendita_compensi_regole
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

INSERT INTO vendita_categorie (nome, ordine)
VALUES
    ('Mobile', 10),
    ('Customer Base', 20),
    ('Fisso', 30),
    ('Energia', 40),
    ('Assicurazioni', 50),
    ('Allarmi', 60)
ON CONFLICT (nome) DO NOTHING;

CREATE OR REPLACE VIEW view_vendita_dashboard_giornaliera AS
SELECT
    date_trunc('day', data_contratto)::date AS giorno,
    operatore_id,
    categoria_snapshot,
    count(*) AS pezzi,
    coalesce(sum(punteggio_totale), 0)::numeric(10,2) AS punteggio_totale
FROM vendita_contratti
WHERE stato_controllo <> 'annullato'
GROUP BY 1, 2, 3;

CREATE OR REPLACE VIEW view_vendita_dashboard_mensile AS
SELECT
    date_trunc('month', data_contratto)::date AS mese,
    operatore_id,
    categoria_snapshot,
    count(*) AS pezzi,
    coalesce(sum(punteggio_totale), 0)::numeric(10,2) AS punteggio_totale
FROM vendita_contratti
WHERE stato_controllo <> 'annullato'
GROUP BY 1, 2, 3;

COMMIT;
