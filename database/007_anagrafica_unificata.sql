-- =============================================================================
-- 007 - Anagrafica unificata: aggancio dei moduli a `anagrafica` via UUID
--
-- Cosa fa questa migration:
--   1. Crea la funzione RPC `cerca_o_crea_anagrafica` (atomica, no race)
--   2. Aggiunge le colonne FK + snapshot a 5 tabelle modulo:
--        - vendita_ordini_smartphone        (1 anagrafica)
--        - post_vendita_dispositivi_comodato (1 anagrafica)
--        - post_vendita_gestione_rimborsi    (1 anagrafica)
--        - vendita_apri_chiudi               (2 anagrafiche: vecchio + nuovo)
--        - vendita_switch_sim                (2 anagrafiche: attuale + rientro)
--
-- I record già esistenti restano con anagrafica_id NULL e i campi snapshot
-- testuali già presenti (es. nome_cognome, ragione_sociale_attuale, ecc.).
-- Per i nuovi record la logica HTML popolerà sempre l'anagrafica_id.
-- =============================================================================

BEGIN;

-- =============================================================================
-- FUNZIONE: cerca_o_crea_anagrafica
-- Cerca per cf_piva (case-insensitive). Se esiste, ritorna l'UUID.
-- Se non esiste, inserisce un nuovo record con i dati passati e ritorna l'UUID.
-- Aggiorna campi mancanti se l'anagrafica esiste ma sono vuoti (best-effort merge).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cerca_o_crea_anagrafica(
    p_cf_piva           text,
    p_cluster           text,
    p_ragione_sociale   text,
    p_nome_referente    text DEFAULT NULL,
    p_cellulare         text DEFAULT NULL,
    p_provincia         text DEFAULT NULL,
    p_comune            text DEFAULT NULL,
    p_via               text DEFAULT NULL,
    p_civico            text DEFAULT NULL,
    p_creato_da         uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cf_piva_norm text;
    v_id           uuid;
BEGIN
    v_cf_piva_norm := UPPER(TRIM(COALESCE(p_cf_piva, '')));

    IF v_cf_piva_norm = '' THEN
        RAISE EXCEPTION 'cf_piva obbligatorio';
    END IF;

    IF COALESCE(TRIM(p_cluster), '') = '' THEN
        RAISE EXCEPTION 'cluster obbligatorio';
    END IF;

    IF COALESCE(TRIM(p_ragione_sociale), '') = '' THEN
        RAISE EXCEPTION 'ragione_sociale obbligatorio';
    END IF;

    -- Cerca esistente (case-insensitive)
    SELECT id INTO v_id
    FROM public.anagrafica
    WHERE UPPER(TRIM(cf_piva)) = v_cf_piva_norm
    LIMIT 1;

    IF FOUND THEN
        -- Esiste già: completa solo i campi vuoti con i nuovi valori (best-effort).
        UPDATE public.anagrafica
        SET
            cluster         = COALESCE(NULLIF(TRIM(cluster), ''), p_cluster),
            ragione_sociale = COALESCE(NULLIF(TRIM(ragione_sociale), ''), p_ragione_sociale),
            nome_referente  = COALESCE(NULLIF(TRIM(nome_referente), ''), p_nome_referente),
            cellulare       = COALESCE(NULLIF(TRIM(cellulare), ''), p_cellulare),
            provincia       = COALESCE(NULLIF(TRIM(provincia), ''), p_provincia),
            comune          = COALESCE(NULLIF(TRIM(comune), ''), p_comune),
            via             = COALESCE(NULLIF(TRIM(via), ''), p_via),
            civico          = COALESCE(NULLIF(TRIM(civico), ''), p_civico),
            updated_at      = now()
        WHERE id = v_id;
        RETURN v_id;
    END IF;

    -- Non esiste: crea
    INSERT INTO public.anagrafica
        (cf_piva, cluster, ragione_sociale, nome_referente, cellulare, provincia, comune, via, civico, creato_da)
    VALUES
        (v_cf_piva_norm, p_cluster, p_ragione_sociale, p_nome_referente, p_cellulare, p_provincia, p_comune, p_via, p_civico, p_creato_da)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- Permessi: utenti autenticati possono chiamare la funzione
