/**
 * Mirox Error Reporter — client helper.
 * Esposto come window.MiroxErrorReporter.
 *
 * Scopo: ogni errore tecnico nel CRM (rete, OCR, submit, JS non gestiti...)
 * viene formattato con orario preciso Europe/Rome e segnalato via email
 * al proprietario del CRM, cosi' da avere visibilita' real-time sui problemi.
 *
 * API:
 *
 *   MiroxErrorReporter.now()
 *     -> { iso, date, time, formatted } (timezone Europe/Rome, sempre con secondi)
 *
 *   MiroxErrorReporter.report({
 *     source: 'upload-contratti-vendita',  // pagina/funzione che ha generato l'errore
 *     level:  'critical' | 'error' | 'warning' | 'info', // default 'error'
 *     title:  'Errore upload PDA',         // sintetico, va anche nel subject
 *     message: 'Il server ha risposto 500',// messaggio user-facing
 *     technical: stackTrace || jsonDebug,  // dettagli per chi indaga
 *     context: { praticaId, cf_piva, ... },// extra (oggetto serializzabile)
 *     silent: true                         // se true non logga su console.error
 *   })
 *     -> Promise<{ok:true}> oppure {ok:false, reason}
 *     Throttling: stesso fingerprint -> max 1 mail / 60 secondi.
 *
 *   MiroxErrorReporter.install({ source, ownerEmail })
 *     Aggancia window.error e unhandledrejection. Da chiamare 1 volta al boot
 *     della pagina (idempotente). I global handlers usano level='error' e
 *     non aprono popup: passano solo per la mail.
 *
 * Destinatario: mirko.piasenti@gmail.com (override via install({ownerEmail:...})).
 *
 * Dipendenze opzionali:
 *   - window.MiroxApi.fetch   -> per iniettare Authorization Bearer (preferito)
 *   - sessionStorage          -> per throttling (fallback memoria in-process)
 */

