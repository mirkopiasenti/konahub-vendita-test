const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const VALID_ORIGINI = [
  'appuntamento_callcenter',
  'contatto_callcenter_entro_10_giorni',
  'spontaneo'
];

const VALID_CLUSTERS = ['Consumer', 'Business'];

function response(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'si', 'sì'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return fallback;
}

function readableError(error, fallback = 'Errore creazione pratica/contratto vendita') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || error.error_description || error.details || fallback;
}

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Variabili ambiente mancanti: SUPABASE_URL e/o SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

function assertRequired(value, fieldName) {
  if (!cleanString(value)) throw new Error(`Campo obbligatorio mancante: ${fieldName}`);
}

function normalizeCluster(value) {
  const cluster = cleanString(value) || 'Consumer';
  if (!VALID_CLUSTERS.includes(cluster)) {
    throw new Error('Cluster non valido: usa Consumer o Business');
  }
  return cluster;
}

function normalizeOrigine(value) {
  const origine = cleanString(value) || 'spontaneo';
  if (!VALID_ORIGINI.includes(origine)) {
    throw new Error('Origine pratica non valida');
  }
  return origine;
}

function sanitizeSegment(value, fallback = 'cliente') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function buildStorageNames({ ragioneSociale, praticaId, now }) {
  const day = pad2(now.getDate());
  const month = pad2(now.getMonth() + 1);
  const year = String(now.getFullYear());
  const shortId = String(praticaId || '').slice(0, 6);
  const safeName = sanitizeSegment(ragioneSociale, 'cliente');
  const nomeCartellaStorage = `Contratto_${safeName}_${day}_${month}_${year}_${shortId}`;
  const storageBasePath = `${year}/${month}/${nomeCartellaStorage.toLowerCase()}/`;
  return { nomeCartellaStorage, storageBasePath };
}

