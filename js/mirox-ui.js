/* ============================================================
   MIROX UI – Popup, modali, loading e toast condivisi.
   Stile coerente con il modulo Apri/Chiudi.
   Espone window.MiroxUI con i metodi:
     alert(msg, opts) -> Promise (risolve a true alla chiusura)
     confirm(msg, opts) -> Promise<boolean>
     prompt(opts) -> Promise<string|null>
     loading.show(msg) / loading.setText / loading.success / loading.error / loading.hide
     toast(msg, type)
     allegati({title, items}) -> mostra elenco allegati condiviso
   Inietta a runtime tutto l'HTML/CSS necessario al primo uso,
   così basta includere lo script in ogni pagina.
   ============================================================ */
(function () {
    if (window.MiroxUI) return;

    // ----- CSS condiviso (iniettato una sola volta) ------------
    const CSS = `
.mx-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9000;padding:24px;}
.mx-overlay.mx-hide{display:none;}
.mx-modal{background:#fff;border-radius:14px;box-shadow:0 16px 40px rgba(15,23,42,.18);max-width:520px;width:100%;border:1px solid #e2e8f0;animation:mxIn .22s ease;}
.mx-modal.mx-modal-lg{max-width:760px;}
@keyframes mxIn{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:translateY(0);}}
.mx-modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid #f1f5f9;}
.mx-modal-title{font-size:16px;font-weight:700;color:#0f172a;margin:0;}
.mx-modal-x{background:transparent;border:none;font-size:22px;line-height:1;color:#94a3b8;cursor:pointer;padding:4px 8px;border-radius:6px;}
.mx-modal-x:hover{color:#FF6600;background:#fff3e0;}
.mx-modal-body{padding:22px;color:#0f172a;font-size:14px;line-height:1.5;}
.mx-modal-body .mx-icon{display:flex;justify-content:center;margin-bottom:12px;}
.mx-modal-body .mx-icon svg{width:54px;height:54px;}
.mx-modal-msg{text-align:center;font-size:14px;color:#334155;}
.mx-modal-msg strong{color:#0f172a;}
.mx-modal-foot{display:flex;justify-content:center;gap:10px;padding:14px 22px 20px;flex-wrap:wrap;}
.mx-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;border:1px solid transparent;transition:background .18s ease,color .18s ease,border-color .18s ease;}
.mx-btn-primary{background:#FF6600;color:#fff;}
.mx-btn-primary:hover{background:#E55A00;}
.mx-btn-secondary{background:#f8fafc;color:#0f172a;border-color:#e2e8f0;}
.mx-btn-secondary:hover{background:#f1f5f9;}
.mx-btn-danger{background:#EF4444;color:#fff;}
.mx-btn-danger:hover{background:#dc2626;}
.mx-input,.mx-modal-body input.mx-input{width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;color:#0f172a;background:#fff;box-sizing:border-box;}
.mx-input:focus{outline:none;border-color:#FF6600;box-shadow:0 0 0 3px rgba(255,102,0,.12);}

/* Loading overlay */
.mx-loading{display:flex;flex-direction:column;align-items:center;gap:14px;padding:36px 44px;}
.mx-loading h3{margin:0;font-size:17px;font-weight:700;color:#FF6600;}
.mx-loading p{margin:0;font-size:13px;color:#64748b;text-align:center;}
.mx-spinner{width:44px;height:44px;border:4px solid #e2e8f0;border-top-color:#FF6600;border-radius:50%;animation:mxSpin .8s linear infinite;}
@keyframes mxSpin{to{transform:rotate(360deg);}}
.mx-loading-ok{width:60px;height:60px;border-radius:50%;background:#DCFCE7;display:flex;align-items:center;justify-content:center;color:#16a34a;font-size:32px;font-weight:700;}
.mx-loading-err{width:60px;height:60px;border-radius:50%;background:#FEE2E2;display:flex;align-items:center;justify-content:center;color:#b91c1c;font-size:32px;font-weight:700;}

/* Toasts */
.mx-toast-container{position:fixed;top:20px;right:20px;z-index:9500;display:flex;flex-direction:column;gap:10px;pointer-events:none;}
.mx-toast{pointer-events:auto;padding:12px 16px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(15,23,42,.18);min-width:240px;display:flex;align-items:center;gap:10px;animation:mxToastIn .22s ease;}
.mx-toast .mx-toast-x{margin-left:auto;background:transparent;border:none;color:inherit;opacity:.7;font-size:16px;cursor:pointer;}
.mx-toast-success{background:#16a34a;color:#fff;}
.mx-toast-error{background:#dc2626;color:#fff;}
.mx-toast-warning{background:#d97706;color:#fff;}
.mx-toast-info{background:#FF6600;color:#fff;}
@keyframes mxToastIn{from{opacity:0;transform:translateX(40%);}to{opacity:1;transform:translateX(0);}}

/* Popup allegati */
.mx-attach-list{display:flex;flex-direction:column;gap:8px;max-height:55vh;overflow:auto;}
.mx-attach-item{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;}
.mx-attach-icon{width:36px;height:36px;border-radius:8px;background:#fff;border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;color:#FF6600;font-weight:700;font-size:12px;flex-shrink:0;}
.mx-attach-name{flex:1;font-size:13px;font-weight:600;color:#0f172a;word-break:break-word;}
.mx-attach-actions{display:flex;gap:6px;}
.mx-attach-actions a,.mx-attach-actions button{display:inline-flex;align-items:center;justify-content:center;padding:6px 12px;font-size:12px;font-weight:600;border-radius:8px;text-decoration:none;border:1px solid #e2e8f0;background:#fff;color:#0f172a;cursor:pointer;font-family:inherit;}
.mx-attach-actions a:hover,.mx-attach-actions button:hover{background:#fff3e0;color:#E55A00;border-color:#FF6600;}
.mx-attach-empty{padding:24px;text-align:center;color:#94a3b8;font-size:13px;}
`;

    // ----- Inject CSS + toast container all'avvio -------------
    function injectOnce() {
        if (document.getElementById('mx-ui-css')) return;
        const style = document.createElement('style');
        style.id = 'mx-ui-css';
        style.textContent = CSS;
        document.head.appendChild(style);
        if (!document.getElementById('mx-toast-container')) {
            const c = document.createElement('div');
            c.id = 'mx-toast-container';
            c.className = 'mx-toast-container';
            document.body.appendChild(c);
        }
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    // ----- Costruzione modale base ----------------------------
    function buildModal({title, bodyHtml, footerHtml, large = false, closable = true, onClose}) {
        injectOnce();
        const overlay = document.createElement('div');
        overlay.className = 'mx-overlay';
        const modal = document.createElement('div');
        modal.className = 'mx-modal' + (large ? ' mx-modal-lg' : '');
        const head = document.createElement('div');
        head.className = 'mx-modal-head';
        head.innerHTML = `<h3 class="mx-modal-title">${esc(title || '')}</h3>` +
            (closable ? `<button type="button" class="mx-modal-x" aria-label="Chiudi">&times;</button>` : '');
        const body = document.createElement('div');
        body.className = 'mx-modal-body';
        if (typeof bodyHtml === 'string') body.innerHTML = bodyHtml;
        else if (bodyHtml instanceof HTMLElement) body.appendChild(bodyHtml);
        const foot = document.createElement('div');
        foot.className = 'mx-modal-foot';
        if (footerHtml) foot.innerHTML = footerHtml;
        modal.appendChild(head);
        modal.appendChild(body);
        if (footerHtml) modal.appendChild(foot);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        function close() {
            overlay.remove();
            if (typeof onClose === 'function') onClose();
        }
        if (closable) {
            head.querySelector('.mx-modal-x').addEventListener('click', close);
            overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
            // ESC chiude
            const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
            document.addEventListener('keydown', onKey);
        }
        return {overlay, modal, body, foot, head, close};
    }

    // ----- ALERT ----------------------------------------------
    function alertModal(msg, opts = {}) {
        return new Promise(resolve => {
            const type = opts.type || 'info'; // info | success | error | warning
            const icon = {
                info: '<svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
                success: '<svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>',
                error: '<svg viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>',
                warning: '<svg viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
            }[type];
            const html = `<div class="mx-icon">${icon}</div><div class="mx-modal-msg">${opts.html ? msg : esc(msg)}</div>`;
            const footer = `<button type="button" class="mx-btn mx-btn-primary" data-mx-ok>${esc(opts.okText || 'OK')}</button>`;
            const m = buildModal({
                title: opts.title || ({info:'Informazione',success:'Operazione completata',error:'Errore',warning:'Attenzione'}[type]),
                bodyHtml: html, footerHtml: footer, large: !!opts.large,
                onClose: () => resolve(true)
            });
            m.foot.querySelector('[data-mx-ok]').addEventListener('click', () => { m.close(); });
        });
    }

    // ----- CONFIRM --------------------------------------------
    function confirmModal(msg, opts = {}) {
        return new Promise(resolve => {
            const html = `<div class="mx-modal-msg">${opts.html ? msg : esc(msg)}</div>`;
            const okText = esc(opts.okText || 'Conferma');
            const cancelText = esc(opts.cancelText || 'Annulla');
            const okClass = opts.danger ? 'mx-btn-danger' : 'mx-btn-primary';
            const footer = `<button type="button" class="mx-btn mx-btn-secondary" data-mx-cancel>${cancelText}</button>` +
                `<button type="button" class="mx-btn ${okClass}" data-mx-ok>${okText}</button>`;
            let decided = false;
            const m = buildModal({
                title: opts.title || 'Conferma operazione', bodyHtml: html, footerHtml: footer,
                onClose: () => { if (!decided) resolve(false); }
            });
            m.foot.querySelector('[data-mx-ok]').addEventListener('click', () => { decided = true; m.close(); resolve(true); });
            m.foot.querySelector('[data-mx-cancel]').addEventListener('click', () => { decided = true; m.close(); resolve(false); });
        });
    }

    // ----- PROMPT (input testuale) ----------------------------
    function promptModal(opts = {}) {
        return new Promise(resolve => {
            const label = esc(opts.label || '');
            const inputType = opts.type === 'password' ? 'password' : 'text';
            const placeholder = esc(opts.placeholder || '');
            const initial = esc(opts.value || '');
            const html = `${label ? `<div style="font-size:13px;font-weight:600;margin-bottom:8px;color:#0f172a;">${label}</div>` : ''}` +
                `<input type="${inputType}" class="mx-input" placeholder="${placeholder}" value="${initial}" autocomplete="off">`;
            const footer = `<button type="button" class="mx-btn mx-btn-secondary" data-mx-cancel>Annulla</button>` +
                `<button type="button" class="mx-btn mx-btn-primary" data-mx-ok>${esc(opts.okText || 'Conferma')}</button>`;
            let decided = false;
            const m = buildModal({
                title: opts.title || 'Inserisci dato', bodyHtml: html, footerHtml: footer,
                onClose: () => { if (!decided) resolve(null); }
            });
            const input = m.body.querySelector('.mx-input');
            setTimeout(() => input.focus(), 30);
            function ok() { decided = true; const v = input.value; m.close(); resolve(v); }
            function cancel() { decided = true; m.close(); resolve(null); }
            m.foot.querySelector('[data-mx-ok]').addEventListener('click', ok);
            m.foot.querySelector('[data-mx-cancel]').addEventListener('click', cancel);
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); ok(); }
            });
        });
    }

    // ----- LOADING --------------------------------------------
    let loadingState = null;
    function loadingShow(msg = 'Operazione in corso...', subtitle = '') {
        loadingHide();
        injectOnce();
        const overlay = document.createElement('div');
        overlay.className = 'mx-overlay';
        overlay.dataset.mxLoading = '1';
        overlay.innerHTML = `<div class="mx-modal" style="max-width:360px;"><div class="mx-modal-body"><div class="mx-loading"><div class="mx-spinner" data-mx-spin></div><div data-mx-icon style="display:none;"></div><h3 data-mx-title>${esc(msg)}</h3>${subtitle ? `<p data-mx-sub>${esc(subtitle)}</p>` : '<p data-mx-sub style="display:none;"></p>'}</div></div></div>`;
        document.body.appendChild(overlay);
        loadingState = overlay;
        return {
            setText: t => loadingSetText(t),
            success: t => loadingSuccess(t),
            error: t => loadingError(t),
            hide: () => loadingHide()
        };
    }
    function loadingSetText(t) {
        if (!loadingState) return;
        const ti = loadingState.querySelector('[data-mx-title]');
        if (ti) ti.textContent = t;
    }
    function loadingSuccess(t = 'Completato!') {
        if (!loadingState) return;
        const spin = loadingState.querySelector('[data-mx-spin]');
        const icon = loadingState.querySelector('[data-mx-icon]');
        const title = loadingState.querySelector('[data-mx-title]');
        if (spin) spin.style.display = 'none';
        if (icon) { icon.style.display = 'flex'; icon.className = 'mx-loading-ok'; icon.textContent = '✓'; }
        if (title) { title.textContent = t; title.style.color = '#16a34a'; }
        setTimeout(loadingHide, 1100);
    }
    function loadingError(t = 'Errore') {
        if (!loadingState) return;
        const spin = loadingState.querySelector('[data-mx-spin]');
        const icon = loadingState.querySelector('[data-mx-icon]');
        const title = loadingState.querySelector('[data-mx-title]');
        if (spin) spin.style.display = 'none';
        if (icon) { icon.style.display = 'flex'; icon.className = 'mx-loading-err'; icon.textContent = '!'; }
        if (title) { title.textContent = t; title.style.color = '#b91c1c'; }
        setTimeout(loadingHide, 1800);
    }
    function loadingHide() {
        if (loadingState && loadingState.parentNode) loadingState.remove();
        loadingState = null;
    }

    // ----- TOAST ----------------------------------------------
    function toast(msg, type = 'info', durationMs = 3500) {
        injectOnce();
        const c = document.getElementById('mx-toast-container');
        const t = document.createElement('div');
        t.className = 'mx-toast mx-toast-' + (type === 'danger' ? 'error' : type);
        t.innerHTML = `<span>${esc(msg)}</span><button type="button" class="mx-toast-x">&times;</button>`;
        t.querySelector('.mx-toast-x').addEventListener('click', () => t.remove());
        c.appendChild(t);
        setTimeout(() => { if (t.parentNode) t.remove(); }, durationMs);
    }

    // ----- POPUP ALLEGATI -------------------------------------
    // items: [{ name, displayName?, url, downloadUrl?, openText?, downloadText? }]
    function allegati({title = 'Allegati pratica', items = [], emptyText = 'Nessun allegato disponibile per questa pratica.'} = {}) {
        let html;
        if (!items.length) {
            html = `<div class="mx-attach-empty">${esc(emptyText)}</div>`;
        } else {
            const rows = items.map(it => {
                const name = esc(it.displayName || it.name || 'Documento');
                // Policy Mirox: tutti gli allegati sono PDF. L'icona mostra sempre "PDF".
                const ext = 'PDF';
                let openBtn = '';
                let dlBtn = '';
                if (it.bucket && it.path) {
                    // Bucket privati: genera signed URL on-click via MiroxStorage
                    const b = esc(it.bucket);
                    const p = esc(it.path);
                    const openLbl = esc(it.openText || 'Apri');
                    const dlLbl = esc(it.downloadText || 'Scarica');
                    openBtn = `<a href="#" onclick="MiroxStorage.openAttachment('${b}','${p}');return false;" rel="noopener">${openLbl}</a>`;
                    dlBtn = `<a href="#" onclick="MiroxStorage.openAttachment('${b}','${p}');return false;">${dlLbl}</a>`;
                } else {
                    const openUrl = it.url || it.downloadUrl;
                    const dlUrl = it.downloadUrl || it.url;
                    const baseDl = (it.displayName || it.name || 'documento').replace(/\.[a-z0-9]+$/i, '');
                    const dlName = baseDl + '.pdf';
                    openBtn = openUrl ? `<a href="${esc(openUrl)}" target="_blank" rel="noopener">${esc(it.openText || 'Apri')}</a>` : '';
                    dlBtn = dlUrl ? `<a href="${esc(dlUrl)}" download="${esc(dlName)}">${esc(it.downloadText || 'Scarica')}</a>` : '';
                }
                return `<div class="mx-attach-item">
                    <div class="mx-attach-icon">${esc(ext)}</div>
                    <div class="mx-attach-name">${name}</div>
                    <div class="mx-attach-actions">${openBtn}${dlBtn}</div>
                </div>`;
            }).join('');
            html = `<div class="mx-attach-list">${rows}</div>`;
        }
        const footer = `<button type="button" class="mx-btn mx-btn-secondary" data-mx-close>Chiudi</button>`;
        const m = buildModal({title, bodyHtml: html, footerHtml: footer, large: true});
        m.foot.querySelector('[data-mx-close]').addEventListener('click', m.close);
        return m;
    }

    // ----- EXPORT ---------------------------------------------
    window.MiroxUI = {
        alert: alertModal,
        confirm: confirmModal,
        prompt: promptModal,
        loading: {
            show: loadingShow,
            setText: loadingSetText,
            success: loadingSuccess,
            error: loadingError,
            hide: loadingHide
        },
        toast,
        allegati,
        _build: buildModal,
        _esc: esc
    };

    // Inietta CSS subito quando il DOM è pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectOnce);
    } else {
        injectOnce();
    }
})();
