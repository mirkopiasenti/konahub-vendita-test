-- =============================================================================
-- Migration 013: aggiunge `vendita_contratti` alla view storico_cliente
-- =============================================================================
-- Estende la view `storico_cliente` (definita in 007) aggiungendo un UNION ALL
-- per i contratti di vendita (tabella `vendita_contratti`).
--
-- Tipi nuovi esposti:
--   - 'contratto_vendita'  → tutti i contratti, sia con stato_controllo
--                             = 'da_controllare' sia = 'controllato' (oltre
--                             a 'errore' e 'annullato' che riportiamo
--                             comunque per audit completo).
--
-- Il campo `descrizione` riassume: "<categoria> · <offerta>" (più opzione se
-- presente). Il campo `stato` riflette lo `stato_controllo` del contratto.
-- =============================================================================
BEGIN;

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
        created_at AS data_op,
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
    WHERE anagrafica_rientro_id IS NOT NULL

    UNION ALL

    -- Nuovo: contratti del modulo upload-contratti-vendita
    -- Stato esposto: stato_controllo ('da_controllare', 'controllato',
    -- 'errore', 'annullato'). Operatore: nome dal profilo (LEFT JOIN).
    SELECT
        c.anagrafica_id,
        'contratto_vendita'::text AS tipo,
        c.id::text                AS record_id,
        COALESCE(c.nome_offerta_snapshot, c.categoria_snapshot, 'Contratto') AS riferimento,
        c.data_contratto          AS data_op,
        c.stato_controllo         AS stato,
        COALESCE(c.categoria_snapshot, '-') || ' · ' ||
            COALESCE(c.nome_offerta_snapshot, '-') ||
            COALESCE(' (' || c.nome_opzione_snapshot || ')', '') AS descrizione,
        p.nome                    AS operatore_nome
    FROM public.vendita_contratti c
    LEFT JOIN public.profili p ON p.id = c.operatore_id
    WHERE c.anagrafica_id IS NOT NULL;

GRANT SELECT ON public.storico_cliente TO authenticated;

COMMIT;
