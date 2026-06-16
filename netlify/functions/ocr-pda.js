/**
 * OCR PDA — estrazione campi anagrafici da PDF contratto via Claude API
 *
 * POST /.netlify/functions/ocr-pda
 * Content-Type: multipart/form-data
 * Field 'file': PDF (max 20 MB, application/pdf)
 *
 * Risposta (sempre 200 anche su parsing parziale):
 *   { success: true, data: { cf_piva, ragione_sociale, nome_referente, cellulare,
 *                            email, provincia, comune, via, civico } }
 * In caso di errore "hard" (file mancante, API down): 4xx / 5xx con { success: false, error }.
 *
 * Env vars:
 *   - ANTHROPIC_API_KEY (obbligatoria)
 */

const Busboy = require('busboy');
const Anthropic = require('@anthropic-ai/sdk').default;

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MODEL = 'claude-haiku-4-5-20251001';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
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

const SYSTEM_PROMPT = `Sei un assistente specializzato nell'estrazione di dati anagrafici da contratti telefonici, internet ed energia italiani.
Ti viene fornito un PDF di un contratto. Devi estrarre i campi anagrafici del cliente/intestatario.

Rispondi SOLO con un oggetto JSON valido (niente testo prima o dopo), con queste chiavi esatte:
- cf_piva: codice fiscale (16 caratteri) o partita IVA (11 cifre) del cliente. SOLO il valore, senza prefissi tipo "CF:" o "P.IVA:".
- ragione_sociale: per privati il nome + cognome; per aziende la ragione sociale completa.
- nome_referente: nome della persona di riferimento (solo per aziende; per privati lascia null).
- cellulare: numero di cellulare italiano (10 cifre con prefisso 3xx). Solo cifre, senza prefisso internazionale.
- email: email del cliente. Solo l'indirizzo, lowercase.
- provincia: SIGLA a 2 lettere maiuscole (es. "VR", "MI", "RM"). Se hai solo la citta', desumila.
- comune: nome del comune.
- via: nome della via (senza il numero civico).
- civico: SOLO il numero civico (es. "12", "12/A").

Se un campo non e' presente, non e' leggibile, o non sei sicuro, usa null (NON inventare).
Esempio risposta valida:
{"cf_piva":"RSSMRA85M01H501Z","ragione_sociale":"Mario Rossi","nome_referente":null,"cellulare":"3331234567","email":"mario.rossi@example.it","provincia":"RM","comune":"Roma","via":"Via Roma","civico":"12"}`;

const EXPECTED_KEYS = ['cf_piva', 'ragione_sociale', 'nome_referente', 'cellulare', 'email', 'provincia', 'comune', 'via', 'civico'];

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
    const s = String(v).trim();
    out[k] = s === '' ? null : s;
  });
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { success: false, error: 'Metodo non consentito: usa POST' });

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
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
            },
            { type: 'text', text: 'Estrai i dati anagrafici dal contratto. Rispondi solo con JSON.' }
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
    const msg = error?.message || 'Errore durante OCR';
    return response(500, { success: false, error: msg });
  }
};
