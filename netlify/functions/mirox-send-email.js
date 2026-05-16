/**
 * Endpoint pubblico — chiamato dai client HTML (via window.MiroxMailer.send)
 *
 * POST /.netlify/functions/mirox-send-email
 * Body JSON:
 *   {
 *     "to": "info@konatech.it",         // obbligatorio
 *     "subject": "...",                 // opzionale se si usa template
 *     "html": "<html>...</html>",       // opzionale se si usa template
 *     "template": "rientro_sim",        // opzionale: slug template DB
 *     "vars": { "cliente": "...", ... }, // variabili per {{placeholder}}
 *     "related_table": "vendita_switch_sim", // metadati log (opzionale)
 *     "related_id": "42"                // metadati log (opzionale)
 *   }
 *
 * Risposta:
 *   { ok: true, messageId: "..." }      // 200
 *   { ok: false, error: "..." }         // 4xx / 5xx
 */

const { sendEmail } = require('./_lib/mailer');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

function reply(statusCode, payload) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return reply(405, { ok: false, error: 'Metodo non consentito (usa POST)' });
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return reply(400, { ok: false, error: 'Body JSON non valido' });
    }

    if (!body.to) {
        return reply(400, { ok: false, error: 'Parametro "to" obbligatorio' });
    }
    if (!body.template && !body.html) {
        return reply(400, { ok: false, error: 'Specificare "template" o "html"' });
    }

    try {
        const result = await sendEmail({
            to: body.to,
            subject: body.subject,
            html: body.html,
            template: body.template,
            vars: body.vars || {},
            related_table: body.related_table,
            related_id: body.related_id
        });
        if (!result.ok) {
            return reply(500, { ok: false, error: result.error });
        }
        return reply(200, { ok: true, messageId: result.messageId });
    } catch (err) {
        console.error('mirox-send-email error:', err);
        return reply(500, { ok: false, error: err.message });
    }
};
