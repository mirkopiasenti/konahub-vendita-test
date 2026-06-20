-- ============================================
-- FASE 2: estendere vista storico_cliente per includere
-- chiamate, chiamate outbound, appuntamenti, blacklist.
-- Solo dove anagrafica_id IS NOT NULL (per blacklist, via JOIN su cf_piva).
-- Schema delle colonne invariato (modulo storico_cliente.html dipende da:
-- anagrafica_id, tipo, record_id, riferimento, data_op, stato, descrizione, operatore_nome)
-- ============================================

CREATE OR REPLACE VIEW public.storico_cliente AS

-- 1. Ordini Smartphone (originale)
SELECT
    vendita_ordini_smartphone.anagrafica_id,
    'ordine_smartphone'::text AS tipo,
    vendita_ordini_smartphone.id::text AS record_id,
    vendita_ordini_smartphone.codice_ordine AS riferimento,
    vendita_ordini_smartphone.data_registrazione AS data_op,
    vendita_ordini_smartphone.stato,
    ((vendita_ordini_smartphone.marca || ' '::text) || vendita_ordini_smartphone.modello)
        || COALESCE(' '::text || vendita_ordini_smartphone.memoria, ''::text) AS descrizione,
    vendita_ordini_smartphone.operatore_nome
FROM vendita_ordini_smartphone
WHERE vendita_ordini_smartphone.anagrafica_id IS NOT NULL

UNION ALL

-- 2. Dispositivi comodato (originale)
SELECT
    post_vendita_dispositivi_comodato.anagrafica_id,
    'dispositivo_comodato'::text AS tipo,
    post_vendita_dispositivi_comodato.id::text AS record_id,
    post_vendita_dispositivi_comodato.codice AS riferimento,
    post_vendita_dispositivi_comodato.created_at AS data_op,
    post_vendita_dispositivi_comodato.stato,
    ('IMEI: '::text || COALESCE(post_vendita_dispositivi_comodato.imei, '-'::text))
        || COALESCE(' • SIM: '::text || post_vendita_dispositivi_comodato.sim_temporanea, ''::text) AS descrizione,
    post_vendita_dispositivi_comodato.operatore_uscita_nome AS operatore_nome
FROM post_vendita_dispositivi_comodato
WHERE post_vendita_dispositivi_comodato.anagrafica_id IS NOT NULL

UNION ALL

-- 3. Rimborsi (originale)
SELECT
    post_vendita_gestione_rimborsi.anagrafica_id,
    'rimborso'::text AS tipo,
    post_vendita_gestione_rimborsi.id::text AS record_id,
    post_vendita_gestione_rimborsi.codice AS riferimento,
    post_vendita_gestione_rimborsi.data_creazione AS data_op,
    post_vendita_gestione_rimborsi.stato,
    ('€ '::text || post_vendita_gestione_rimborsi.importo::text)
        || COALESCE(' • '::text || post_vendita_gestione_rimborsi.motivazione, ''::text) AS descrizione,
    post_vendita_gestione_rimborsi.operatore_nome
FROM post_vendita_gestione_rimborsi
WHERE post_vendita_gestione_rimborsi.anagrafica_id IS NOT NULL

UNION ALL

-- 4. Apri/chiudi vecchio intestatario (originale)
SELECT
    vendita_apri_chiudi.anagrafica_vecchio_id AS anagrafica_id,
    'apri_chiudi_vecchio'::text AS tipo,
    vendita_apri_chiudi.id::text AS record_id,
    vendita_apri_chiudi.numero_ask AS riferimento,
    vendita_apri_chiudi.data_inserimento AS data_op,
    vendita_apri_chiudi.stato,
    'Cessione → '::text || COALESCE(vendita_apri_chiudi.ragione_sociale_nuovo, '-'::text) AS descrizione,
    vendita_apri_chiudi.operatore_nome
FROM vendita_apri_chiudi
WHERE vendita_apri_chiudi.anagrafica_vecchio_id IS NOT NULL

UNION ALL

-- 5. Apri/chiudi nuovo intestatario (originale)
SELECT
    vendita_apri_chiudi.anagrafica_nuovo_id AS anagrafica_id,
    'apri_chiudi_nuovo'::text AS tipo,
    vendita_apri_chiudi.id::text AS record_id,
    vendita_apri_chiudi.numero_ask AS riferimento,
    vendita_apri_chiudi.data_inserimento AS data_op,
    vendita_apri_chiudi.stato,
    'Subentro da → '::text || COALESCE(vendita_apri_chiudi.ragione_sociale_vecchio, '-'::text) AS descrizione,
    vendita_apri_chiudi.operatore_nome
FROM vendita_apri_chiudi
WHERE vendita_apri_chiudi.anagrafica_nuovo_id IS NOT NULL

UNION ALL

