/**
 * MIROX - App Core
 * Sidebar dinamica, navigazione, utility condivise.
 */

const App = {
    /**
     * Inizializza la sidebar basata sui permessi dell'utente
     */
    initSidebar(paginaCorrente) {
        const container = document.getElementById('sidebar');
        if (!container) return;

        const profilo = Auth.getProfilo();
        if (!profilo) return;

        const pagine = APP_CONFIG.PAGINE;
        const gruppi = APP_CONFIG.GRUPPI_SIDEBAR;

        // Raggruppa le pagine accessibili per gruppo
        const gruppiAccessibili = {};
        for (const [key, config] of Object.entries(pagine)) {
            if (Auth.puoAccedere(key)) {
                const gruppo = config.gruppo;
                if (!gruppiAccessibili[gruppo]) gruppiAccessibili[gruppo] = [];
                gruppiAccessibili[gruppo].push({ key, ...config });
            }
        }

        // Costruisci HTML sidebar
        let html = `
        <div class="sidebar-header">
            <div class="sidebar-logo">
                <img src="assets/logo.png" alt="Mirox CRM" style="width:140px">
            </div>
        </div>
        <nav class="sidebar-nav">`;

        // Ordine gruppi
        const ordineGruppi = ['call-center', 'appuntamenti', 'vendita', 'altro', 'admin'];

        for (const gruppoKey of ordineGruppi) {
            const items = gruppiAccessibili[gruppoKey];
            if (!items || items.length === 0) continue;

            html += `<div class="nav-group-label">${gruppi[gruppoKey]}</div>`;

            for (const item of items) {
                const isActive = item.key === paginaCorrente;
                html += `
                <a href="${item.href}" class="nav-item ${isActive ? 'active' : ''}" id="nav-${item.key}">
                    ${getIconSvg(item.icona)}
                    <span>${item.titolo}</span>
                </a>`;
            }
        }

        html += `
        </nav>
        <div class="sidebar-footer">
            <div class="sidebar-user">
                <div class="user-avatar" style="background: ${profilo.colore}">${profilo.nome.charAt(0)}</div>
                <div class="user-info">
                    <div class="user-name">${profilo.nome}</div>
                    <div class="user-role">${profilo.ruolo === 'admin' ? 'Admin' : 'Operatore'}</div>
                </div>
            </div>
            <button onclick="Auth.logout()" class="btn-logout" title="Esci">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
            </button>
        </div>`;

        container.innerHTML = html;
    }
};

// ==================== UTILITY ====================

