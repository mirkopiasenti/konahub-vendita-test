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

function readableError(error, fallback = 'Errore durante il caricamento configurazione vendita') {
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

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Carichiamo solo voci attive, ordinate in modo utile alla UI di test.
    const [categorieRes, offerteRes, opzioniRes, reloadRes] = await Promise.all([
      supabase
        .from('vendita_categorie')
        .select('*')
        .eq('attiva', true)
        .order('ordine', { ascending: true })
        .order('nome', { ascending: true }),
      supabase
        .from('vendita_offerte')
        .select('*')
        .eq('attiva', true)
        .order('nome_offerta', { ascending: true }),
      supabase
        .from('vendita_opzioni')
        .select('*')
        .eq('attiva', true)
        .order('nome_opzione', { ascending: true }),
      supabase
        .from('vendita_reload')
        .select('*')
        .eq('attivo', true)
        .order('ordine', { ascending: true })
        .order('nome', { ascending: true })
    ]);

    const firstError =
      categorieRes.error ||
      offerteRes.error ||
      opzioniRes.error ||
      reloadRes.error;

    if (firstError) {
      return response(500, {
        success: false,
        error: readableError(firstError)
      });
    }

    return response(200, {
      success: true,
      categorie: categorieRes.data || [],
      offerte: offerteRes.data || [],
      opzioni: opzioniRes.data || [],
      reload: reloadRes.data || []
    });
  } catch (error) {
    return response(500, {
      success: false,
      error: readableError(error)
    });
  }
};