-- 6. Switch SIM attuale intestatario (originale)
SELECT
    vendita_switch_sim.anagrafica_attuale_id AS anagrafica_id,
    'switch_sim_attuale'::text AS tipo,
    vendita_switch_sim.id::text AS record_id,
    vendita_switch_sim.numero_portabilita AS riferimento,
    vendita_switch_sim.data_inserimento AS data_op,
    vendita_switch_sim.stato,
    ('MNP '::text || COALESCE(vendita_switch_sim.numero_portabilita, '-'::text))
        || COALESCE(' • Gestore '::text || vendita_switch_sim.gestore, ''::text) AS descrizione,
    vendita_switch_sim.operatore_nome
FROM vendita_switch_sim
WHERE vendita_switch_sim.anagrafica_attuale_id IS NOT NULL

UNION ALL

-- 7. Switch SIM rientro (originale)
SELECT
    vendita_switch_sim.anagrafica_rientro_id AS anagrafica_id,
    'switch_sim_rientro'::text AS tipo,
    vendita_switch_sim.id::text AS record_id,
    vendita_switch_sim.numero_portabilita AS riferimento,
    vendita_switch_sim.data_inserimento AS data_op,
    vendita_switch_sim.stato,
    'Rientro SIM '::text || COALESCE(vendita_switch_sim.numero_portabilita, '-'::text) AS descrizione,
    vendita_switch_sim.operatore_nome
FROM vendita_switch_sim
WHERE vendita_switch_sim.anagrafica_rientro_id IS NOT NULL

UNION ALL

-- 8. Contratti vendita (originale)
SELECT
    c.anagrafica_id,
    'contratto_vendita'::text AS tipo,
    c.id::text AS record_id,
    COALESCE(c.nome_offerta_snapshot, c.categoria_snapshot, 'Contratto'::text) AS riferimento,
    c.data_contratto AS data_op,
    c.stato_controllo AS stato,
    ((COALESCE(c.categoria_snapshot, '-'::text) || ' · '::text) || COALESCE(c.nome_offerta_snapshot, '-'::text))
        || COALESCE((' ('::text || c.nome_opzione_snapshot) || ')'::text, ''::text) AS descrizione,
    p.nome AS operatore_nome
FROM vendita_contratti c
LEFT JOIN profili p ON p.id = c.operatore_id
WHERE c.anagrafica_id IS NOT NULL

UNION ALL

-- 9. NUOVO: Chiamate Call Center standard
SELECT
    ch.anagrafica_id,
    'chiamata_cc'::text AS tipo,
    ch.id::text AS record_id,
    COALESCE(ch.motivo_chiamata, 'Chiamata') AS riferimento,
    ch.data_ora AS data_op,
    ch.esito AS stato,
    ('Esito: '::text || COALESCE(ch.esito, '-'::text))
        || COALESCE(' · Copertura '::text || ch.copertura, ''::text)
        || COALESCE(' · '::text || ch.note, ''::text) AS descrizione,
    ch.operatore_nome
FROM chiamate ch
WHERE ch.anagrafica_id IS NOT NULL

UNION ALL

-- 10. NUOVO: Chiamate Call Center outbound business
SELECT
    cob.anagrafica_id,
    'chiamata_cc_outbound'::text AS tipo,
    cob.id::text AS record_id,
    'Outbound business'::text AS riferimento,
    cob.data_ora AS data_op,
    cob.esito AS stato,
    ('Lead: '::text || COALESCE(cob.ragione_sociale_snapshot, '-'::text))
        || ' · Esito '::text || COALESCE(cob.esito, '-'::text)
        || COALESCE(' · '::text || cob.note, ''::text) AS descrizione,
    cob.operatore_nome
FROM call_center_lead_outbound_chiamate cob
WHERE cob.anagrafica_id IS NOT NULL

UNION ALL

-- 11. NUOVO: Appuntamenti (presi, presentati, annullati, rischedulati)
SELECT
    app.anagrafica_id,
    'appuntamento_cc'::text AS tipo,
    app.id::text AS record_id,
    COALESCE(app.motivo, 'Appuntamento') AS riferimento,
    app.data_ora AS data_op,
    app.stato,
    ('Appuntamento '::text || COALESCE(app.stato, '-'::text))
        || COALESCE(' · Presentato: '::text || app.presentato, ''::text)
        || COALESCE(' · Esito: '::text || app.esito_finale, ''::text)
        || COALESCE(' · '::text || app.note, ''::text) AS descrizione,
    COALESCE(app.fissato_da_nome, 'Prenotazione online'::text) AS operatore_nome
FROM appuntamenti app
WHERE app.anagrafica_id IS NOT NULL

UNION ALL

-- 12. NUOVO: Blacklist (lookup via cf_piva → anagrafica.id, mostra come evento storico)
SELECT
    a.id AS anagrafica_id,
    'blacklist'::text AS tipo,
    bl.id::text AS record_id,
    'BLACKLIST'::text AS riferimento,
    bl.created_at AS data_op,
    'in_blacklist'::text AS stato,
    ('Cliente in Black List'::text)
        || COALESCE(' · '::text || bl.motivo, ''::text) AS descrizione,
    COALESCE(p.nome, '-'::text) AS operatore_nome
FROM blacklist bl
JOIN anagrafica a ON UPPER(TRIM(a.cf_piva)) = UPPER(TRIM(bl.cf_piva))
LEFT JOIN profili p ON p.id = bl.inserito_da;
