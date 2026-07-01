/**
 * Wrapper per l'invio di SMS transactional (OTP) tramite Smshosting.
 *
 * Endpoint: https://api.smshosting.it/rest/api/sms/send
 * Auth:     HTTP Basic (API key + API secret)
 *
 * Env vars richieste (vedi README.md):
 *  - SMSHOSTING_API_KEY     (username dell'API access)
 *  - SMSHOSTING_API_SECRET  (password dell'API access)
 *  - SMSHOSTING_SENDER      (mittente alfanumerico max 11 char, es. "MIROX")
 *
 * Modalita' simulazione (sviluppo/test):
 *  - Se SMSHOSTING_SIMULATE === 'true' la funzione non invia davvero,
 *    logga solo il messaggio e ritorna un id fittizio. Usalo per testare
 *    il flusso senza spendere credito SMS.
 *
 * Uso:
 *   const { sendOtpSms, normalizeMobileNumber } = require('./_lib/smshosting');
 *   const { id, status, simulated } = await sendOtpSms({
 *     to: '+393331234567', otp: '123456'
 *   });
 */

const ENDPOINT = 'https://api.smshosting.it/rest/api/sms/send';
const TIMEOUT_MS = 12000; // 12s max per chiamata Smshosting

/**
 * Normalizza un numero di cellulare a formato E.164 (+39...).
 * Accetta varianti tipiche: "3331234567", "+39 333 1234567", "0039333.1234567"
 * Ritorna stringa nel formato "+39XXXXXXXXXX" oppure null se non e' valido.
 */
function normalizeMobileNumber(raw) {
    if (raw === null || raw === undefined) return null;
    let s = String(raw).trim();
    if (!s) return null;
    // Rimuove spazi, punti, trattini, parentesi
    s = s.replace(/[\s.\-()/]/g, '');
    // 0039 -> +39
    if (/^0039\d+$/.test(s)) s = '+' + s.slice(2);
    // Numero italiano senza prefisso (cellulari iniziano con 3, 10 cifre totali)
    if (/^3\d{9}$/.test(s)) s = '+39' + s;
    // Validazione finale: + seguito da 11-15 cifre
    if (!/^\+\d{11,15}$/.test(s)) return null;
    return s;
}

/**
 * Genera un OTP numerico di N cifre (default 6).
 */
function generateOtp(digits = 6) {
    const max = 10 ** digits;
    // crypto-grade per evitare predicibilita'
    const buf = require('crypto').randomBytes(4);
    const n = buf.readUInt32BE(0) % max;
    return String(n).padStart(digits, '0');
}

function buildAuthHeader() {
    const k = process.env.SMSHOSTING_API_KEY;
    const s = process.env.SMSHOSTING_API_SECRET;
    if (!k || !s) return null;
    return 'Basic ' + Buffer.from(`${k}:${s}`).toString('base64');
}

/**
 * Invio SMS tramite Smshosting. Ritorna:
 *  { ok: true, id, status, simulated }
 *  oppure
 *  { ok: false, status: number, error: string, providerStatus?, providerMessage? }
 *
 * Non lancia eccezioni: gli errori sono nel return value.
 */
async function sendSms({ to, text, sender }) {
    const toNormalized = normalizeMobileNumber(to);
    if (!toNormalized) {
        return { ok: false, status: 400, error: 'Numero cellulare non valido (atteso formato italiano o E.164)' };
    }
    if (!text || typeof text !== 'string') {
        return { ok: false, status: 400, error: 'Testo SMS mancante' };
    }

    const mittente = String(sender || process.env.SMSHOSTING_SENDER || 'MIROX').slice(0, 11);

    // Modalita' simulazione
    if (String(process.env.SMSHOSTING_SIMULATE || '').toLowerCase() === 'true') {
        console.log('[smshosting][SIMULATED]', { to: toNormalized, from: mittente, text });
        return {
            ok: true,
            simulated: true,
            id: 'sim_' + Date.now(),
            status: 'OK'
        };
    }

    const authHeader = buildAuthHeader();
    if (!authHeader) {
        return { ok: false, status: 500, error: 'Credenziali Smshosting mancanti (SMSHOSTING_API_KEY/SECRET non configurati)' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': authHeader
            },
            body: JSON.stringify({
                from: mittente,
                to: toNormalized,
                text: text
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        let body = null;
        try { body = await res.json(); } catch (_) { body = null; }

        if (!res.ok) {
            return {
                ok: false,
                status: 502,
                error: 'Errore Smshosting',
                providerStatus: res.status,
                providerMessage: body?.message || body?.error || `HTTP ${res.status}`,
                providerBody: body
            };
        }

        const id =
            body?.id
            || body?.messageId
            || body?.smsId
            || (Array.isArray(body?.messages) && body.messages[0]?.id)
            || null;

        return {
            ok: true,
            id: id || ('sms_' + Date.now()),
            status: body?.status || 'OK',
            providerBody: body
        };
    } catch (e) {
        clearTimeout(timeout);
        if (e.name === 'AbortError') {
            return { ok: false, status: 504, error: 'Timeout chiamata Smshosting' };
        }
        return { ok: false, status: 502, error: 'Eccezione invio SMS: ' + (e?.message || String(e)) };
    }
}

/**
 * Helper specializzato per OTP. Costruisce il testo standard.
 */
async function sendOtpSms({ to, otp, sender }) {
    const text =
        `Il tuo codice di verifica è: ${otp}\n\n` +
        `Non condividere il codice.\n\n` +
        `Per assistenza, contattaci su WhatsApp:\n` +
        `https://wa.me/390442750029?text=Ciao%2C%20ho%20bisogno%20di%20assistenza%20per%20la%20verifica`;
    return sendSms({ to, text, sender });
}

module.exports = {
    sendSms,
    sendOtpSms,
    normalizeMobileNumber,
    generateOtp
};
