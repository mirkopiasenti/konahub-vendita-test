/**
 * GET /.netlify/functions/check-consenso-privacy?anagrafica_id=<uuid>
 *
 * Verifica se per l'anagrafica esiste un consenso privacy gia' attivo
 * (stato='confermato', non scaduto, non revocato). Usato dal wizard
 * upload-contratti-vendita per fare dedupe sulla finestra di validita'
 * di 48 mesi: se il consenso e' ancora valido, il wizard salta il flusso
 * OTP/cartaceo e procede direttamente all'upload pratica.
 *
 * Response 200:
 *   {
 *     valido: true,
 *     consenso: {
 *       id, modalita, valido_fino_al, confermato_at,
 *       consenso_marketing, modalita_label
 *     }
 *   }
 * oppure:
 *   { valido: false }
 *
 * Auth: Bearer obbligatorio.
 */

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_lib/require-auth');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
};

function response(statusCode, payload) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return response(405, { success: false, error: 'Metodo non consentito: usa GET' });
    }

    const auth = await requireAuth(event);
    if (!auth.ok) return response(auth.status, { success: false, error: auth.error });

    const qs = event.queryStringParameters || {};
    const anagraficaId = String(qs.anagrafica_id || '').trim().toLowerCase();
    if (!anagraficaId || !UUID_REGEX.test(anagraficaId)) {
        return response(400, { success: false, error: 'anagrafica_id mancante o non valido' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE) {
        return response(500, { success: false, error: 'Configurazione server incompleta' });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    try {
        const { data, error } = await supabase
            .from('vendita_consensi_privacy')
            .select('id, modalita, valido_fino_al, otp_confermato_at, created_at, consenso_marketing, pdf_storage_path, pdf_filename')
            .eq('anagrafica_id', anagraficaId)
            .eq('stato', 'confermato')
            .is('revocato_at', null)
            .gt('valido_fino_al', new Date().toISOString())
            .order('valido_fino_al', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            return response(500, { success: false, error: 'Errore query consenso: ' + error.message });
        }

        if (!data) {
            return response(200, { success: true, valido: false });
        }

        const modalitaLabel = data.modalita === 'cartaceo'
            ? 'Modulo cartaceo firmato'
            : 'Firma elettronica via OTP SMS';

        return response(200, {
            success: true,
            valido: true,
            consenso: {
                id: data.id,
                modalita: data.modalita,
                modalita_label: modalitaLabel,
                valido_fino_al: data.valido_fino_al,
                confermato_at: data.otp_confermato_at || data.created_at,
                consenso_marketing: !!data.consenso_marketing,
                pdf_storage_path: data.pdf_storage_path,
                pdf_filename: data.pdf_filename
            }
        });
    } catch (e) {
        return response(500, { success: false, error: 'Errore inatteso: ' + (e?.message || String(e)) });
    }
};
