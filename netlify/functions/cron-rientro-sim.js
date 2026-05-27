/**
 * Netlify SCHEDULED FUNCTION
 * Cron: ogni giorno alle 07:00 UTC (09:00 ora italiana CEST)
 *
 * Cosa fa:
 *   1. Query Supabase: pratiche switch_sim con giorno_rientro = OGGI,
 *      mail_rientro_inviata_at IS NULL, stato NON 'KO'.
 *   2. Per ogni pratica invia una mail dedicata via Centro Email Mirox
 *      (template "rientro_sim").
 *   3. Aggiorna mail_rientro_inviata_at = now().
 *
 * Usa la libreria condivisa ./_lib/mailer (Gmail SMTP + email_log).
 *
 * Env vars:
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   - SMTP_USER, SMTP_PASS
 *   - NOTIFICA_RIENTRO_TO   (default: info@konatech.it)
 *   - PUBLIC_BASE_URL       (per i link nella mail, es. https://...netlify.app)
 */

const { sendEmail, getSupabase } = require('./_lib/mailer');

const TIMEZONE = 'Europe/Rome';
const schedule = '0 7 * * *';

function todayInRome() {
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit'
    });
    return fmt.format(new Date());
}

function fmtItDate(iso) {
    if (!iso) return '-';
    try {
        return new Intl.DateTimeFormat('it-IT', { timeZone: TIMEZONE }).format(new Date(iso));
    } catch (e) { return iso; }
}

const handler = async () => {
    const destinatario = process.env.NOTIFICA_RIENTRO_TO || 'info@konatech.it';
    const baseUrl = process.env.PUBLIC_BASE_URL || '';

    let supabase;
    try {
        supabase = getSupabase();
    } catch (e) {
        return { statusCode: 500, body: e.message };
    }

    const today = todayInRome();

    const { data: pratiche, error } = await supabase
        .from('vendita_switch_sim')
        .select('id, ragione_sociale_attuale, cf_piva_attuale, numero_portabilita, gestore, operatore_nome, data_inserimento, giorno_rientro, stato')
        .eq('giorno_rientro', today)
        .is('mail_rientro_inviata_at', null)
        .neq('stato', 'KO');

    if (error) {
        console.error('Errore Supabase:', error);
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: error.message }) };
    }

    if (!pratiche || pratiche.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ ok: true, sent: 0, message: 'Nessuna pratica da notificare oggi' }) };
    }

    const risultati = [];
    for (const p of pratiche) {
        try {
            const result = await sendEmail({
                to: destinatario,
                template: 'rientro_sim',
                vars: {
                    id: p.id,
                    cliente: p.ragione_sociale_attuale || '-',
                    cf: p.cf_piva_attuale || '-',
                    mnp: p.numero_portabilita || '-',
                    gestore: p.gestore || '-',
                    operatore: p.operatore_nome || '-',
                    data_inserimento: fmtItDate(p.data_inserimento),
                    link_switch: baseUrl ? `${baseUrl}/moduli/switch_sim.html` : '#'
                },
                related_table: 'vendita_switch_sim',
                related_id: p.id
            });
            if (!result.ok) throw new Error(result.error || 'invio fallito');

            const { error: upErr } = await supabase
                .from('vendita_switch_sim')
                .update({ mail_rientro_inviata_at: new Date().toISOString() })
                .eq('id', p.id);
            if (upErr) throw upErr;

            risultati.push({ id: p.id, status: 'ok' });
        } catch (err) {
            console.error(`Errore invio pratica ${p.id}:`, err);
            risultati.push({ id: p.id, status: 'error', error: err.message });
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({
            ok: true,
            sent: risultati.filter(r => r.status === 'ok').length,
            failed: risultati.filter(r => r.status === 'error').length,
            details: risultati
        })
    };
};

module.exports = { handler, schedule };
