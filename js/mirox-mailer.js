/**
 * Mirox Mailer — client helper.
 * Esposto come window.MiroxMailer.
 *
 * Uso semplice (template DB):
 *
 *   await MiroxMailer.send({
 *     to: 'info@konatech.it',
 *     template: 'rientro_sim',
 *     vars: { cliente: 'Mario Rossi', mnp: '3331234567', ... }
 *   });
 *
 * Uso HTML diretto (senza template DB):
 *
 *   await MiroxMailer.send({
 *     to: 'admin@konatech.it',
 *     subject: 'Promemoria veloce',
 *     html: '<p>Ciao</p>'
 *   });
 */

(function (window) {
    'use strict';

    const ENDPOINT = '/.netlify/functions/mirox-send-email';

    async function send(opts) {
        if (!opts || !opts.to) throw new Error('Parametro "to" obbligatorio');
        if (!opts.template && !opts.html) throw new Error('Specificare "template" o "html"');

        const payload = {
            to: opts.to,
            subject: opts.subject,
            html: opts.html,
            template: opts.template,
            vars: opts.vars || {},
            related_table: opts.related_table || null,
            related_id: opts.related_id ? String(opts.related_id) : null
        };

        try {
            const fetcher = (window.MiroxApi && window.MiroxApi.fetch) ? window.MiroxApi.fetch : fetch;
            const res = await fetcher(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) {
                const errMsg = (data && data.error) || `Errore HTTP ${res.status}`;
                throw new Error(errMsg);
            }
            return data;
        } catch (err) {
            // Non blocchiamo mai il flusso utente per errori email.
            console.error('MiroxMailer.send error:', err.message);
            return { ok: false, error: err.message };
        }
    }

    window.MiroxMailer = { send };
})(window);