async function fetchEntityById({ supabase, table, id, activeColumn, notFoundMessage }) {
  if (!id) return null;

  let query = supabase.from(table).select('*').eq('id', id);
  if (activeColumn) query = query.eq(activeColumn, true);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(readableError(error, notFoundMessage));
  if (!data) throw new Error(notFoundMessage);
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, error: 'Metodo non consentito: usa POST' });
  }

  let payload;
  let supabase;

  try {
    payload = JSON.parse(event.body || '{}');
    supabase = getSupabaseClient();
  } catch (error) {
    return response(400, { success: false, error: readableError(error) });
  }

  const cfPiva = cleanString(payload.cf_piva);
  const cluster = normalizeCluster(payload.cluster);
  const ragioneSociale = cleanString(payload.ragione_sociale);
  const nomeReferente = cleanString(payload.nome_referente);
  const cellulare = cleanString(payload.cellulare);
  const provincia = cleanString(payload.provincia);
  const comune = cleanString(payload.comune);
  const via = cleanString(payload.via);
  const civico = cleanString(payload.civico);

  const originePratica = normalizeOrigine(payload.origine_pratica);
  const appuntamentoId = cleanString(payload.appuntamento_id);
  const chiamataId = cleanString(payload.chiamata_id);
  const operatoreId = cleanString(payload.operatore_id);

  const categoriaId = cleanString(payload.categoria_id);
  const offertaId = cleanString(payload.offerta_id);
  const opzioneId = cleanString(payload.opzione_id);
  const reloadId = cleanString(payload.reload_id);

  const tipoAttivazione = cleanString(payload.tipo_attivazione);
  const apriChiudi = cleanString(payload.apri_chiudi);
  const intestatario = cleanString(payload.intestatario);
  const switchSim = cleanString(payload.switch_sim);
  const modalitaPagamento = cleanString(payload.modalita_pagamento);

  const dispositivoAssociato = parseBoolean(payload.dispositivo_associato, false);
  const imei = cleanString(payload.imei);
  const fasciaPrezzo = cleanString(payload.fascia_prezzo);
  const tipoAcquisto = cleanString(payload.tipo_acquisto);
  const finanziaria = cleanString(payload.finanziaria);
  const kolme = payload.kolme === undefined || payload.kolme === null || payload.kolme === ''
    ? null
    : parseBoolean(payload.kolme, false);

  try {
    assertRequired(cfPiva, 'cf_piva');
    assertRequired(ragioneSociale, 'ragione_sociale');
    assertRequired(categoriaId, 'categoria_id');
    assertRequired(offertaId, 'offerta_id');

    let anagraficaId;

    const { data: anagraficaEsistente, error: anagraficaLookupError } = await supabase
      .from('anagrafica')
      .select('id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, provincia, comune, via, civico')
      .eq('cf_piva', cfPiva)
      .maybeSingle();

    if (anagraficaLookupError) {
      throw new Error(readableError(anagraficaLookupError, 'Errore ricerca anagrafica'));
    }

    if (anagraficaEsistente) {
      anagraficaId = anagraficaEsistente.id;
      const updates = {};
      const candidateFields = {
        cluster,
        ragione_sociale: ragioneSociale,
        nome_referente: nomeReferente,
        cellulare,
        provincia,
        comune,
        via,
        civico
      };

      Object.entries(candidateFields).forEach(([column, newValue]) => {
        if (!isBlank(newValue) && isBlank(anagraficaEsistente[column])) {
          updates[column] = newValue;
        }
      });

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('anagrafica')
          .update(updates)
          .eq('id', anagraficaId);
        if (updateError) throw new Error(readableError(updateError, 'Errore aggiornamento anagrafica'));
      }
    } else {
      const { data: nuovaAnagrafica, error: insertError } = await supabase
        .from('anagrafica')
        .insert({
          cf_piva: cfPiva,
          cluster,
          ragione_sociale: ragioneSociale,
          nome_referente: nomeReferente,
          cellulare,
          provincia,
          comune,
          via,
          civico
        })
        .select('id')
        .single();

      if (insertError) throw new Error(readableError(insertError, 'Errore creazione anagrafica'));
      anagraficaId = nuovaAnagrafica.id;
    }

    const { data: pratica, error: praticaInsertError } = await supabase
      .from('vendita_pratiche')
      .insert({
        anagrafica_id: anagraficaId,
        appuntamento_id: appuntamentoId,
        chiamata_id: chiamataId,
        operatore_id: operatoreId,
        origine_pratica: originePratica,
        stato_pratica: 'inviata',
        note: 'Pratica test vendita'
      })
      .select('*')
      .single();

    if (praticaInsertError) {
      throw new Error(readableError(praticaInsertError, 'Errore creazione vendita_pratiche'));
    }

    const { nomeCartellaStorage, storageBasePath } = buildStorageNames({
      ragioneSociale,
      praticaId: pratica.id,
      now: new Date()
    });

    const { error: praticaUpdateError } = await supabase
      .from('vendita_pratiche')
      .update({ nome_cartella_storage: nomeCartellaStorage, storage_base_path: storageBasePath })
      .eq('id', pratica.id);

    if (praticaUpdateError) {
      throw new Error(readableError(praticaUpdateError, 'Errore aggiornamento storage pratica'));
    }

    const categoria = await fetchEntityById({
      supabase,
      table: 'vendita_categorie',
      id: categoriaId,
      activeColumn: 'attiva',
      notFoundMessage: 'Categoria non trovata o non attiva'
    });

    const offerta = await fetchEntityById({
      supabase,
      table: 'vendita_offerte',
      id: offertaId,
      activeColumn: 'attiva',
      notFoundMessage: 'Offerta non trovata o non attiva'
    });

    if (offerta.categoria_id !== categoriaId) {
      throw new Error('Offerta non coerente con la categoria selezionata');
    }

    if (offerta.cluster_cliente && offerta.cluster_cliente !== cluster) {
      throw new Error('Offerta non coerente con il cluster selezionato');
    }

    let opzione = null;
    if (opzioneId) {
      opzione = await fetchEntityById({
        supabase,
        table: 'vendita_opzioni',
        id: opzioneId,
        activeColumn: 'attiva',
        notFoundMessage: 'Opzione non trovata o non attiva'
      });

      const opzioneCategoriaOk = !opzione.categoria_id || opzione.categoria_id === categoriaId;
      const opzioneOffertaOk = !opzione.offerta_id || opzione.offerta_id === offertaId;
      const opzioneClusterOk = !opzione.cluster_cliente || opzione.cluster_cliente === cluster;

      if (!opzioneCategoriaOk || !opzioneOffertaOk || !opzioneClusterOk) {
        throw new Error('Opzione non coerente con categoria/offerta/cluster selezionati');
      }
    }

    let reload = null;
    if (reloadId) {
      reload = await fetchEntityById({
        supabase,
        table: 'vendita_reload',
        id: reloadId,
        activeColumn: 'attivo',
        notFoundMessage: 'Reload non trovato o non attivo'
      });
    }

    const punteggioGaraOfferta = toNumber(offerta.punteggio_gara, 0);
    const punteggioGaraOpzione = opzione ? toNumber(opzione.punteggio_gara, 0) : 0;
    const punteggioExtraGaraOfferta = toNumber(offerta.punteggio_extra_gara, 0);
    const punteggioExtraGaraOpzione = opzione ? toNumber(opzione.punteggio_extra_gara, 0) : 0;

    const contrattoPayload = {
      pratica_id: pratica.id,
      anagrafica_id: anagraficaId,
      appuntamento_id: appuntamentoId,
      chiamata_id: chiamataId,
      operatore_id: operatoreId,

      cluster_cliente: cluster,
      categoria_id: categoriaId,
      offerta_id: offertaId,
      opzione_id: opzioneId,
      reload_id: reloadId,

      categoria_snapshot: categoria.nome,
      nome_offerta_snapshot: offerta.nome_offerta,
      nome_opzione_snapshot: opzione ? opzione.nome_opzione : null,
      nome_reload_snapshot: reload ? reload.nome : null,

      punteggio_gara_offerta: punteggioGaraOfferta,
      punteggio_gara_opzione: punteggioGaraOpzione,
      punteggio_extra_gara_offerta: punteggioExtraGaraOfferta,
      punteggio_extra_gara_opzione: punteggioExtraGaraOpzione,

      // Campi legacy mantenuti per compatibilità con viste/test già esistenti.
      punteggio_offerta: punteggioGaraOfferta,
      punteggio_opzione: punteggioGaraOpzione,
      punteggio_extra: 0,

      tipo_attivazione: tipoAttivazione,
      apri_chiudi: apriChiudi,
      intestatario,
      switch_sim: switchSim,
      modalita_pagamento: modalitaPagamento,

      dispositivo_associato: dispositivoAssociato,
      imei,
      fascia_prezzo: fasciaPrezzo,
      tipo_acquisto: tipoAcquisto,
      finanziaria,
      kolme,

      stato_controllo: 'da_controllare'
    };

    const { data: contratto, error: contrattoInsertError } = await supabase
      .from('vendita_contratti')
      .insert(contrattoPayload)
      .select('*')
      .single();

    if (contrattoInsertError) {
      throw new Error(readableError(contrattoInsertError, 'Errore creazione vendita_contratti'));
    }

    return response(200, {
      success: true,
      anagrafica_id: anagraficaId,
      pratica_id: pratica.id,
      contratto_id: contratto.id,
      storage_base_path: storageBasePath,
      nome_cartella_storage: nomeCartellaStorage,
      contratto
    });
  } catch (error) {
    return response(500, { success: false, error: readableError(error) });
  }
};
