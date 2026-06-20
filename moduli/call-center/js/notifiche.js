/**
 * MIROX - Modulo Notifiche Scadenze
 * Calcola notifiche pendenti per rilavorazione, mostra pop-up al login
 * e aggiorna il badge nella sidebar.
 */

const Notifiche = {
    _conteggio: null,
    _dettaglio: null,

    /**
     * Inizializza il sistema notifiche.
     * Da chiamare DOPO App.initSidebar() su ogni pagina autenticata.
     */
    async init() {
        if (typeof db === 'undefined' || typeof Auth === 'undefined') return;
        const profilo = Auth.getProfilo();
        if (!profilo) return;

        try {
            await this.calcola();
            this.aggiornaBadgeSidebar();
            this.mostraPopupSeNecessario();
        } catch (e) {
            console.warn('Notifiche: errore inizializzazione', e);
        }
    },

    /**
     * Calcola il conteggio notifiche per tutte e 4 le categorie.
     * Filtra per operatore loggato (admin vede tutto).
     */
    async calcola() {
        const operatoreId = Auth.getId();
        const admin = Auth.isAdmin();

        const [ricontatti, nonPresentati, passaNegozio, cerea] = await Promise.all([
            this._contaRicontatti(operatoreId, admin),
            this._contaNonPresentati(operatoreId, admin),
            this._contaPassaNegozio(operatoreId, admin),
            this._contaCerea(operatoreId, admin)
        ]);

        this._dettaglio = { ricontatti, nonPresentati, passaNegozio, cerea };
        this._conteggio = ricontatti + nonPresentati + passaNegozio + cerea;
        return this._conteggio;
    },

    /**
     * Ricontatti: scaduti (data passata) + oggi da lavorare,
     * con rispetto della fascia oraria (Mattina/Pomeriggio).
     * Mattina = prima delle 13:00, Pomeriggio = dalle 13:00 in poi.
     */
    async _contaRicontatti(operatoreId, admin) {
        const oggi = Utils.today();

        let query = db.from('vw_rilavorazione_ricontatti_unificata')
            .select('data_ricontatto, fascia_ricontatto, operatore_id')
            .lte('data_ricontatto', oggi);

        if (!admin) query = query.eq('operatore_id', operatoreId);

        const { data } = await query;
        if (!data) return 0;

        const oraCorrente = new Date().getHours();
        const isMattina = oraCorrente < 13;

        let count = 0;
        for (const c of data) {
            const dataRic = c.data_ricontatto || '';
            if (dataRic < oggi) {
                // Scaduto (giorno passato) → conta sempre
                count++;
            } else if (dataRic === oggi) {
                // Oggi → controlla fascia oraria
                const fascia = (c.fascia_ricontatto || '').toLowerCase();
                if (fascia === 'pomeriggio' && isMattina) {
                    // È mattina ma il ricontatto è per il pomeriggio → non contare
                    continue;
                }
                // Tutti gli altri casi: nessuna fascia, fascia mattina, oppure è pomeriggio e fascia pomeriggio
                count++;
            }
        }
        return count;
    },

    /**
     * Non presentati: TUTTI i contatti presenti (senza distinzioni di data).
     * Usa la tabella appuntamenti con filtro operatore su fissato_da_operatore_id.
     */
    async _contaNonPresentati(operatoreId, admin) {
        let query = db.from('appuntamenti')
            .select('id', { count: 'exact', head: true })
            .eq('presentato', 'no')
            .eq('non_presentato_stato', 'da_lavorare')
            .eq('stato', 'confermato');

        if (!admin) query = query.eq('fissato_da_operatore_id', operatoreId);

        const { count } = await query;
        return count || 0;
    },

    /**
     * Passa in negozio: contatti presenti da 5 giorni o più.
     * Calcola dalla data_ora della chiamata: se giorniDa(data_ora) >= 5 → scaduto.
     */
    async _contaPassaNegozio(operatoreId, admin) {
        // Calcola la data di 5 giorni fa (YYYY-MM-DD)
        const cinqueGiorniFa = this._dataGiorniFa(5);

        let query = db.from('chiamate')
            .select('id', { count: 'exact', head: true })
            .eq('esito', 'passa_in_negozio')
            .eq('passaggio_stato', 'in_attesa')
            .lt('data_ora', cinqueGiorniFa);

        if (!admin) query = query.eq('operatore_id', operatoreId);

        const { count } = await query;
        return count || 0;
    },

    /**
     * Cerea: contatti presenti da 5 giorni o più.
     * Calcola dalla data_ora della chiamata: se giorniDa(data_ora) >= 5 → scaduto.
     */
    async _contaCerea(operatoreId, admin) {
        const cinqueGiorniFa = this._dataGiorniFa(5);

        let query = db.from('chiamate')
            .select('id', { count: 'exact', head: true })
            .eq('esito', 'passa_a_cerea')
            .eq('passaggio_stato', 'in_attesa')
            .lt('data_ora', cinqueGiorniFa);

        if (!admin) query = query.eq('operatore_id', operatoreId);

        const { count } = await query;
        return count || 0;
    },

    /**
     * Helper: ritorna una data ISO (inizio giornata) di N giorni fa.
     * Es: _dataGiorniFa(5) con oggi 11/04 → "2026-04-06T00:00:00"
     */
    _dataGiorniFa(n) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - n);
        return d.toISOString();
    },

    /**
     * Aggiorna il badge numerico nella sidebar sulla voce Rilavorazione.
     */
    aggiornaBadgeSidebar() {
        const navLink = document.getElementById('nav-rilavorazione');
        if (!navLink) return;

        // Rimuovi badge esistente
        const old = navLink.querySelector('.notifica-badge-sidebar');
        if (old) old.remove();

        if (this._conteggio > 0) {
            const badge = document.createElement('span');
            badge.className = 'notifica-badge-sidebar';
            badge.textContent = this._conteggio;
            navLink.appendChild(badge);
        }
    },

    /**
     * Mostra il pop-up una sola volta per sessione (sessionStorage).
     * Scompare solo cliccando il pulsante di chiusura.
     */
    mostraPopupSeNecessario() {
        if (this._conteggio === 0) return;
        const chiavePopup = 'mirox_notifiche_popup_' + Auth.getId();
        if (sessionStorage.getItem(chiavePopup)) return;

        const d = this._dettaglio;
        const profilo = Auth.getProfilo();
        const nomeOp = profilo ? profilo.nome : '';

        // Costruisci elenco categorie con conteggio > 0
        let righe = '';
        if (d.ricontatti > 0) {
            righe += `<div class="notifica-popup-riga">
                <div class="notifica-popup-icona notifica-icona-ricontatti">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 3.09 5.18 2 2 0 0 1 5.11 3h3"/><polyline points="16 3 22 3 22 9"/><line x1="22" y1="3" x2="14" y2="11"/></svg>
                </div>
                <div class="notifica-popup-testo">
                    <strong>${d.ricontatti}</strong> ricontatt${d.ricontatti === 1 ? 'o' : 'i'} da gestire
                </div>
            </div>`;
        }
        if (d.nonPresentati > 0) {
            righe += `<div class="notifica-popup-riga">
                <div class="notifica-popup-icona notifica-icona-nonpresentati">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                </div>
                <div class="notifica-popup-testo">
                    <strong>${d.nonPresentati}</strong> non presentat${d.nonPresentati === 1 ? 'o' : 'i'} da lavorare
                </div>
            </div>`;
        }
        if (d.passaNegozio > 0) {
            righe += `<div class="notifica-popup-riga">
                <div class="notifica-popup-icona notifica-icona-passanegozio">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                </div>
                <div class="notifica-popup-testo">
                    <strong>${d.passaNegozio}</strong> "passa in negozio" scadut${d.passaNegozio === 1 ? 'o' : 'i'} (&ge;5 gg)
                </div>
            </div>`;
        }
        if (d.cerea > 0) {
            righe += `<div class="notifica-popup-riga">
                <div class="notifica-popup-icona notifica-icona-cerea">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                </div>
                <div class="notifica-popup-testo">
                    <strong>${d.cerea}</strong> "Cerea" scadut${d.cerea === 1 ? 'o' : 'i'} (&ge;5 gg)
                </div>
            </div>`;
        }

        // Crea overlay + popup
        const overlay = document.createElement('div');
        overlay.id = 'notificaPopupOverlay';
        overlay.className = 'notifica-popup-overlay';
        overlay.innerHTML = `
            <div class="notifica-popup">
                <div class="notifica-popup-header">
                    <div class="notifica-popup-bell">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                        </svg>
                    </div>
                    <h3 class="notifica-popup-titolo">Hai lavori in scadenza</h3>
                    <p class="notifica-popup-sottotitolo">${nomeOp ? nomeOp + ', ci' : 'Ci'} sono <strong>${this._conteggio}</strong> attività che richiedono attenzione</p>
                </div>
                <div class="notifica-popup-corpo">
                    ${righe}
                </div>
                <div class="notifica-popup-footer">
                    <button class="btn btn-primary" id="notificaPopupVai" style="flex:1;justify-content:center">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                        Vai a Rilavorazione
                    </button>
                    <button class="btn btn-secondary" id="notificaPopupChiudi" style="justify-content:center">
                        Ho capito
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Forza reflow per animazione
        requestAnimationFrame(() => {
            overlay.classList.add('active');
        });

        // Event listeners
        document.getElementById('notificaPopupChiudi').addEventListener('click', () => {
            this._chiudiPopup();
        });
        document.getElementById('notificaPopupVai').addEventListener('click', () => {
            this._chiudiPopup();
            window.location.href = 'rilavorazione.html';
        });
    },

    _chiudiPopup() {
        sessionStorage.setItem('mirox_notifiche_popup_' + Auth.getId(), '1');
        const overlay = document.getElementById('notificaPopupOverlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
        }
    },

    /**
     * Ricalcola e aggiorna solo il badge (senza popup).
     * Utile dopo azioni che modificano i dati.
     */
    async refresh() {
        try {
            await this.calcola();
            this.aggiornaBadgeSidebar();
        } catch (e) {
            console.warn('Notifiche: errore refresh', e);
        }
    }
};
