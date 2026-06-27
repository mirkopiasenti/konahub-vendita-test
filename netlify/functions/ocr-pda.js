/**
 * OCR PDA — estrazione campi anagrafici da PDF contratto via Claude API
 *
 * POST /.netlify/functions/ocr-pda
 * Content-Type: multipart/form-data
 * Field 'file': PDF (max 20 MB, application/pdf)
 *
 * Risposta (sempre 200 anche su parsing parziale):
 *   { success: true, data: {
 *       // Cliente
 *       cf_piva, ragione_sociale, nome_referente, cellulare, email,
 *       provincia, comune, via, civico,
 *       // Dispositivo (Mobile/Customer Base con device associato)
 *       dispositivo_presente, tipo_acquisto, imei, prezzo_device,
 *       // Migration 035: opzione SMARTPHONE RELOAD (true=SI[X], false=NO[X], null=non specificato)
 *       smartphone_reload
 *   } }
 * In caso di errore "hard" (file mancante, API down): 4xx / 5xx con { success: false, error }.
 *
 * Env vars:
 *   - ANTHROPIC_API_KEY (obbligatoria)
 */

const Busboy = require('busboy');
const Anthropic = require('@anthropic-ai/sdk').default;
const { requireAuth } = require('./_lib/require-auth');

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MODEL = 'claude-haiku-4-5-20251001';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function getHeader(headers, key) {
  if (!headers) return '';
  return headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()] || '';
}

function readMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType = getHeader(event.headers, 'content-type');
    if (!contentType || !contentType.toLowerCase().includes('multipart/form-data')) {
      reject(new Error('Content-Type non valido: usa multipart/form-data'));
      return;
    }

    const busboy = Busboy({ headers: { 'content-type': contentType } });
    let parsedFile = null;
    let fileTooLarge = false;

    busboy.on('file', (fieldName, file, info) => {
      if (fieldName !== 'file' || parsedFile) {
        file.resume();
        return;
      }
      const filename = info?.filename || '';
      const mimeType = (info?.mimeType || '').toLowerCase();
      const chunks = [];
      let size = 0;

      file.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_FILE_SIZE_BYTES) { fileTooLarge = true; return; }
        chunks.push(chunk);
      });
      file.on('end', () => {
        parsedFile = { originalName: filename, mimeType, size, buffer: Buffer.concat(chunks) };
      });
    });

    busboy.on('error', reject);
    busboy.on('finish', () => {
      if (!parsedFile) { reject(new Error('File PDF mancante')); return; }
      if (fileTooLarge || parsedFile.size > MAX_FILE_SIZE_BYTES) {
        reject(new Error('Il file supera il limite massimo di 20 MB'));
        return;
      }
      resolve(parsedFile);
    });

    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'binary');
    busboy.end(bodyBuffer);
  });
}