GRANT EXECUTE ON FUNCTION public.cerca_o_crea_anagrafica(text, text, text, text, text, text, text, text, text, uuid) TO authenticated;


-- =============================================================================
-- FUNZIONE: ricerca_anagrafica (multi-criterio per pagina Storico Cliente)
-- Cerca per CF/PIVA, ragione sociale, nome referente, cellulare (case-insensitive).
-- Tutti i parametri sono opzionali; almeno uno deve essere non vuoto.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ricerca_anagrafica(
    p_query text DEFAULT NULL
)
RETURNS SETOF public.anagrafica
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_q text;
BEGIN
    v_q := TRIM(COALESCE(p_query, ''));
    IF v_q = '' THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT *
    FROM public.anagrafica
    WHERE
        cf_piva ILIKE ('%' || v_q || '%')
        OR ragione_sociale ILIKE ('%' || v_q || '%')
        OR nome_referente ILIKE ('%' || v_q || '%')
        OR cellulare ILIKE ('%' || v_q || '%')
    ORDER BY ragione_sociale ASC
    LIMIT 50;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ricerca_anagrafica(text) TO authenticated;


-- =============================================================================
-- ALTER TABLE: vendita_ordini_smartphone
-- =============================================================================
ALTER TABLE public.vendita_ordini_smartphone
    ADD COLUMN IF NOT EXISTS anagrafica_id uuid NULL REFERENCES public.anagrafica(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cf_piva_snapshot text;

CREATE INDEX IF NOT EXISTS idx_vendita_ordini_anagrafica ON public.vendita_ordini_smartphone(anagrafica_id);


-- =============================================================================
-- ALTER TABLE: post_vendita_dispositivi_comodato
-- =============================================================================
ALTER TABLE public.post_vendita_dispositivi_comodato
    ADD COLUMN IF NOT EXISTS anagrafica_id uuid NULL REFERENCES public.anagrafica(id) ON DELETE SET NULL;
-- nome, cognome, codice_fiscale, telefono già fungono da snapshot

CREATE INDEX IF NOT EXISTS idx_pv_comodato_anagrafica ON public.post_vendita_dispositivi_comodato(anagrafica_id);


-- =============================================================================
-- ALTER TABLE: post_vendita_gestione_rimborsi
-- =============================================================================
ALTER TABLE public.post_vendita_gestione_rimborsi
    ADD COLUMN IF NOT EXISTS anagrafica_id uuid NULL REFERENCES public.anagrafica(id) ON DELETE SET NULL;
-- nome, cognome, codice_fiscale già fungono da snapshot

CREATE INDEX IF NOT EXISTS idx_pv_rimborsi_anagrafica ON public.post_vendita_gestione_rimborsi(anagrafica_id);


-- =============================================================================
-- ALTER TABLE: vendita_apri_chiudi (2 intestatari: vecchio + nuovo)
-- =============================================================================
ALTER TABLE public.vendita_apri_chiudi
    ADD COLUMN IF NOT EXISTS anagrafica_vecchio_id uuid NULL REFERENCES public.anagrafica(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS anagrafica_nuovo_id   uuid NULL REFERENCES public.anagrafica(id) ON DELETE SET NULL;
-- ragione_sociale_vecchio, cf_piva_vecchio, ragione_sociale_nuovo, cf_piva_nuovo
-- restano come snapshot storico

CREATE INDEX IF NOT EXISTS idx_apri_chiudi_anagrafica_vecchio ON public.vendita_apri_chiudi(anagrafica_vecchio_id);
CREATE INDEX IF NOT EXISTS idx_apri_chiudi_anagrafica_nuovo   ON public.vendita_apri_chiudi(anagrafica_nuovo_id);


-- =============================================================================
-- ALTER TABLE: vendita_switch_sim (2 intestatari: attuale + rientro, rientro opzionale)
-- =============================================================================
ALTER TABLE public.vendita_switch_sim
    ADD COLUMN IF NOT EXISTS anagrafica_attuale_id uuid NULL REFERENCES public.anagrafica(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS anagrafica_rientro_id uuid NULL REFERENCES public.anagrafica(id) ON DELETE SET NULL;
-- ragione_sociale_attuale, cf_piva_attuale, ragione_sociale_rientro, cf_piva_rientro
-- restano come snapshot storico

CREATE INDEX IF NOT EXISTS idx_switch_anagrafica_attuale ON public.vendita_switch_sim(anagrafica_attuale_id);
CREATE INDEX IF NOT EXISTS idx_switch_anagrafica_rientro ON public.vendita_switch_sim(anagrafica_rientro_id);


-- =============================================================================
-- VISTA: storico_cliente
-- Aggrega tutte le operazioni di un cliente (per id anagrafica) come timeline.
-- Si userà nella pagina "Storico Cliente".
-- =============================================================================
CREATE OR REPLACE VIEW public.storico_cliente AS
    SELECT
        anagrafica_id,
        'ordine_smartphone'::text AS tipo,
        id::text                 AS record_id,
        codice_ordine            AS riferimento,
        data_registrazione       AS data_op,
        stato,
        marca || ' ' || modello || COALESCE(' ' || memoria, '') AS descrizione,
        operatore_nome
    FROM public.vendita_ordini_smartphone
    WHERE anagrafica_id IS NOT NULL

    UNION ALL

    SELECT
        anagrafica_id,
        'dispositivo_comodato',
        id::text,
        codice,
        data_uscita::timestamptz,
        stato,
        'IMEI: ' || COALESCE(imei,'-') || COALESCE(' • SIM: ' || sim_temporanea,''),
        operatore_uscita_nome
    FROM public.post_vendita_dispositivi_comodato
    WHERE anagrafica_id IS NOT NULL

    UNION ALL

    SELECT
        anagrafica_id,
        'rimborso',
        id::text,
        codice,
        data_creazione,
        stato,
        '€ ' || importo::text || COALESCE(' • ' || motivazione, ''),
        operatore_nome
    FROM public.post_vendita_gestione_rimborsi
    WHERE anagrafica_id IS NOT NULL

    UNION ALL

    SELECT
        anagrafica_vecchio_id AS anagrafica_id,
        'apri_chiudi_vecchio',
        id::text,
        numero_ask,
        data_inserimento,
        stato,
        'Cessione → ' || COALESCE(ragione_sociale_nuovo, '-'),
        operatore_nome
    FROM public.vendita_apri_chiudi
    WHERE anagrafica_vecchio_id IS NOT NULL

    UNION ALL

    SELECT
        anagrafica_nuovo_id AS anagrafica_id,
        'apri_chiudi_nuovo',
        id::text,
        numero_ask,
        data_inserimento,
        stato,
        'Subentro da → ' || COALESCE(ragione_sociale_vecchio, '-'),
        operatore_nome
    FROM public.vendita_apri_chiudi
    WHERE anagrafica_nuovo_id IS NOT NULL

    UNION ALL

    SELECT
        anagrafica_attuale_id AS anagrafica_id,
        'switch_sim_attuale',
        id::text,
        numero_portabilita,
        data_inserimento,
        stato,
        'MNP ' || COALESCE(numero_portabilita,'-') || COALESCE(' • Gestore ' || gestore, ''),
        operatore_nome
    FROM public.vendita_switch_sim
    WHERE anagrafica_attuale_id IS NOT NULL

    UNION ALL

    SELECT
        anagrafica_rientro_id AS anagrafica_id,
        'switch_sim_rientro',
        id::text,
        numero_portabilita,
        data_inserimento,
        stato,
        'Rientro SIM ' || COALESCE(numero_portabilita,'-'),
        operatore_nome
    FROM public.vendita_switch_sim
    WHERE anagrafica_rientro_id IS NOT NULL;

GRANT SELECT ON public.storico_cliente TO authenticated;

COMMIT;
