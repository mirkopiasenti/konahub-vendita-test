const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

function normalizeCfPiva(value) {
  return String(value || '').trim().toUpperCase();
}

function readableError(error, fallback = 'Errore ricerca anagrafica') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || error.error_description || error.details || fallback;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return response(405, { success: false, error: 'Metodo non consentito: usa GET' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return response(500, {
      success: false,
      error: 'Variabili ambiente mancanti: SUPABASE_URL e/o SUPABASE_SERVICE_ROLE_KEY'
    });
  }

  const normalizedCfPiva = normalizeCfPiva(event.queryStringParameters?.cf_piva);

  if (!normalizedCfPiva) {
    return response(400, {
      success: false,
      error: 'Parametro obbligatorio mancante o vuoto: cf_piva'
    });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data, error } = await supabase
      .from('anagrafica')
      .select('id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, provincia, comune, via, civico, created_at, updated_at')
      .ilike('cf_piva', normalizedCfPiva)
      .limit(1);

    if (error) {
      return response(500, {
        success: false,
        error: readableError(error)
      });
    }

    const foundRow = Array.isArray(data) ? data[0] || null : null;

    if (!foundRow) {
      return response(200, {
        success: true,
        found: false
      });
    }

    return response(200, {
      success: true,
      found: true,
      data: foundRow
    });
  } catch (error) {
    return response(500, {
      success: false,
      error: readableError(error)
    });
  }
};