(function (window) {
    'use strict';

    var DEFAULT_OWNER_EMAIL = 'mirko.piasenti@gmail.com';
    var ENDPOINT = '/.netlify/functions/mirox-send-email';
    var THROTTLE_TTL_MS = 60 * 1000;
    var THROTTLE_KEY_PREFIX = 'mirox_err_throttle_';

    var state = {
        installed: false,
        source: 'mirox',
        ownerEmail: DEFAULT_OWNER_EMAIL,
        inMemoryThrottle: {} // fallback se sessionStorage non disponibile
    };

    // --- Timestamp Europe/Rome ----------------------------------------------

    function pad(n) { return String(n).padStart(2, '0'); }

    function now() {
        var d = new Date();
        var iso = d.toISOString();
        try {
            var fmt = new Intl.DateTimeFormat('it-IT', {
                timeZone: 'Europe/Rome',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
            });
            var parts = fmt.formatToParts(d);
            var get = function (t) {
                var p = parts.find(function (x) { return x.type === t; });
                return p ? p.value : '';
            };
            var date = get('day') + '/' + get('month') + '/' + get('year');
            var time = get('hour') + ':' + get('minute') + ':' + get('second');
            return { iso: iso, date: date, time: time, formatted: date + ' ' + time };
        } catch (e) {
            var date2 = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
            var time2 = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
            return { iso: iso, date: date2, time: time2, formatted: date2 + ' ' + time2 };
        }
    }

    // --- Throttling ---------------------------------------------------------

    function fingerprint(source, level, title, message) {
        var s = String(source || '') + '|' + String(level || '') + '|' +
                String(title || '').slice(0, 80) + '|' +
                String(message || '').slice(0, 120);
        var h = 0;
        for (var i = 0; i < s.length; i += 1) {
            h = ((h << 5) - h) + s.charCodeAt(i);
            h |= 0;
        }
        return 'fp_' + (h < 0 ? 'n' + (-h) : h);
    }

    function readThrottle(key) {
        try {
            var raw = sessionStorage.getItem(THROTTLE_KEY_PREFIX + key);
            return raw ? parseInt(raw, 10) : 0;
        } catch (e) {
            return state.inMemoryThrottle[key] || 0;
        }
    }

    function writeThrottle(key, ts) {
        try {
            sessionStorage.setItem(THROTTLE_KEY_PREFIX + key, String(ts));
        } catch (e) {
            state.inMemoryThrottle[key] = ts;
        }
    }

    function shouldSendNow(fp) {
        var last = readThrottle(fp);
        var ts = Date.now();
        if (last && (ts - last) < THROTTLE_TTL_MS) return false;
        writeThrottle(fp, ts);
        return true;
    }

    // --- HTML helpers -------------------------------------------------------

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function buildHtml(input) {
        var contextStr = '';
        if (input.context) {
            try { contextStr = JSON.stringify(input.context, null, 2); }
            catch (e) { contextStr = '[contesto non serializzabile: ' + (e && e.message) + ']'; }
        }
        var userEmail = '';
        try {
            // Best-effort: lettura email dalla sessione Supabase via auth helper se disponibile
            if (window.Auth && typeof window.Auth.getProfilo === 'function') {
                // getProfilo e' async, non possiamo aspettare qui; lo lasciamo a richiamo
            }
        } catch (e) { /* ignore */ }
        var pageUrl = '';
        try { pageUrl = String(window.location && window.location.href || ''); } catch (e) { /* ignore */ }
        var userAgent = '';
        try { userAgent = String(navigator && navigator.userAgent || ''); } catch (e) { /* ignore */ }

        var rows = [
            ['Data/ora (Europe/Rome)', input.timestamp.formatted],
            ['Livello', String(input.level || 'error').toUpperCase()],
            ['Sorgente', input.source || '-'],
            ['Utente', input.userEmail || '-'],
            ['Pagina', pageUrl || '-'],
            ['Browser', userAgent || '-']
        ];

        var rowsHtml = rows.map(function (r) {
            return '<tr><td style="padding:6px 10px;background:#F6F9FC;border:1px solid #E3E8EE;font-weight:600;color:#697386;white-space:nowrap">'
                + escapeHtml(r[0])
                + '</td><td style="padding:6px 10px;border:1px solid #E3E8EE;color:#0A2540;word-break:break-word">'
                + escapeHtml(r[1])
                + '</td></tr>';
        }).join('');

        var sectionTechnical = input.technical
            ? '<h3 style="margin:18px 0 6px;color:#0A2540;font-size:14px">Dettagli tecnici</h3>'
              + '<pre style="background:#0A2540;color:#E3E8EE;padding:12px;border-radius:6px;font-size:11px;white-space:pre-wrap;word-break:break-word">'
              + escapeHtml(input.technical) + '</pre>'
            : '';

        var sectionContext = contextStr
            ? '<h3 style="margin:18px 0 6px;color:#0A2540;font-size:14px">Contesto</h3>'
              + '<pre style="background:#EEF3F8;color:#0A2540;padding:12px;border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-word">'
              + escapeHtml(contextStr) + '</pre>'
            : '';

        return '<div style="font-family:Arial,Helvetica,sans-serif;color:#0A2540;max-width:680px">'
            + '<h2 style="margin:0 0 12px;color:#b91c1c;font-size:18px">[MIROX CRM] '
            + escapeHtml(input.title || 'Errore')
            + '</h2>'
            + '<p style="margin:0 0 12px;color:#697386;font-size:14px">'
            + escapeHtml(input.message || '(nessun messaggio)')
            + '</p>'
            + '<table style="border-collapse:collapse;width:100%;font-size:13px">'
            + rowsHtml
            + '</table>'
            + sectionTechnical
            + sectionContext
            + '<p style="margin-top:18px;color:#94a3b8;font-size:11px">'
            + 'Notifica automatica generata dal sistema di error reporting Mirox.'
            + '</p>'
            + '</div>';
    }

    // --- Email send ---------------------------------------------------------

    function safeFetch(url, opts) {
        var fetcher = (window.MiroxApi && typeof window.MiroxApi.fetch === 'function')
            ? window.MiroxApi.fetch
            : (typeof fetch === 'function' ? fetch : null);
        if (!fetcher) return Promise.reject(new Error('fetch non disponibile'));
        return fetcher(url, opts);
    }

    function getUserEmail() {
        // Best-effort: la sessione Supabase espone email; non blocco se non riesco
        try {
            if (window.db && window.db.auth && typeof window.db.auth.getSession === 'function') {
                return window.db.auth.getSession().then(function (r) {
                    var u = r && r.data && r.data.session && r.data.session.user;
                    return (u && u.email) ? String(u.email) : '';
                }).catch(function () { return ''; });
            }
        } catch (e) { /* ignore */ }
        return Promise.resolve('');
    }

    function report(input) {
        input = input || {};
        var level = input.level || 'error';
        var title = input.title || 'Errore non specificato';
        var message = input.message || '';
        var technical = input.technical || '';
        var context = input.context || null;
        var source = input.source || state.source;
        var ownerEmail = input.to || state.ownerEmail;
        var silent = Boolean(input.silent);

        if (!silent) {
            try { console.error('[MiroxErrorReporter]', level, source, title, message, technical); }
            catch (e) { /* ignore */ }
        }

        var fp = fingerprint(source, level, title, message);
        if (!shouldSendNow(fp)) {
            return Promise.resolve({ ok: false, reason: 'throttled' });
        }

        var ts = now();

        return getUserEmail().then(function (userEmail) {
            var html = buildHtml({
                level: level,
                title: title,
                message: message,
                technical: String(technical || ''),
                context: context,
                source: source,
                userEmail: userEmail,
                timestamp: ts
            });
            var subject = '[MIROX][' + String(level).toUpperCase() + '] '
                + title + ' — ' + ts.formatted;

            var payload = {
                to: ownerEmail,
                subject: subject,
                html: html,
                related_table: 'error_report',
                related_id: source + ':' + fp
            };

            return safeFetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(function (res) {
                return res.json().catch(function () { return {}; }).then(function (data) {
                    if (!res.ok || data.ok === false) {
                        var err = (data && data.error) || ('HTTP ' + res.status);
                        try { console.warn('[MiroxErrorReporter] invio mail fallito:', err); }
                        catch (e) { /* ignore */ }
                        return { ok: false, reason: err };
                    }
                    return { ok: true, messageId: data.messageId };
                });
            }).catch(function (err) {
                // Mai blocca il flusso utente
                try { console.warn('[MiroxErrorReporter] invio mail eccezione:', err && err.message); }
                catch (e) { /* ignore */ }
                return { ok: false, reason: err && err.message };
            });
        });
    }

    // --- Global handlers ----------------------------------------------------

    function onWindowError(ev) {
        try {
            var msg = (ev && (ev.message || ev.error && ev.error.message)) || 'Errore JS sconosciuto';
            var stack = (ev && ev.error && ev.error.stack)
                || (ev ? (ev.filename || '') + ':' + (ev.lineno || '') + ':' + (ev.colno || '') : '');
            report({
                source: state.source,
                level: 'error',
                title: 'Errore JavaScript non gestito',
                message: String(msg),
                technical: String(stack),
                silent: true
            });
        } catch (e) { /* ignore */ }
    }

    function onUnhandledRejection(ev) {
        try {
            var reason = ev && ev.reason;
            var msg = (reason && reason.message) || String(reason || 'Promise rejected');
            var stack = (reason && reason.stack) || '';
            report({
                source: state.source,
                level: 'error',
                title: 'Promise non gestita',
                message: msg,
                technical: stack,
                silent: true
            });
        } catch (e) { /* ignore */ }
    }

    function install(opts) {
        opts = opts || {};
        if (opts.source) state.source = String(opts.source);
        if (opts.ownerEmail) state.ownerEmail = String(opts.ownerEmail);
        if (state.installed) return;
        state.installed = true;
        try {
            window.addEventListener('error', onWindowError);
            window.addEventListener('unhandledrejection', onUnhandledRejection);
        } catch (e) {
            try { console.warn('[MiroxErrorReporter] install handlers fallito:', e && e.message); }
            catch (e2) { /* ignore */ }
        }
    }

    window.MiroxErrorReporter = {
        now: now,
        report: report,
        install: install
    };
})(window);