const Utils = {
    /**
     * Formatta data in italiano dd/mm/yyyy
     */
    formatDate(dateStr) {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    },

    /**
     * Formatta data e ora dd/mm/yyyy HH:mm
     */
    formatDateTime(dateStr) {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
               ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    },

    /**
     * Formatta solo ora HH:mm
     */
    formatTime(dateStr) {
        if (!dateStr) return '--:--';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '--:--';
        return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    },

    /**
     * Data di oggi in formato YYYY-MM-DD
     */
    today() {
        const now = new Date();
        return now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0');
    },

    /**
     * Tempo relativo (es: "5 min fa", "2 ore fa", "3 giorni fa")
     */
    timeAgo(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const now = new Date();
        const diff = Math.floor((now - d) / 1000);

        if (diff < 60) return 'ora';
        if (diff < 3600) return Math.floor(diff / 60) + ' min fa';
        if (diff < 86400) return Math.floor(diff / 3600) + ' ore fa';
        return Math.floor(diff / 86400) + ' giorni fa';
    },

    /**
     * Calcola giorni di differenza da oggi
     */
    giorniDa(dateStr) {
        if (!dateStr) return 0;
        const d = new Date(dateStr);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        d.setHours(0, 0, 0, 0);
        return Math.floor((now - d) / 86400000);
    },

    /**
     * Mostra un toast notification
     */
    toast(messaggio, tipo = 'info') {
        const container = document.getElementById('toast-container') || (() => {
            const div = document.createElement('div');
            div.id = 'toast-container';
            document.body.appendChild(div);
            return div;
        })();

        const toast = document.createElement('div');
        toast.className = `toast toast-${tipo}`;
        toast.innerHTML = `
            <span>${messaggio}</span>
            <button onclick="this.parentElement.remove()">&times;</button>
        `;
        container.appendChild(toast);

        setTimeout(() => toast.remove(), 4000);
    },

    /**
     * Mostra/nascondi loading overlay
     */
    showLoading(messaggio = 'Caricamento...') {
        let overlay = document.getElementById('loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loading-overlay';
            overlay.className = 'loading-overlay';
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = `<div class="loading-card"><div class="spinner"></div><p>${messaggio}</p></div>`;
        overlay.classList.add('active');
    },

    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.classList.remove('active');
    },

    /**
     * Apri/chiudi modal
     */
    openModal(id) {
        document.getElementById(id)?.classList.add('active');
    },

    closeModal(id) {
        document.getElementById(id)?.classList.remove('active');
    },

    /**
     * Debounce per ricerca
     */
    debounce(fn, delay = 300) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    },

    /**
     * Escape HTML per sicurezza
     */
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    /**
     * Mappa colori operatori — caricata una volta, usata ovunque
     */
    _operatoriColori: {},
    async caricaColoriOperatori() {
        const { data } = await db.from('profili').select('id, nome, colore');
        if (data) {
            for (const p of data) {
                Utils._operatoriColori[p.id] = { nome: p.nome, colore: p.colore || '#999' };
                Utils._operatoriColori[p.nome] = { nome: p.nome, colore: p.colore || '#999' };
            }
        }
    },
    getColoreOperatore(idOrNome) {
        const op = Utils._operatoriColori[idOrNome];
        return op ? op.colore : '#999';
    },
    avatarHtml(nome, idOrNome, size) {
        size = size || 24;
        const colore = Utils.getColoreOperatore(idOrNome || nome);
        const iniziale = (nome || '?').charAt(0).toUpperCase();
        return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${colore};color:white;font-size:${Math.round(size*0.45)}px;font-weight:700;flex-shrink:0">${iniziale}</span>`;
    },

    /**
     * Sync anagrafica con Google Sheet (provvisorio)
     * Usa GET con parametri URL — nessun problema CORS
     */
    syncAnagraficaSheet(dati) {
        if (typeof GOOGLE_SHEET_SYNC_URL === 'undefined' || !GOOGLE_SHEET_SYNC_URL) return;
        try {
            const params = new URLSearchParams({
                azione: 'syncDaMirox',
                cf_piva: dati.cf_piva || '',
                cluster: dati.cluster || '',
                ragione_sociale: dati.ragione_sociale || '',
                nome_referente: dati.nome_referente || '',
                cellulare: dati.cellulare || '',
                provincia: dati.provincia || '',
                comune: dati.comune || '',
                via: dati.via || '',
                civico: dati.civico || ''
            });
            const img = new Image();
            img.src = GOOGLE_SHEET_SYNC_URL + '?' + params.toString();
            console.log('Sync Google Sheet inviata');
        } catch(e) {
            console.warn('Sync Google Sheet fallita:', e);
        }
    }
};


// ==================== ICONE SVG ====================

function getIconSvg(name) {
    const icons = {
        'phone-outgoing': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 7 23 1 17 1"/><line x1="16" y1="8" x2="23" y2="1"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
        'list': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
        'refresh-cw': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
        'calendar': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        'clock': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        'check-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        'plus-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
        'shield-off': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19.69 14a6.9 6.9 0 0 0 .31-2V5l-8-3-3.16 1.18"/><path d="M4.73 4.73L4 5v7c0 6 8 10 8 10a20.29 20.29 0 0 0 5.62-4.38"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
        'settings': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
    };
    return icons[name] || '';
}
