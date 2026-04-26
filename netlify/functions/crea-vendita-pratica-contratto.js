const { createClient } = require('@supabase/supabase-js');

const ORIGINI_PRATICA_AMMESSE = new Set([
  'appuntamento_callcenter',
  'contatto_callcenter_entro_10_giorni',
  'spontaneo'
]);
const CLUSTER_AMMESSI = new Set(['Consumer', 'Business']);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload)
  };
}

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function parseRequiredScore(value, label) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Configurazione non valida: ${label} non numerico`);
  }

  return parsed;
}

function parseOptionalScore(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'si'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;

  return fallback;
}

function normalizeCluster(value) {
  const raw = cleanString(value);

  if (!raw) return null;

  const normalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();

  if (CLUSTER_AMMESSI.has(normalized)) return normalized;

  throw new Error('Cluster non valido: usa Consumer o Business');
}

function sanitizeSegment(value, fallback = 'valore') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
}

function formatDateDdMmYyyy(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}_${mm}_${yyyy}`;
}

function buildStorageNames({ ragioneSociale, praticaId, now = new Date() }) {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const praticaShort = String(praticaId || '').replace(/-/g, '').slice(0, 6).toLowerCase() || 'xxxxxx';
  const ragioneSafe = sanitizeSegment(ragioneSociale, 'cliente');
  const datePart = formatDateDdMmYyyy(now);

  const nomeCartellaStorage = `Contratto_${ragioneSafe}_${datePart}_${praticaShort}`;
  const folderPathSegment = sanitizeSegment(nomeCartellaStorage, `contratto_${praticaShort}`).toLowerCase();
  const storageBasePath = `${year}/${month}/${folderPathSegment}/`;

  return { nomeCartellaStorage, storageBasePath };
}

function readableError(error, fallback = 'Errore durante la creazione pratica/contratto') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || error.error_description || error.details || fallback;
}