// Prompt compatto per minimizzare token. Output: SOLO JSON.
const SYSTEM_PROMPT = `Estrai dati del CLIENTE (non operatore) e del DISPOSITIVO da contratto WINDTRE IT. Solo JSON, no testo extra.
Null se mancante o non sicuro, NON inventare.

=== CLIENTE ===
cf_piva: CF(16) o PIVA(11), solo valore
ragione_sociale: nome+cognome (privato) o ragione azienda
nome_referente: SOLO il nome di battesimo (es. "Mario" da "Mario Rossi"). Per persona fisica: nome del titolare. Per azienda: nome del referente. Mai cognome.
cellulare: 10 cifre, prefisso 3xx, solo numero
email: lowercase
provincia: sigla 2 lettere maiuscole (VR,MI,RM)
comune: nome
via: senza civico
civico: solo numero (es 12, 12/A)

=== DISPOSITIVO ===
dispositivo_presente: true SOLO se il PDA contiene una sezione device con IMEI+prezzo compilati. false altrimenti.
tipo_acquisto: "VAR" o "Finanziamento" (mai altro). Riconosci da 3 segnali concordi nel PDA:
  - Titolo pagina device: "Proposta di Adesione Offerta con Finanziamento" -> Finanziamento; "Proposta di Adesione Offerta Vendita a Rate" -> VAR
  - Header sezione: "OFFERTA CON FINANZIAMENTO" -> Finanziamento; "VENDITA A RATE" -> VAR
  - Riga "Opzioni/servizi" della SIM: contiene "Vendita con Finanziamento" -> Finanziamento; contiene "Vendita a rate" -> VAR
  Se i segnali sono in contrasto o assenti -> null.
imei: 15 cifre, solo numero. Cerca in:
  - Mobile/Customer Base: campo "Numero IMEI:" nella sezione device
  - Fisso (FWA Indoor): campo "Seriale/IMEI:" nel "Dettaglio dell'ubicazione della linea" OPPURE "Seriale numero:" nella sezione PRODOTTI OPPURE "SERIALE MODEM" nel modulo cessione credito
prezzo_device: SOLO numero come stringa, usa punto decimale (es. "287.52","399.9","1509.90"). NO "euro", NO simbolo valuta. Cerca in:
  - Mobile/Customer Base: campo "Prezzo device: X.XX euro"
  - Fisso (FWA Indoor): "prezzo pari a X,XX euro" (sezione PRODOTTI) OPPURE "cede l'importo di X,XX euro" (modulo cessione credito)
  La virgola va normalizzata a punto: "287,52" -> "287.52".
tipo_acquisto: per Mobile/Customer Base segui i 3 segnali sopra. Per Fisso (FWA Indoor) -> null (il PDA Fisso non parla di VAR/Finanziamento).
smartphone_reload: solo per Mobile/Customer Base. Nella sezione OPZIONE AGGIUNTIVA c'e' "È stata richiesta l'attivazione contestuale dell'opzione SMARTPHONE RELOAD SI [ ] NO [ ]". Se la X (o "X") e' sulla casella SI -> true. Se la X e' sulla casella NO -> false. Se entrambe vuote o sezione assente (Fisso) -> null.

=== OUTPUT ===
DEVI sempre includere TUTTI e 14 i campi nel JSON, anche quelli null. NON omettere mai un campo. NON usare "..." come placeholder.

Esempio privato Mobile con device finanziato e smartphone reload SI:
{"cf_piva":"RSSMRA85M01H501Z","ragione_sociale":"Mario Rossi","nome_referente":"Mario","cellulare":"3331234567","email":"m.rossi@email.it","provincia":"RM","comune":"Roma","via":"Via Roma","civico":"12","dispositivo_presente":true,"tipo_acquisto":"Finanziamento","imei":"356178252707751","prezzo_device":"399.9","smartphone_reload":true}

Esempio azienda Mobile con device VAR e smartphone reload NO:
{"cf_piva":"04971220233","ragione_sociale":"Lucchiari Auto Srl","nome_referente":"Maicol","cellulare":"3520696271","email":"info@lucchiari.it","provincia":"VR","comune":"Sanguinetto","via":"Via Masaglie","civico":"96","dispositivo_presente":true,"tipo_acquisto":"VAR","imei":"355297179899755","prezzo_device":"1509.9","smartphone_reload":false}

Esempio SIM solo (senza device):
{"cf_piva":"RSSMRA85M01H501Z","ragione_sociale":"Mario Rossi","nome_referente":"Mario","cellulare":"3331234567","email":"m.rossi@email.it","provincia":"RM","comune":"Roma","via":"Via Roma","civico":"12","dispositivo_presente":false,"tipo_acquisto":null,"imei":null,"prezzo_device":null,"smartphone_reload":null}

Esempio Fisso FWA Indoor con modem (tipo_acquisto e smartphone_reload null perche' non applicabili al Fisso):
{"cf_piva":"CMRGZN48P07A837N","ragione_sociale":"Graziano Camera","nome_referente":"Graziano","cellulare":"3453923639","email":"camera.gra@gmail.com","provincia":"VR","comune":"Bevilacqua","via":"Piazza Marega","civico":"1050","dispositivo_presente":true,"tipo_acquisto":null,"imei":"352941750260290","prezzo_device":"287.52","smartphone_reload":null}`;

const EXPECTED_KEYS = [
  'cf_piva', 'ragione_sociale', 'nome_referente', 'cellulare', 'email',
  'provincia', 'comune', 'via', 'civico',
  'dispositivo_presente', 'tipo_acquisto', 'imei', 'prezzo_device',
  // Smartphone Reload (migration 035): true se SI[X], false se NO[X], null altrimenti
  'smartphone_reload'
];
const BOOLEAN_KEYS = new Set(['dispositivo_presente', 'smartphone_reload']);

function emptyResult() {
  const out = {};
  EXPECTED_KEYS.forEach((k) => { out[k] = null; });
  return out;
}

function normalizeResult(raw) {
  const out = emptyResult();
  if (!raw || typeof raw !== 'object') return out;
  EXPECTED_KEYS.forEach((k) => {
    const v = raw[k];
    if (v === null || v === undefined) { out[k] = null; return; }
    if (BOOLEAN_KEYS.has(k)) {
      if (v === true || v === 'true' || v === 1 || v === '1') out[k] = true;
      else if (v === false || v === 'false' || v === 0 || v === '0') out[k] = false;
      else out[k] = null;
      return;
    }
    const s = String(v).trim();
    if (s === '') { out[k] = null; return; }
    out[k] = s;
  });

  // Validazione mirata dei nuovi campi device: se il dato OCR e' "sporco",
  // meglio null che spazzatura nel form (l'operatore vede campo vuoto e
  // compila a mano, invece di trovarsi un valore plausibile ma errato).
  if (out.tipo_acquisto && !['VAR', 'Finanziamento'].includes(out.tipo_acquisto)) {
    out.tipo_acquisto = null;
  }
  if (out.imei && !/^\d{15}$/.test(out.imei)) {
    out.imei = null;
  }
  if (out.prezzo_device) {
    const normalized = out.prezzo_device.replace(',', '.').replace(/[^\d.]/g, '');
    out.prezzo_device = /^\d+(\.\d{1,2})?$/.test(normalized) ? normalized : null;
  }
  // Coerenza: se i 3 campi-chiave sono tutti vuoti, dispositivo_presente=false
  if (out.dispositivo_presente !== false &&
      !out.tipo_acquisto && !out.imei && !out.prezzo_device) {
    out.dispositivo_presente = false;
  }
  return out;
}

