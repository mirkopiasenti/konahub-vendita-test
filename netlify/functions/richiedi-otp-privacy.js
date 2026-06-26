/**
 * POST /.netlify/functions/richiedi-otp-privacy
 *
 * Body JSON:
 *   {
 *     anagrafica_id: uuid,            // obbligatorio
 *     cellulare: string,              // numero a cui mandare l'OTP (puo' essere
 *                                     //   diverso dal cellulare in anagrafica)
 *     consenso_marketing: boolean,    // opzionale, default false
 *     pratica_id: uuid|null           // opzionale, riferimento di origine
 *   }
 *
 * Side effects:
 *  1) Invalida eventuali consensi pending precedenti della stessa anagrafica
 *     (li marca stato='scaduto')
 *  2) Crea nuovo record vendita_consensi_privacy con stato='pending', OTP
 *     hashato (sha256(otp+salt)) e scadenza 10 min
 *  3) Invia SMS via Smshosting con il codice in chiaro al cliente
 *
 * Rate limiting:
 *  - max 3 invii consensi per anagrafica nell'ultima ora
 *  - cooldown 60s dal precedente invio per anagrafica
 *
 * Response 200:
 *   {
 *     success: true,
 *     consenso_id: uuid,
 *     scade_at: ISO,
 *     cellulare_inviato: '+39...',
 *     sms_id: string,
 *     simulated: bool
 *   }
 *
 * Auth: Bearer obbligatorio.
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { requireAuth } = require('./_lib/require-auth');
const { sendOtpSms, normalizeMobileNumber, generateOtp } = require('./_lib/smshosting');
const { INFORMATIVA_VERSIONE } = require('./_lib/pdf-consenso');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OTP_SCADENZA_MIN = 10;
const COOLDOWN_SECONDS = 60;
const MAX_INVII_PER_ORA = 3;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

function response(statusCode, payload) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function hashOtp(otp, salt) {
    return crypto.createHash('sha256').update(otp + ':' + salt).digest('hex');
}

function getClientIp(event) {
    const h = event.headers || {};
    return (
        h['x-nf-client-connection-ip']
        || (h['x-forwarded-for'] || '').split(',')[0].trim()
        || h['client-ip']
        || null
    );
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return response(405, { success: false, error: 'Metodo non consentito: usa POST' });
    }

    const auth = await requireAuth(event);
    if (!auth.ok) return response(auth.status, { success: false, error: auth.error });
    const operatoreId = auth.user?.id || null;
    const operatoreNome = (auth.profilo?.nome || auth.profilo?.email || '').trim() || null;

    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch (_) { return response(400, { success: false, error: 'JSON non valido' }); }

    const anagraficaId = String(payload.anagrafica_id || '').trim().toLowerCase();
    if (!anagraficaId || !UUID_REGEX.test(anagraficaId)) {
        return response(400, { success: false, error: 'anagrafica_id mancante o non valido' });
    }

    const cellulareNormalizzato = normalizeMobileNumber(payload.cellulare);
    if (!cellulareNormalizzato) {
        return response(400, { success: false, error: 'Cellulare non valido: usare formato italiano o E.164' });
    }

    const consensoMarketing = !!payload.consenso_marketing;
    const praticaId = (payload.pratica_id && UUID_REGEX.test(String(payload.pratica_id))) ? String(payload.pratica_id).toLowerCase() : null;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE) {
        return response(500, { success: false, error: 'Configurazione server incompleta' });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    try {
        // 1) Verifica anagrafica esiste + recupera dati per snapshot
        const { data: anagrafica, error: anagraficaErr } = await supabase
            .from('anagrafica')
            .select('id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, email, provincia, comune, via, civico')
            .eq('id', anagraficaId)
            .maybeSingle();
        if (anagraficaErr) {
            return response(500, { success: false, error: 'Errore lettura anagrafica: ' + anagraficaErr.message });
        }
        if (!anagrafica) {
            return response(404, { success: false, error: 'Anagrafica non trovata' });
        }

        // 2) Rate limiting: ultimi N record per anagrafica nelle ultime 1 ora
        const oraFa = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recenti, error: recentiErr } = await supabase
            .from('vendita_consensi_privacy')
            .select('id, otp_inviato_at, stato')
            .eq('anagrafica_id', anagraficaId)
            .eq('modalita', 'otp_sms')
            .gte('otp_inviato_at', oraFa)
            .order('otp_inviato_at', { ascending: false });
        if (recentiErr) {
            return response(500, { success: false, error: 'Errore lettura storico OTP: ' + recentiErr.message });
        }

        if ((recenti || []).length >= MAX_INVII_PER_ORA) {
            return response(429, {
                success: false,
                error: `Troppi tentativi: hai gia' richiesto ${MAX_INVII_PER_ORA} OTP nell'ultima ora per questo cliente. Riprova piu' tardi o usa il modulo cartaceo.`
            });
        }
        const ultimo = recenti?.[0];
        if (ultimo?.otp_inviato_at) {
            const elapsed = (Date.now() - new Date(ultimo.otp_inviato_at).getTime()) / 1000;
            if (elapsed < COOLDOWN_SECONDS) {
                const wait = Math.ceil(COOLDOWN_SECONDS - elapsed);
                return response(429, {
                    success: false,
                    error: `Attendi ${wait} secondi prima di richiedere un nuovo OTP per questo cliente.`,
                    retry_after_seconds: wait
                });
            }
        }

        // 3) Invalida pending precedenti (stato='scaduto')
        await supabase
            .from('vendita_consensi_privacy')
            .update({ stato: 'scaduto' })
            .eq('anagrafica_id', anagraficaId)
            .eq('stato', 'pending');

        // 4) Genera OTP + hash + salt
        const otp = generateOtp(6);
        const salt = crypto.randomBytes(16).toString('hex');
        const otpHash = hashOtp(otp, salt);
        const ora = new Date();
        const scade = new Date(ora.getTime() + OTP_SCADENZA_MIN * 60 * 1000);

        const snapshotAnagrafica = {
            cf_piva: anagrafica.cf_piva,
            cluster: anagrafica.cluster,
            ragione_sociale: anagrafica.ragione_sociale,
            nome_referente: anagrafica.nome_referente,
            cellulare: anagrafica.cellulare,
            email: anagrafica.email,
            provincia: anagrafica.provincia,
            comune: anagrafica.comune,
            via: anagrafica.via,
            civico: anagrafica.civico
        };

        // 5) INSERT record pending
        const { data: inserted, error: insertErr } = await supabase
            .from('vendita_consensi_privacy')
            .insert({
                anagrafica_id: anagraficaId,
                pratica_id: praticaId,
                modalita: 'otp_sms',
                cellulare_usato: cellulareNormalizzato,
                otp_hash: otpHash,
                otp_salt: salt,
                otp_inviato_at: ora.toISOString(),
                otp_scade_at: scade.toISOString(),
                otp_tentativi: 0,
                otp_reinvii: 0,
                stato: 'pending',
                informativa_versione: INFORMATIVA_VERSIONE,
                consenso_contratto: true,
                consenso_marketing: consensoMarketing,
                operatore_id: operatoreId,
                ip_operatore: getClientIp(event),
                user_agent_operatore: (event.headers?.['user-agent'] || '').slice(0, 500) || null,
                snapshot_anagrafica: snapshotAnagrafica
            })
            .select('id, otp_scade_at')
            .single();
        if (insertErr) {
            return response(500, { success: false, error: 'Errore creazione record consenso: ' + insertErr.message });
        }
        const consensoId = inserted.id;

        // 6) Invia SMS
        const smsResult = await sendOtpSms({ to: cellulareNormalizzato, otp });
        if (!smsResult.ok) {
            // Marca record come 'fallito' per audit
            await supabase
                .from('vendita_consensi_privacy')
                .update({ stato: 'fallito' })
                .eq('id', consensoId);

            return response(smsResult.status || 502, {
                success: false,
                error: 'Invio SMS fallito: ' + (smsResult.error || 'errore sconosciuto'),
                provider_status: smsResult.providerStatus,
                provider_message: smsResult.providerMessage
            });
        }

        // 7) Aggiorna record con sms_id
        await supabase
            .from('vendita_consensi_privacy')
            .update({ sms_provider_id: smsResult.id })
            .eq('id', consensoId);

        return response(200, {
            success: true,
            consenso_id: consensoId,
            scade_at: inserted.otp_scade_at,
            cellulare_inviato: cellulareNormalizzato,
            sms_id: smsResult.id,
            simulated: !!smsResult.simulated,
            operatore_nome: operatoreNome
        });
    } catch (e) {
        return response(500, { success: false, error: 'Errore inatteso: ' + (e?.message || String(e)) });
    }
};