async function fetchEntityById({ supabase, table, id, notFoundMessage, activeColumn }) {
  let query = supabase.from(table).select('*').eq('id', id).limit(1);

  if (activeColumn) {
    query = query.eq(activeColumn, true);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(readableError(error));
  }

  if (!data) {
    throw new Error(notFoundMessage);
  }

  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, error: 'Metodo non consentito: usa POST' });
  }

  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';

  if (!contentType.toLowerCase().includes('application/json')) {
    return response(415, {
      success: false,
      error: 'Content-Type non valido: usare application/json'
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return response(500, {
      success: false,
      error: 'Variabili ambiente mancanti: SUPABASE_URL e/o SUPABASE_SERVICE_ROLE_KEY'
    });
  }

  let payload;

  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return response(400, {
      success: false,
      error: 'JSON non valido nel body della richiesta'
    });
  }

  const cfPiva = cleanString(payload.cf_piva);
  let cluster;

  try {
    cluster = normalizeCluster(payload.cluster);
  } catch (error) {
    return response(400, { success: false, error: error.message });
  }
  const ragioneSociale = cleanString(payload.ragione_sociale);
  const nomeReferente = cleanString(payload.nome_referente);
  const cellulare = cleanString(payload.cellulare);
  const provincia = cleanString(payload.provincia);
  const comune = cleanString(payload.comune);
  const via = cleanString(payload.via);
  const civico = cleanString(payload.civico);

  const categoriaId = cleanString(payload.categoria_id);
  const offertaId = cleanString(payload.offerta_id);
  const opzioneId = cleanString(payload.opzione_id);
  const reloadId = cleanString(payload.reload_id);

  const originePratica = cleanString(payload.origine_pratica) || 'spontaneo';
  const appuntamentoId = cleanString(payload.appuntamento_id);
  const chiamataId = cleanString(payload.chiamata_id);
  const operatoreId = cleanString(payload.operatore_id);

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
  const kolme = parseBoolean(payload.kolme, null);

  if (!cfPiva) {
    return response(400, { success: false, error: 'Campo obbligatorio mancante: cf_piva' });
  }

  if (!ragioneSociale) {
    return response(400, { success: false, error: 'Campo obbligatorio mancante: ragione_sociale' });
  }

  if (!categoriaId) {
    return response(400, { success: false, error: 'Campo obbligatorio mancante: categoria_id' });
  }

  if (!offertaId) {
    return response(400, { success: false, error: 'Campo obbligatorio mancante: offerta_id' });
  }

  if (!ORIGINI_PRATICA_AMMESSE.has(originePratica)) {
    return response(400, {
      success: false,
      error: 'origine_pratica non valida. Valori ammessi: appuntamento_callcenter, contatto_callcenter_entro_10_giorni, spontaneo'
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    let anagraficaId;

    // 1) Cerca anagrafica esistente per cf_piva (evita doppioni).
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

      // Aggiorna solo campi vuoti: non sovrascrive dati già compilati.
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
        if (isBlank(newValue)) return;

        const currentValue = anagraficaEsistente[column];

        if (isBlank(currentValue)) {
          updates[column] = newValue;
        }
      });

      if (Object.keys(updates).length > 0) {
        const { error: anagraficaUpdateError } = await supabase
          .from('anagrafica')
          .update(updates)
          .eq('id', anagraficaId);

        if (anagraficaUpdateError) {
          throw new Error(readableError(anagraficaUpdateError, 'Errore aggiornamento anagrafica esistente'));
        }
      }
    } else {
      // Crea nuova anagrafica se non trovata.
      const anagraficaInsertPayload = {
        cf_piva: cfPiva,
        cluster,
        ragione_sociale: ragioneSociale,
        nome_referente: nomeReferente,
        cellulare,
        provincia,
        comune,
        via,
        civico
      };

      const { data: anagraficaNuova, error: anagraficaInsertError } = await supabase
        .from('anagrafica')
        .insert(anagraficaInsertPayload)
        .select('id')
        .single();

      if (anagraficaInsertError) {
        throw new Error(readableError(anagraficaInsertError, 'Errore creazione anagrafica'));
      }

      anagraficaId = anagraficaNuova.id;
    }

    // 2) Crea pratica vendita.
    const praticaPayload = {
      anagrafica_id: anagraficaId,
      appuntamento_id: appuntamentoId,
      chiamata_id: chiamataId,
      operatore_id: operatoreId,
      origine_pratica: originePratica,
      stato_pratica: 'inviata',
      note: 'Pratica test vendita'
    };

    const { data: pratica, error: praticaInsertError } = await supabase
      .from('vendita_pratiche')
      .insert(praticaPayload)
      .select('*')
      .single();

    if (praticaInsertError) {
      throw new Error(readableError(praticaInsertError, 'Errore creazione vendita_pratiche'));
    }

    // 3) Costruisci nome cartella/storage path e aggiorna la pratica.
    const { nomeCartellaStorage, storageBasePath } = buildStorageNames({
      ragioneSociale,
      praticaId: pratica.id,
      now: new Date()
    });

    const { error: praticaUpdateStorageError } = await supabase
      .from('vendita_pratiche')
      .update({
        nome_cartella_storage: nomeCartellaStorage,
        storage_base_path: storageBasePath
      })
      .eq('id', pratica.id);

    if (praticaUpdateStorageError) {
      throw new Error(readableError(praticaUpdateStorageError, 'Errore aggiornamento path storage su vendita_pratiche'));
    }

    // 4) Recupera le entità di configurazione per snapshot e punteggi.
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

    if (cluster && offerta.cluster_cliente && offerta.cluster_cliente !== cluster) {
      throw new Error('Offerta non coerente con cluster selezionato');
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

      if (!opzioneCategoriaOk || !opzioneOffertaOk) {
        throw new Error('Opzione non coerente con categoria/offerta selezionate');
      }

      if (cluster && opzione.cluster_cliente && opzione.cluster_cliente !== cluster) {
        throw new Error('Opzione non coerente con cluster selezionato');
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

    // 5) Calcolo punteggi snapshot lato server (no fiducia sul front-end).
    const punteggioGaraOfferta = parseRequiredScore(offerta.punteggio_gara, 'punteggio_gara offerta');
    const punteggioGaraOpzione = opzione
      ? parseRequiredScore(opzione.punteggio_gara, 'punteggio_gara opzione')
      : 0;
    const punteggioExtraGaraOfferta = parseOptionalScore(offerta.punteggio_extra_gara, 0);
    const punteggioExtraGaraOpzione = opzione
      ? parseOptionalScore(opzione.punteggio_extra_gara, 0)
      : 0;

    // Compatibilita con i campi storici di vendita_contratti.
    const punteggioOfferta = punteggioGaraOfferta;
    const punteggioOpzione = punteggioGaraOpzione;
    const punteggioExtra = 0;
    const punteggioTotale = Number((punteggioOfferta + punteggioOpzione + punteggioExtra).toFixed(2));

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

      punteggio_offerta: punteggioOfferta,
      punteggio_opzione: punteggioOpzione,
      punteggio_extra: punteggioExtra,
      punteggio_totale: punteggioTotale,

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
    return response(500, {
      success: false,
      error: readableError(error)
    });
  }
};