// Mappa errore SDK Anthropic -> codice strutturato + status HTTP + messaggio utente.
// Il client usa error_code per decidere quale popup mostrare (es. credito esaurito).
function classifyAnthropicError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const rawMsg = String(error?.message || '');
  const lowerMsg = rawMsg.toLowerCase();
  const errType = String(error?.error?.type || error?.type || '').toLowerCase();

  // Credito API esaurito: Anthropic ritorna 400 "Your credit balance is too low"
  if (
    lowerMsg.includes('credit balance') ||
    lowerMsg.includes('credit_balance') ||
    lowerMsg.includes('insufficient credit') ||
    lowerMsg.includes('insufficient_quota') ||
    lowerMsg.includes('billing') && lowerMsg.includes('low')
  ) {
    return {
      code: 'ocr_credit_exhausted',
      httpStatus: 503,
      userMessage: 'Servizio OCR temporaneamente non disponibile: il credito API Anthropic e\' esaurito. Procedi con l\'inserimento manuale.'
    };
  }
  if (status === 429 || errType === 'rate_limit_error' || lowerMsg.includes('rate limit')) {
    return {
      code: 'ocr_rate_limited',
      httpStatus: 503,
      userMessage: 'Servizio OCR temporaneamente non disponibile: troppe richieste in poco tempo. Riprova fra qualche secondo o procedi manualmente.'
    };
  }
  if (status === 401 || status === 403 || errType === 'authentication_error' || errType === 'permission_error') {
    return {
      code: 'ocr_auth_error',
      httpStatus: 503,
      userMessage: 'Servizio OCR non disponibile: la chiave API Anthropic non e\' valida. Procedi con l\'inserimento manuale.'
    };
  }
  if (status === 529 || (status >= 500 && status < 600) || errType === 'overloaded_error' || errType === 'api_error') {
    return {
      code: 'ocr_unavailable',
      httpStatus: 503,
      userMessage: 'Servizio OCR temporaneamente non disponibile (API Anthropic in errore). Procedi con l\'inserimento manuale.'
    };
  }
  return {
    code: 'ocr_generic_error',
    httpStatus: 500,
    userMessage: rawMsg || 'Errore generico durante l\'OCR. Procedi con l\'inserimento manuale.'
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { success: false, error: 'Metodo non consentito: usa POST' });

  // Protezione cost burn: l'OCR consuma ANTHROPIC_API_KEY a pagamento
  const auth = await requireAuth(event);
  if (!auth.ok) return response(auth.status, { success: false, error: auth.error });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return response(500, { success: false, error: 'ANTHROPIC_API_KEY non configurata nelle env Netlify' });
  }

  try {
    const file = await readMultipart(event);
    if (file.mimeType !== 'application/pdf') {
      return response(400, { success: false, error: 'Tipo file non valido: e\' consentito solo application/pdf' });
    }

    const client = new Anthropic({ apiKey });
    const pdfBase64 = file.buffer.toString('base64');

    const completion = await client.messages.create({
      model: MODEL,
      max_tokens: 600, // output ~250-300 token con i campi device, 600 e' cap conservativo
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
            },
            { type: 'text', text: 'Estrai dati cliente e dispositivo. Solo JSON.' }
          ]
        }
      ]
    });

    const textBlock = completion.content?.find((b) => b.type === 'text');
    const rawText = (textBlock?.text || '').trim();
    if (!rawText) return response(200, { success: true, data: emptyResult() });

    // Estrai il primo oggetto JSON dal testo (Claude tende a rispondere solo con JSON ma a volte aggiunge testo)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return response(200, { success: true, data: emptyResult() });

    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch (_) { return response(200, { success: true, data: emptyResult() }); }

    return response(200, { success: true, data: normalizeResult(parsed) });
  } catch (error) {
    console.error('ocr-pda error:', error);
    const classification = classifyAnthropicError(error);
    return response(classification.httpStatus, {
      success: false,
      error: classification.userMessage,
      error_code: classification.code,
      http_status: classification.httpStatus,
      provider_status: Number(error?.status || error?.statusCode || 0) || null,
      provider_message: String(error?.message || '').slice(0, 500)
    });
  }
};
