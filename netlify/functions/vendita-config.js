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

    const [
      categorieRes,
      offerteRes,
      opzioniRes,
      reloadRes,
      regoleRes,
      offerteOpzioniRes,
      offerteReloadRes
    ] = await Promise.all([
      supabase
        .from('vendita_categorie')
        .select('id, nome, descrizione, attiva, ordine, created_at, updated_at')
        .eq('attiva', true)
        .order('ordine', { ascending: true })
        .order('nome', { ascending: true }),
      supabase
        .from('vendita_offerte')
        .select('id, categoria_id, cluster_cliente, nome_offerta, descrizione, punteggio_gara, punteggio_extra_gara, attiva, valid_from, valid_to, created_at, updated_at')
        .eq('attiva', true)
        .order('nome_offerta', { ascending: true }),
      supabase
        .from('vendita_opzioni')
        .select('*')
        .eq('attiva', true)
        .order('created_at', { ascending: false }),
      supabase
        .from('vendita_reload')
        .select('*')
        .eq('attivo', true)
        .order('ordine', { ascending: true })
        .order('nome', { ascending: true }),
      supabase
        .from('vendita_documenti_regole')
        .select('id, categoria_id, offerta_id, opzione_id, tipo_documento, obbligatorio, attiva, campo_condizione, valore_condizione, created_at, updated_at')
        .eq('attiva', true)
        .order('created_at', { ascending: false }),
      supabase
        .from('vendita_offerte_opzioni')
        .select('id, offerta_id, opzione_id, ordine, created_at')
        .order('ordine', { ascending: true }),
      supabase
        .from('vendita_offerte_reload')
        .select('id, offerta_id, reload_id, ordine, created_at')
        .order('ordine', { ascending: true })
    ]);

    const firstError =
      categorieRes.error ||
      offerteRes.error ||
      opzioniRes.error ||
      reloadRes.error ||
      regoleRes.error ||
      offerteOpzioniRes.error ||
      offerteReloadRes.error;

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
      reload: reloadRes.data || [],
      documenti_regole: regoleRes.data || [],
      offerte_opzioni: offerteOpzioniRes.data || [],
      offerte_reload: offerteReloadRes.data || []
    });
  } catch (error) {
    return response(500, {
      success: false,
      error: readableError(error)
    });
  }
};
