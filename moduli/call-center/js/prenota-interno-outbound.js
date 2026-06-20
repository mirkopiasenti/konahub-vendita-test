const PrenotaInternoOutbound = {
    state: {
        data: null,
        slot: null,
        currentMonth: new Date(),
        payload: null,
        canAccessOutboundPage: false,
        canAccessRilavorazione: false,
        fromRilavorazioneOutbound: false
    },

    async init() {
        const { data: { session } } = await db.auth.getSession();
        if (!session) {
            window.location.href = '../../index.html';
            return;
        }

        const { data: profilo } = await db
            .from('profili')
            .select('*')
            .eq('id', session.user.id)
            .single();

        if (!profilo || !profilo.attivo) {
            window.location.href = '../../index.html';
            return;
        }

        Auth._profilo = profilo;

        const canAccessOutboundPage = Auth.puoAccedere('call_center_lead_outbound');
        const canAccessRilavorazione = Auth.puoAccedere('rilavorazione');
        this.state.canAccessOutboundPage = canAccessOutboundPage;
        this.state.canAccessRilavorazione = canAccessRilavorazione;

        if (!canAccessOutboundPage && !canAccessRilavorazione) {
            for (const [key, config] of Object.entries(APP_CONFIG.PAGINE)) {
                if (Auth.puoAccedere(key)) {
                    window.location.href = config.href;
                    return;
                }
            }
            window.location.href = '../../index.html';
            return;
        }

        App.initSidebar(canAccessOutboundPage ? 'call_center_lead_outbound' : 'rilavorazione');
        await Notifiche.init();

        const params = new URLSearchParams(window.location.search);
        const fromRilavorazioneParam = params.get('from') === 'rilavorazione';
        const ricontattaRaw = sessionStorage.getItem('mirox_ricontatta_outbound');
        if (fromRilavorazioneParam) {
            this.state.fromRilavorazioneOutbound = true;
        } else if (ricontattaRaw) {
            try {
                const ricontatta = JSON.parse(ricontattaRaw);
                if (ricontatta && ricontatta.origine_tipo === 'outbound_business' && ricontatta.lead_id) {
                    this.state.fromRilavorazioneOutbound = true;
                }
            } catch (_err) {
                // ignore invalid stale context for source detection
            }
        }

        const raw = sessionStorage.getItem('mirox_prenota_outbound');
        if (!raw) {
            Utils.toast('Sessione prenotazione outbound non trovata', 'warning');
            window.location.href = this.getFallbackHref();
            return;
        }

        try {
            this.state.payload = JSON.parse(raw);
            if (this.state.payload?.from_rilavorazione) {
                this.state.fromRilavorazioneOutbound = true;
            }
        } catch (_err) {
            Utils.toast('Dati prenotazione outbound non validi', 'warning');
            sessionStorage.removeItem('mirox_prenota_outbound');
            window.location.href = this.getFallbackHref();
            return;
        }

        if (!this.state.payload?.lead_id || !this.state.payload?.chiamata_outbound_id) {
            Utils.toast('Dati prenotazione outbound incompleti', 'warning');
            sessionStorage.removeItem('mirox_prenota_outbound');
            window.location.href = this.getFallbackHref();
            return;
        }

        this.bindEvents();
        this.renderLeadSummary();
        this.renderCalendar();
    },

    bindEvents() {
        document.getElementById('btnBack').addEventListener('click', () => {
            if (this.state.fromRilavorazioneOutbound) {
                sessionStorage.setItem('mirox_ricontatta_outbound', JSON.stringify({
                    lead_id: this.state.payload?.lead_id || null,
                    chiamata_origine_id: this.state.payload?.chiamata_origine_id || null,
                    tipo_origine: 'ricontatto_outbound',
                    origine_tipo: 'outbound_business'
                }));
            }
            window.location.href = 'registra-chiamata-outbound.html?lead_id=' + encodeURIComponent(this.state.payload?.lead_id || '');
        });

        document.getElementById('btnPrevMonth').addEventListener('click', () => {
            this.changeMonth(-1);
        });

        document.getElementById('btnNextMonth').addEventListener('click', () => {
            this.changeMonth(1);
        });

        document.getElementById('btnConferma').addEventListener('click', () => {
            this.conferma();
        });
    },

    renderLeadSummary() {
        const p = this.state.payload || {};
        const nome = p.ragione_sociale || '-';
        const telefono = p.telefono || '-';
        const localita = [p.localita || '', p.provincia || ''].filter(Boolean).join(' - ');

        document.getElementById('leadNome').textContent = nome;
        document.getElementById('leadDettagli').textContent = `${telefono} • ${localita || '-'}`;
        document.getElementById('leadIniziale').textContent = (nome || '?').charAt(0).toUpperCase();
        document.getElementById('pageSubtitle').textContent = `Outbound business: scegli data e orario per ${nome}`;
    },

    changeMonth(delta) {
        this.state.currentMonth.setMonth(this.state.currentMonth.getMonth() + delta);
        this.renderCalendar();
    },

    renderCalendar() {
        const y = this.state.currentMonth.getFullYear();
        const m = this.state.currentMonth.getMonth();
        const first = new Date(y, m, 1);
        const last = new Date(y, m + 1, 0);
        const startDay = (first.getDay() + 6) % 7;

        document.getElementById('monthDisplay').textContent = first.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

        const container = document.getElementById('calendarDays');
        container.innerHTML = '';

        for (let i = 0; i < startDay; i += 1) {
            container.innerHTML += '<div class="day empty"></div>';
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const maxDate = new Date();
        maxDate.setDate(today.getDate() + 60);

        for (let i = 1; i <= last.getDate(); i += 1) {
            const d = new Date(y, m, i);
            const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const cls = ['day'];
            let clickable = true;

            if (d.getDay() === 0) {
                cls.push('sunday', 'disabled');
                clickable = false;
            } else if (d < today || d > maxDate) {
                cls.push('disabled');
                clickable = false;
            }

            if (this.state.data === dateStr) cls.push('selected');
            if (d.getTime() === today.getTime()) cls.push('today');

            const div = document.createElement('div');
            div.className = cls.join(' ');
            div.textContent = String(i);
            if (clickable) {
                div.addEventListener('click', () => this.selectDate(dateStr, i));
            }
            container.appendChild(div);
        }
    },

    selectDate(dateStr, dayNum) {
        this.state.data = dateStr;
        this.state.slot = null;
        this.renderCalendar();

        const d = new Date(this.state.currentMonth.getFullYear(), this.state.currentMonth.getMonth(), dayNum);
        document.getElementById('selectedDateText').textContent = d.toLocaleDateString('it-IT', {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        });
        document.getElementById('slotsSection').style.display = 'block';
        document.getElementById('btnConferma').style.display = 'none';
        this.loadSlots(dateStr);
    },

    async loadSlots(data) {
        document.getElementById('slotsLoading').classList.remove('hidden');
        document.getElementById('slotsGrid').innerHTML = '';

        const { data: slots, error } = await db.rpc('get_slot_disponibili', { p_data: data });

        document.getElementById('slotsLoading').classList.add('hidden');

        if (error || !slots || !slots.length) {
            document.getElementById('slotsGrid').innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-secondary)">Nessuno slot disponibile</p>';
            return;
        }

        document.getElementById('slotsGrid').innerHTML = slots.map((slot) => {
            const t = new Date(slot);
            const ora = t.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
            return `<div class="slot" data-slot="${slot}">${ora}</div>`;
        }).join('');

        document.querySelectorAll('#slotsGrid .slot').forEach((el) => {
            el.addEventListener('click', () => {
                this.selectSlot(el, el.getAttribute('data-slot'));
            });
        });
    },

    selectSlot(el, slot) {
        document.querySelectorAll('#slotsGrid .slot').forEach((x) => x.classList.remove('selected'));
        el.classList.add('selected');
        this.state.slot = slot;
        document.getElementById('btnConferma').style.display = 'flex';
    },

    async conferma() {
        if (!this.state.slot) {
            Utils.toast('Seleziona un orario', 'warning');
            return;
        }

        const p = this.state.payload;
        if (!p?.lead_id || !p?.chiamata_outbound_id) {
            Utils.toast('Dati outbound mancanti', 'danger');
            return;
        }

        Utils.showLoading('Creazione appuntamento outbound...');

        try {
            const { data: app, error: appError } = await db
                .from('appuntamenti')
                .insert({
                    nome: p.ragione_sociale || '-',
                    codice_fiscale: null,
                    telefono: p.telefono || null,
                    motivo: 'Outbound business',
                    note: p.note_chiamata || null,
                    anagrafica_id: p.anagrafica_id || null,
                    fissato_da_operatore_id: Auth.getId(),
                    fissato_da_nome: Auth.getNome(),
                    chiamata_id: null,
                    data_ora: this.state.slot,
                    fonte: 'interno',
                    lead_outbound_id: p.lead_id,
                    chiamata_outbound_id: p.chiamata_outbound_id,
                    storico: JSON.stringify([
                        {
                            azione: 'creato',
                            data: new Date().toISOString(),
                            operatore: Auth.getNome(),
                            origine: 'outbound_business'
                        }
                    ])
                })
                .select()
                .single();

            if (appError || !app) {
                Utils.toast('Errore creazione appuntamento: ' + (appError?.message || 'Errore sconosciuto'), 'danger');
                return;
            }

            const { error: updChiamataError } = await db
                .from('call_center_lead_outbound_chiamate')
                .update({
                    appuntamento_tipo: 'negozio',
                    appuntamento_id: app.id
                })
                .eq('id', p.chiamata_outbound_id);

            if (updChiamataError) {
                Utils.toast('Appuntamento creato ma link chiamata non aggiornato: ' + updChiamataError.message, 'warning');
            }

            const nowIso = new Date().toISOString();
            const { error: updLeadError } = await db
                .from('call_center_lead_outbound')
                .update({
                    stato_lead: 'appuntamento_fissato_negozio',
                    ultimo_contatto_at: nowIso
                })
                .eq('id', p.lead_id);

            if (updLeadError) {
                Utils.toast('Appuntamento creato ma lead non aggiornato: ' + updLeadError.message, 'warning');
            }

            await db
                .from('call_center_lead_outbound_attivita')
                .insert({
                    lead_id: p.lead_id,
                    tipo: 'sistema',
                    testo: `Appuntamento negozio fissato: ${Utils.formatDateTime(this.state.slot)}`,
                    meta: {
                        appuntamento_id: app.id,
                        chiamata_outbound_id: p.chiamata_outbound_id,
                        origine: 'prenota_interno_outbound'
                    },
                    operatore_id: Auth.getId()
                });

            sessionStorage.removeItem('mirox_prenota_outbound');
            Utils.toast('Appuntamento outbound creato con successo', 'success');
            setTimeout(() => {
                window.location.href = 'appuntamenti.html';
            }, 800);
        } finally {
            Utils.hideLoading();
        }
    },

    getFallbackHref() {
        return this.state.fromRilavorazioneOutbound
            ? 'rilavorazione.html?tab=ricontatti'
            : 'call-center-lead-outbound.html';
    }
};

document.addEventListener('DOMContentLoaded', () => {
    PrenotaInternoOutbound.init();
});
