const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

const CLUSTER_AMMESSI = new Set(['Consumer', 'Business']);
const DOC_TIPO = {
  DOCUMENTO_IDENTITA: 'documento_identita',
  CONTRATTO: 'contratto',
  COPIA_BOLLETTA: 'copia_bolletta',
  COPIA_SIM_MNP: 'copia_sim_mnp'
};
const DOC_TIPI_OFFERTA = [
  DOC_TIPO.DOCUMENTO_IDENTITA,
  DOC_TIPO.CONTRATTO,
  DOC_TIPO.COPIA_BOLLETTA
];
const DOC_TIPI_OPZIONE = [DOC_TIPO.COPIA_SIM_MNP];
const DOC_CAMPO_CONDIZIONE_ADMIN = 'admin_config';

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

function normalizeClusterCliente(value) {
  const raw = cleanString(value);

  if (!raw) return null;

  const normalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();

  if (CLUSTER_AMMESSI.has(normalized)) return normalized;

  throw new Error('Cluster non valido: usa Consumer o Business');
}

function parseBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'si'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;

  return fallback;
}

function toInteger(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseRequiredNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Campo obbligatorio mancante: ${fieldName}`);
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Campo non valido: ${fieldName} deve essere numerico`);
  }

  return parsed;
}

function parseOptionalNumber(value, fallback = 0, fieldName = 'campo numerico') {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Campo non valido: ${fieldName} deve essere numerico`);
  }

  return parsed;
}

function readableError(error, fallback = 'Errore configurazione vendita') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || error.error_description || error.details || fallback;
}

function normalizeDocumentSelectionOfferta(payload = {}) {
  return {
    documento_identita: parseBoolean(payload.doc_documento_identita, false) === true,
    contratto: parseBoolean(payload.doc_contratto, true) === true,
    copia_bolletta: parseBoolean(payload.doc_copia_bolletta, false) === true
  };
}

function normalizeDocumentSelectionOpzione(payload = {}) {
  return {
    copia_sim_mnp: parseBoolean(payload.doc_copia_sim_mnp, false) === true
  };
}

function getOffertaDocumentRulesMap(documentSelection = {}) {
  const rules = [];

  if (documentSelection.documento_identita) {
    rules.push({
      tipo_documento: DOC_TIPO.DOCUMENTO_IDENTITA,
      obbligatorio: true
    });
  }

  if (documentSelection.contratto) {
    rules.push({
      tipo_documento: DOC_TIPO.CONTRATTO,
      obbligatorio: true
    });
  }

  if (documentSelection.copia_bolletta) {
    rules.push({
      tipo_documento: DOC_TIPO.COPIA_BOLLETTA,
      obbligatorio: true
    });
  }

  return rules;
}

function getOpzioneDocumentRulesMap(documentSelection = {}) {
  const rules = [];

  if (documentSelection.copia_sim_mnp) {
    rules.push({
      tipo_documento: DOC_TIPO.COPIA_SIM_MNP,
      obbligatorio: true
    });
  }

  return rules;
}

function safeInFilterValues(values = []) {
  return values.filter(Boolean);
}

async function replaceOffertaDocumentRules(supabase, offertaRecord, documentSelection) {
  if (!offertaRecord?.id) return;

  const managedTypes = safeInFilterValues(DOC_TIPI_OFFERTA);
  if (managedTypes.length > 0) {
    const { error: deleteError } = await supabase
      .from('vendita_documenti_regole')
      .delete()
      .eq('offerta_id', offertaRecord.id)
      .in('tipo_documento', managedTypes);

    if (deleteError) {
      throw new Error(readableError(deleteError, 'Errore pulizia regole documentali offerta'));
    }
  }

  const ruleRows = getOffertaDocumentRulesMap(documentSelection).map((rule) => ({
    categoria_id: offertaRecord.categoria_id,
    offerta_id: offertaRecord.id,
    opzione_id: null,
    campo_condizione: DOC_CAMPO_CONDIZIONE_ADMIN,
    valore_condizione: 'true',
    tipo_documento: rule.tipo_documento,
    obbligatorio: rule.obbligatorio,
    attiva: true
  }));

  if (ruleRows.length === 0) return;

  const { error: insertError } = await supabase
    .from('vendita_documenti_regole')
    .insert(ruleRows);

  if (insertError) {
    throw new Error(readableError(insertError, 'Errore salvataggio regole documentali offerta'));
  }
}

async function replaceOpzioneDocumentRules(supabase, opzioneRecord, documentSelection) {
  if (!opzioneRecord?.id) return;

  const managedTypes = safeInFilterValues(DOC_TIPI_OPZIONE);
  if (managedTypes.length > 0) {
    const { error: deleteError } = await supabase
      .from('vendita_documenti_regole')
      .delete()
      .eq('opzione_id', opzioneRecord.id)
      .in('tipo_documento', managedTypes);

    if (deleteError) {
      throw new Error(readableError(deleteError, 'Errore pulizia regole documentali opzione'));
    }
  }

  const ruleRows = getOpzioneDocumentRulesMap(documentSelection).map((rule) => ({
    categoria_id: opzioneRecord.categoria_id,
    offerta_id: null,
    opzione_id: opzioneRecord.id,
    campo_condizione: DOC_CAMPO_CONDIZIONE_ADMIN,
    valore_condizione: 'true',
    tipo_documento: rule.tipo_documento,
    obbligatorio: rule.obbligatorio,
    attiva: true
  }));

  if (ruleRows.length === 0) return;

  const { error: insertError } = await supabase
    .from('vendita_documenti_regole')
    .insert(ruleRows);

  if (insertError) {
    throw new Error(readableError(insertError, 'Errore salvataggio regole documentali opzione'));
  }
}

function enrichWithDocumentRules(config) {
  const rules = Array.isArray(config?.documenti_regole) ? config.documenti_regole : [];

  const offertaMap = new Map();
  const opzioneMap = new Map();

  rules.forEach((rule) => {
    if (!rule?.attiva) return;
    const tipoDocumento = cleanString(rule.tipo_documento);
    if (!tipoDocumento) return;

    if (rule.offerta_id) {
      if (!offertaMap.has(rule.offerta_id)) offertaMap.set(rule.offerta_id, new Set());
      offertaMap.get(rule.offerta_id).add(tipoDocumento);
    }

    if (rule.opzione_id) {
      if (!opzioneMap.has(rule.opzione_id)) opzioneMap.set(rule.opzione_id, new Set());
      opzioneMap.get(rule.opzione_id).add(tipoDocumento);
    }
  });

  const offerte = (config.offerte || []).map((offerta) => ({
    ...offerta,
    documenti_attivi: Array.from(offertaMap.get(offerta.id) || [])
  }));

  const opzioni = (config.opzioni || []).map((opzione) => ({
    ...opzione,
    documenti_attivi: Array.from(opzioneMap.get(opzione.id) || [])
  }));

  return {
    ...config,
    offerte,
    opzioni
  };
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

async function loadFullConfig(supabase) {
  const [categorieRes, offerteRes, opzioniRes, reloadRes, regoleRes] = await Promise.all([
    supabase
      .from('vendita_categorie')
      .select('id, nome, descrizione, attiva, ordine, created_at, updated_at')
      .order('ordine', { ascending: true })
      .order('nome', { ascending: true }),
    supabase
      .from('vendita_offerte')
      .select('id, categoria_id, cluster_cliente, nome_offerta, descrizione, punteggio_gara, punteggio_extra_gara, attiva, valid_from, valid_to, created_at, updated_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('vendita_opzioni')
      .select('id, categoria_id, offerta_id, cluster_cliente, nome_opzione, descrizione, punteggio_gara, punteggio_extra_gara, attiva, valid_from, valid_to, created_at, updated_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('vendita_reload')
      .select('id, nome, attivo, ordine, created_at, updated_at')
      .order('ordine', { ascending: true })
      .order('nome', { ascending: true }),
    supabase
      .from('vendita_documenti_regole')
      .select('id, categoria_id, offerta_id, opzione_id, campo_condizione, valore_condizione, tipo_documento, obbligatorio, attiva, created_at, updated_at')
      .eq('attiva', true)
      .order('created_at', { ascending: false })
  ]);

  const firstError =
    categorieRes.error ||
    offerteRes.error ||
    opzioniRes.error ||
    reloadRes.error ||
    regoleRes.error;

  if (firstError) {
    throw new Error(readableError(firstError, 'Errore lettura configurazione vendita'));
  }

  const config = {
    categorie: categorieRes.data || [],
    offerte: offerteRes.data || [],
    opzioni: opzioniRes.data || [],
    reload: reloadRes.data || [],
    documenti_regole: regoleRes.data || []
  };

  return enrichWithDocumentRules(config);
}

function assertRequired(value, fieldName) {
  if (!cleanString(value)) {
    throw new Error(`Campo obbligatorio mancante: ${fieldName}`);
  }
}

async function createOfferta(supabase, payload) {
  assertRequired(payload.categoria_id, 'categoria_id');
  assertRequired(payload.nome_offerta, 'nome_offerta');

  const clusterCliente = normalizeClusterCliente(payload.cluster_cliente);
  const punteggioGara = parseRequiredNumber(payload.punteggio_gara, 'punteggio_gara');
  const punteggioExtraGara = parseOptionalNumber(
    payload.punteggio_extra_gara,
    0,
    'punteggio_extra_gara'
  );

  const insertPayload = {
    categoria_id: cleanString(payload.categoria_id),
    cluster_cliente: clusterCliente,
    nome_offerta: cleanString(payload.nome_offerta),
    descrizione: cleanString(payload.descrizione),
    punteggio_gara: punteggioGara,
    punteggio_extra_gara: punteggioExtraGara,
    attiva: parseBoolean(payload.attiva, true)
  };

  const { data, error } = await supabase
    .from('vendita_offerte')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) throw new Error(readableError(error, 'Errore creazione offerta'));

  const documentSelection = normalizeDocumentSelectionOfferta(payload);
  await replaceOffertaDocumentRules(supabase, data, documentSelection);

  return data;
}

async function updateOfferta(supabase, payload) {
  assertRequired(payload.id, 'id');
  assertRequired(payload.categoria_id, 'categoria_id');
  assertRequired(payload.nome_offerta, 'nome_offerta');

  const clusterCliente = normalizeClusterCliente(payload.cluster_cliente);
  const punteggioGara = parseRequiredNumber(payload.punteggio_gara, 'punteggio_gara');
  const punteggioExtraGara = parseOptionalNumber(
    payload.punteggio_extra_gara,
    0,
    'punteggio_extra_gara'
  );

  const updatePayload = {
    categoria_id: cleanString(payload.categoria_id),
    cluster_cliente: clusterCliente,
    nome_offerta: cleanString(payload.nome_offerta),
    descrizione: cleanString(payload.descrizione),
    punteggio_gara: punteggioGara,
    punteggio_extra_gara: punteggioExtraGara,
    attiva: parseBoolean(payload.attiva, true)
  };

  const { data, error } = await supabase
    .from('vendita_offerte')
    .update(updatePayload)
    .eq('id', cleanString(payload.id))
    .select('*')
    .maybeSingle();

  if (error) throw new Error(readableError(error, 'Errore aggiornamento offerta'));
  if (!data) throw new Error('Offerta non trovata');

  const documentSelection = normalizeDocumentSelectionOfferta(payload);
  await replaceOffertaDocumentRules(supabase, data, documentSelection);

  return data;
}

async function toggleOfferta(supabase, payload) {
  assertRequired(payload.id, 'id');

  const attiva = parseBoolean(payload.attiva, null);

  if (attiva === null) {
    throw new Error('Campo obbligatorio non valido: attiva');
  }

  const { data, error } = await supabase
    .from('vendita_offerte')
    .update({ attiva })
    .eq('id', cleanString(payload.id))
    .select('*')
    .maybeSingle();

  if (error) throw new Error(readableError(error, 'Errore toggle offerta'));
  if (!data) throw new Error('Offerta non trovata');

  return data;
}

async function createOpzione(supabase, payload) {
  assertRequired(payload.categoria_id, 'categoria_id');
  assertRequired(payload.offerta_id, 'offerta_id');
  assertRequired(payload.nome_opzione, 'nome_opzione');

  const clusterCliente = normalizeClusterCliente(payload.cluster_cliente);
  const punteggioGara = parseRequiredNumber(payload.punteggio_gara, 'punteggio_gara');
  const punteggioExtraGara = parseOptionalNumber(
    payload.punteggio_extra_gara,
    0,
    'punteggio_extra_gara'
  );

  const insertPayload = {
    categoria_id: cleanString(payload.categoria_id),
    offerta_id: cleanString(payload.offerta_id),
    cluster_cliente: clusterCliente,
    nome_opzione: cleanString(payload.nome_opzione),
    descrizione: cleanString(payload.descrizione),
    punteggio_gara: punteggioGara,
    punteggio_extra_gara: punteggioExtraGara,
    attiva: parseBoolean(payload.attiva, true)
  };

  const { data, error } = await supabase
    .from('vendita_opzioni')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) throw new Error(readableError(error, 'Errore creazione opzione'));

  const documentSelection = normalizeDocumentSelectionOpzione(payload);
  await replaceOpzioneDocumentRules(supabase, data, documentSelection);

  return data;
}

async function updateOpzione(supabase, payload) {
  assertRequired(payload.id, 'id');
  assertRequired(payload.categoria_id, 'categoria_id');
  assertRequired(payload.offerta_id, 'offerta_id');
  assertRequired(payload.nome_opzione, 'nome_opzione');

  const clusterCliente = normalizeClusterCliente(payload.cluster_cliente);
  const punteggioGara = parseRequiredNumber(payload.punteggio_gara, 'punteggio_gara');
  const punteggioExtraGara = parseOptionalNumber(
    payload.punteggio_extra_gara,
    0,
    'punteggio_extra_gara'
  );

  const updatePayload = {
    categoria_id: cleanString(payload.categoria_id),
    offerta_id: cleanString(payload.offerta_id),
    cluster_cliente: clusterCliente,
    nome_opzione: cleanString(payload.nome_opzione),
    descrizione: cleanString(payload.descrizione),
    punteggio_gara: punteggioGara,
    punteggio_extra_gara: punteggioExtraGara,
    attiva: parseBoolean(payload.attiva, true)
  };

  const { data, error } = await supabase
    .from('vendita_opzioni')
    .update(updatePayload)
    .eq('id', cleanString(payload.id))
    .select('*')
    .maybeSingle();

  if (error) throw new Error(readableError(error, 'Errore aggiornamento opzione'));
  if (!data) throw new Error('Opzione non trovata');

  const documentSelection = normalizeDocumentSelectionOpzione(payload);
  await replaceOpzioneDocumentRules(supabase, data, documentSelection);

  return data;
}

async function toggleOpzione(supabase, payload) {
  assertRequired(payload.id, 'id');

  const attiva = parseBoolean(payload.attiva, null);

  if (attiva === null) {
    throw new Error('Campo obbligatorio non valido: attiva');
  }

  const { data, error } = await supabase
    .from('vendita_opzioni')
    .update({ attiva })
    .eq('id', cleanString(payload.id))
    .select('*')
    .maybeSingle();

  if (error) throw new Error(readableError(error, 'Errore toggle opzione'));
  if (!data) throw new Error('Opzione non trovata');

  return data;
}

async function createReload(supabase, payload) {
  assertRequired(payload.nome, 'nome');

  const insertPayload = {
    nome: cleanString(payload.nome),
    ordine: toInteger(payload.ordine, 0),
    attivo: parseBoolean(payload.attivo, true)
  };

  const { data, error } = await supabase
    .from('vendita_reload')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) throw new Error(readableError(error, 'Errore creazione reload'));

  return data;
}

async function updateReload(supabase, payload) {
  assertRequired(payload.id, 'id');
  assertRequired(payload.nome, 'nome');

  const updatePayload = {
    nome: cleanString(payload.nome),
    ordine: toInteger(payload.ordine, 0),
    attivo: parseBoolean(payload.attivo, true)
  };

  const { data, error } = await supabase
    .from('vendita_reload')
    .update(updatePayload)
    .eq('id', cleanString(payload.id))
    .select('*')
    .maybeSingle();

  if (error) throw new Error(readableError(error, 'Errore aggiornamento reload'));
  if (!data) throw new Error('Reload non trovato');

  return data;
}

async function toggleReload(supabase, payload) {
  assertRequired(payload.id, 'id');

  const attivo = parseBoolean(payload.attivo, null);

  if (attivo === null) {
    throw new Error('Campo obbligatorio non valido: attivo');
  }

  const { data, error } = await supabase
    .from('vendita_reload')
    .update({ attivo })
    .eq('id', cleanString(payload.id))
    .select('*')
    .maybeSingle();

  if (error) throw new Error(readableError(error, 'Errore toggle reload'));
  if (!data) throw new Error('Reload non trovato');

  return data;
}

async function handleAction(supabase, payload) {
  const action = cleanString(payload.action);

  if (!action) {
    throw new Error('Campo obbligatorio mancante: action');
  }

  switch (action) {
    case 'create_offerta':
      return createOfferta(supabase, payload);
    case 'update_offerta':
      return updateOfferta(supabase, payload);
    case 'toggle_offerta':
      return toggleOfferta(supabase, payload);
    case 'create_opzione':
      return createOpzione(supabase, payload);
    case 'update_opzione':
      return updateOpzione(supabase, payload);
    case 'toggle_opzione':
      return toggleOpzione(supabase, payload);
    case 'create_reload':
      return createReload(supabase, payload);
    case 'update_reload':
      return updateReload(supabase, payload);
    case 'toggle_reload':
      return toggleReload(supabase, payload);
    default:
      throw new Error(`Action non supportata: ${action}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  let supabase;

  try {
    supabase = getSupabaseClient();
  } catch (error) {
    return response(500, { success: false, error: readableError(error) });
  }

  if (event.httpMethod === 'GET') {
    try {
      const config = await loadFullConfig(supabase);

      return response(200, {
        success: true,
        ...config
      });
    } catch (error) {
      return response(500, {
        success: false,
        error: readableError(error, 'Errore caricamento configurazione vendita')
      });
    }
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, error: 'Metodo non consentito: usa GET o POST' });
  }

  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';

  if (!contentType.toLowerCase().includes('application/json')) {
    return response(415, {
      success: false,
      error: 'Content-Type non valido: usare application/json'
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

  try {
    const data = await handleAction(supabase, payload);

    return response(200, {
      success: true,
      data
    });
  } catch (error) {
    const message = readableError(error, 'Errore esecuzione action');
    const statusCode = /obbligatorio|non supportata|non valido|numerico/i.test(message) ? 400 : 500;

    return response(statusCode, {
      success: false,
      error: message
    });
  }
};
