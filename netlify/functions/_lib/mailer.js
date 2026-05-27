/**
 * Mirox Mailer (shared) — usata da:
 *   - mirox-send-email.js  (endpoint pubblico chiamato dai client)
 *   - cron-rientro-sim.js  (cron giornaliero)
 *
 * Fa 3 cose:
 *   1. Carica template da Supabase (tabella email_template), se richiesto.
 *   2. Renderizza template sostituendo {{placeholder}} con i valori passati.
 *   3. Invia via SMTP Gmail (nodemailer) e logga su email_log.
 *
 * Env vars richieste:
 *   - SMTP_USER                 (es. mirox.crm@gmail.com)
 *   - SMTP_PASS                 (App Password Gmail)
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - MAIL_FROM_NAME            (opzionale, default "Mirox CRM")
 */

const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

let _supabase = null;
function getSupabase() {
    if (_supabase) return _supabase;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY mancanti');
    _supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    return _supabase;
}

let _transporter = null;
function getTransporter() {
    if (_transporter) return _transporter;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) throw new Error('SMTP_USER e SMTP_PASS mancanti');
    _transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user, pass }
    });
    return _transporter;
}

/**
 * Sostituisce tutti i {{placeholder}} in una stringa con i valori passati.
 * Variabili non valorizzate vengono sostituite con stringa vuota.
 */
function renderPlaceholders(template, vars) {
    if (!template) return '';
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
        const v = vars && vars[key];
        return (v === undefined || v === null) ? '' : String(v);
    });
}

/**
 * Carica un template dal DB per slug.
 */
async function loadTemplate(slug) {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from('email_template')
        .select('slug, subject, html_body, attivo')
        .eq('slug', slug)
        .single();
    if (error) throw new Error(`Template "${slug}" non trovato: ${error.message}`);
    if (!data) throw new Error(`Template "${slug}" non trovato`);
    if (data.attivo === false) throw new Error(`Template "${slug}" disattivato`);
    return data;
}

/**
 * Scrive una riga nella tabella email_log. Mai blocca l'invio.
 */
async function writeLog(row) {
    try {
        const supabase = getSupabase();
        await supabase.from('email_log').insert(row);
    } catch (e) {
        console.error('email_log write failed:', e.message);
    }
}

/**
 * sendEmail — entry point principale.
 *
 * @param {Object} opts
 * @param {string|string[]} opts.to         destinatario (obbligatorio)
 * @param {string} [opts.subject]           se assente e si usa template, viene preso dal template
 * @param {string} [opts.html]              corpo HTML (oppure usa template)
 * @param {string} [opts.template]          slug template da DB
 * @param {Object} [opts.vars]              variabili per sostituzione {{placeholder}}
 * @param {string} [opts.related_table]     metadati log
 * @param {string} [opts.related_id]        metadati log
 * @returns {Promise<{ok:boolean, messageId?:string, error?:string}>}
 */
async function sendEmail(opts) {
    const to = opts.to;
    if (!to) throw new Error('Parametro "to" obbligatorio');

    let subject = opts.subject || '';
    let html = opts.html || '';
    const vars = opts.vars || {};

    // Se template, carica e renderizza
    if (opts.template) {
        const tpl = await loadTemplate(opts.template);
        subject = renderPlaceholders(opts.subject || tpl.subject, vars);
        html = renderPlaceholders(tpl.html_body, vars);
    } else {
        subject = renderPlaceholders(subject, vars);
        html = renderPlaceholders(html, vars);
    }

    if (!subject) throw new Error('Subject mancante');
    if (!html) throw new Error('Corpo HTML mancante (passare "html" o "template")');

    const fromName = process.env.MAIL_FROM_NAME || 'Mirox CRM';
    const fromEmail = process.env.SMTP_USER;
    const from = `${fromName} <${fromEmail}>`;

    try {
        const transporter = getTransporter();
        const info = await transporter.sendMail({ from, to, subject, html });

        await writeLog({
            destinatario: Array.isArray(to) ? to.join(', ') : to,
            mittente: from,
            subject,
            template_slug: opts.template || null,
            status: 'sent',
            error: null,
            related_table: opts.related_table || null,
            related_id: opts.related_id ? String(opts.related_id) : null,
            payload: { messageId: info.messageId, response: info.response }
        });

        return { ok: true, messageId: info.messageId };
    } catch (err) {
        await writeLog({
            destinatario: Array.isArray(to) ? to.join(', ') : to,
            mittente: from,
            subject,
            template_slug: opts.template || null,
            status: 'error',
            error: err.message,
            related_table: opts.related_table || null,
            related_id: opts.related_id ? String(opts.related_id) : null,
            payload: null
        });
        return { ok: false, error: err.message };
    }
}

module.exports = { sendEmail, loadTemplate, renderPlaceholders, getSupabase };
