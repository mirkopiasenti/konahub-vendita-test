const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

const VALID_CLUSTERS = ['Consumer', 'Business'];

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

function parseBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'si', 'sì'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return fallback;
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Campo obbligatorio mancante: ${fieldName}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Campo non valido: ${fieldName} deve essere numerico`);
  }
  return parsed;
}

function toInteger(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readableError(error, fallback = 'Errore configurazione vendita') {
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
  if (!cleanString(value)) {
    throw new Error(`Campo obbligatorio mancante: ${fieldName}`);
  }
}

function normalizeCluster(value, { required = true } = {}) {
  const cleaned = cleanString(value);
  if (!cleaned) {
    if (required) throw new Error('Campo obbligatorio mancante: cluster_cliente');
    return null;
  }
  if (!VALID_CLUSTERS.includes(cleaned)) {
    throw new Error('Cluster non valido: usa Consumer o Business');
  }
  return cleaned;
}

async function loadFullConfig(supabase) {
  const [categorieRes, offerteRes, opzioniRes, reloadRes, regoleRes] = await Promise.all([
    supabase
      .from('vendita_categorie')
      .select('*')
      .order('ordine', { ascending: true })
      .order('nome', { ascending: true }),
    supabase
      .from('vendita_offerte')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
      .from('vendita_opzioni')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
      .from('vendita_reload')
      .select('*')
      .order('ordine', { ascending: true })
      .order('nome', { ascending: true }),
    supabase
      .from('vendita_documenti_regole')
      .select('*')
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

  return {
    success: true,
    categorie: categorieRes.data || [],
    offerte: offerteRes.data || [],
    opzioni: opzioniRes.data || [],
    reload: reloadRes.data || [],
    documenti_regole: regoleRes.data || []
  };
}

function buildOffertaPayload(payload) {
  assertRequired(payload.categoria_id, 'categoria_id');
  assertRequired(payload.nome_offerta, 'nome_offerta');

  const punteggioGara = requireNumber(payload.punteggio_gara, 'punteggio_gara');
  const punteggioExtraGara = toNumber(payload.punteggio_extra_gara, 0);

  return {
    categoria_id: cleanString(payload.categoria_id),
    cluster_cliente: normalizeCluster(payload.cluster_cliente),
    nome_offerta: cleanString(payload.nome_offerta),
    descrizione: cleanString(payload.descrizione),
    punteggio_gara: punteggioGara,
    punteggio_extra_gara: punteggioExtraGara,
    attiva: parseBoolean(payload.attiva, true)
  };
}

function buildOpzionePayload(payload) {
  assertRequired(payload.categoria_id, 'categoria_id');
  assertRequired(payload.offerta_id, 'offerta_id');
  assertRequired(payload.nome_opzione, 'nome_opzione');

  const punteggioGara = requireNumber(payload.punteggio_gara, 'punteggio_gara');
  const punteggioExtraGara = toNumber(payload.punteggio_extra_gara, 0);

  return {
    categoria_id: cleanString(payload.categoria_id),
    offerta_id: cleanString(payload.offerta_id),
    cluster_cliente: normalizeCluster(payload.cluster_cliente),
    nome_opzione: cleanString(payload.nome_opzione),
    descrizione: cleanString(payload.descrizione),
    punteggio_gara: punteggioGara,
    punteggio_extra_gara: punteggioExtraGara,
    attiva: parseBoolean(payload.attiva, true)
  };
}

async function createOfferta(supabase, payload) {
  const { data, error } = await supabase
    .from('vendita_offerte')
    .insert(buildOffertaPayload(payload))
    .select('*')
    .single();

  if (error) throw new Error(readableError(error, 'Errore creazione offerta'));
  return data;
}

async function updateOfferta(supabase, payload) {
  assertRequired(payload.id, 'id');

  const { data, error } = await supabase
    .from('vendita_offerte')
    .update(buildOffertaPayload(payload))
    .eq('id', cleanString(payload.id))
    .select('*')
    .maybeSingle();

  if (error) throw new Error(readableError(error, 'Errore aggiornamento offerta'));
  if (!data) throw new Error('Offerta non trovata');
  return data;
}

async function toggleOfferta(supabase, payload) {
  assertRequired(payload.id, 'id');
  const attiva = parseBoolean(payload.attiva, null);
  if (attiva === null) throw new Error('Campo obbligatorio non valido: attiva');

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
  const { data, error } = await supabase
    .from('vendita_opzioni')
    .insert(buildOpzionePayload(payload))
    .select('*')
    .single();

  if (error) throw new Error(readableError(error, 'Errore creazione opzione'));
  return data;
}

async function updateOpzione(supabase, payload) {
  assertRequired(payload.id, 'id');

  const { data, error } = await supabase
    .from('vendita_opzioni')
    .update(buildOpzionePayload(payload))
    .eq('id', cleanString(payload.id))
    .select('*')
    .maybeSingle();

  if (error) throw new Error(readableError(error, 'Errore aggiornamento opzione'));
  if (!data) throw new Error('Opzione non trovata');
  return data;
}

async function toggleOpzione(supabase, payload) {
  assertRequired(payload.id, 'id');
  const attiva = parseBoolean(payload.attiva, null);
  if (attiva === null) throw new Error('Campo obbligatorio non valido: attiva');

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

async function toggleReload(supabase, payload) {
  assertRequired(payload.id, 'id');
  const attivo = parseBoolean(payload.attivo, null);
  if (attivo === null) throw new Error('Campo obbligatorio non valido: attivo');

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
  if (!action) throw new Error('Campo obbligatorio mancante: action');

  switch (action) {
    case 'create_offerta': return createOfferta(supabase, payload);
    case 'update_offerta': return updateOfferta(supabase, payload);
    case 'toggle_offerta': return toggleOfferta(supabase, payload);
    case 'create_opzione': return createOpzione(supabase, payload);
    case 'update_opzione': return updateOpzione(supabase, payload);
    case 'toggle_opzione': return toggleOpzione(supabase, payload);
    case 'create_reload': return createReload(supabase, payload);
    case 'toggle_reload': return toggleReload(supabase, payload);
    default: throw new Error(`Action non supportata: ${action}`);
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
      return response(200, await loadFullConfig(supabase));
    } catch (error) {
      return response(500, { success: false, error: readableError(error) });
    }
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, error: 'Metodo non consentito: usa GET o POST' });
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const data = await handleAction(supabase, payload);
    return response(200, { success: true, data });
  } catch (error) {
    return response(500, { success: false, error: readableError(error) });
  }
};
