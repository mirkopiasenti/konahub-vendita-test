const RegistraChiamataOutbound = {
    state: {
        leadId: null,
        lead: null,
        saving: false,
        canAccessOutboundPage: false,
        canAccessRilavorazione: false,
        ricontattoOrigineOutbound: null
    },

    esitoLabels: {
        non_risposto: 'Non risposto',
        non_interessato: 'Non interessato',
        ricontattare: 'Ricontattare',
        appuntamento: 'Appuntamento'
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

        CcHeader.render(canAccessOutboundPage ? 'call_center_lead_outbound' : 'rilavorazione');
        await Notifiche.init();

        this.bindEvents();

        document.getElementById('operatoreNome').value = Auth.getNome() || '-';
        document.getElementById('dataRicontatto').min = Utils.today();

        const params = new URLSearchParams(window.location.search);
        let leadId = params.get('lead_id');

        const ricontattaRaw = sessionStorage.getItem('mirox_ricontatta_outbound');
        if (ricontattaRaw) {
            try {
                const ricontatta = JSON.parse(ricontattaRaw);
                if (ricontatta && ricontatta.origine_tipo === 'outbound_business' && ricontatta.lead_id) {
                    if (!leadId) leadId = ricontatta.lead_id;
                    if (String(leadId) === String(ricontatta.lead_id)) {
                        this.state.ricontattoOrigineOutbound = ricontatta;
                    } else {
                        sessionStorage.removeItem('mirox_ricontatta_outbound');
                    }
                }
            } catch (err) {
                console.warn('[Lead Outbound] Contesto ricontatto outbound non valido', err);
                sessionStorage.removeItem('mirox_ricontatta_outbound');
            }
        }

        if (!leadId) {
            Utils.toast('Lead non specificato', 'warning');
            const backHref = this.getBackHref();
            if (this.state.ricontattoOrigineOutbound) this.clearRicontattoOutboundContext();
            window.location.href = backHref;
            return;
        }

        this.state.leadId = leadId;
        await this.caricaLead();
    },

    bindEvents() {
        document.getElementById('btnBackLead').addEventListener('click', () => {
            if (this.state.ricontattoOrigineOutbound) {
                this.clearRicontattoOutboundContext();
                window.location.href = 'rilavorazione.html?tab=ricontatti';
                return;
            }
            window.location.href = this.getBackHref();
        });

        document.getElementById('esito').addEventListener('change', () => {
            this.toggleRicontatto();
        });

        document.getElementById('btnSalvaChiamata').addEventListener('click', () => {
            this.onSalvaClick();
        });

        document.getElementById('btnCloseModalTipo').addEventListener('click', () => {
            Utils.closeModal('modalAppuntamentoTipo');
        });

        document.getElementById('btnTipoNegozio').addEventListener('click', () => {
            this.salvaConEsito('negozio');
        });

        document.getElementById('btnTipoEsterno').addEventListener('click', () => {
            this.salvaConEsito('esterno');
        });
    },

    async caricaLead() {
        Utils.showLoading('Caricamento lead...');
        try {
            const { data, error } = await db
                .from('call_center_lead_outbound')
                .select('*')
                .eq('id', this.state.leadId)
                .single();

            if (error || !data) {
                Utils.toast('Lead non trovato', 'danger');
                const backHref = this.getBackHref();
                if (this.state.ricontattoOrigineOutbound) this.clearRicontattoOutboundContext();
                window.location.href = backHref;
                return;
            }

            this.state.lead = data;
            this.renderLeadInfo(data);
        } finally {
            Utils.hideLoading();
        }
    },

    renderLeadInfo(lead) {
        document.getElementById('leadRagione').textContent = lead.ragione_sociale || '-';
        document.getElementById('leadTelefono').textContent = lead.telefono_raw || '-';
        document.getElementById('leadEmail').textContent = lead.email || '-';
        document.getElementById('leadLocalita').textContent = lead.localita || '-';
        document.getElementById('leadProvincia').textContent = lead.provincia || '-';
        document.getElementById('leadSito').textContent = lead.sito_internet || '-';
        document.getElementById('leadCategoria').textContent = lead.categoria || '-';
    },

    toggleRicontatto() {
        const esito = document.getElementById('esito').value;
        document.getElementById('boxRicontatto').classList.toggle('hidden', esito !== 'ricontattare');
    },

    async onSalvaClick() {
        const esito = document.getElementById('esito').value;
        if (!esito) {
            Utils.toast('Seleziona un esito', 'warning');
            return;
        }

        if (esito === 'appuntamento') {
            Utils.openModal('modalAppuntamentoTipo');
            return;
        }

        await this.salvaConEsito(null);
    },

    async salvaConEsito(appuntamentoTipo) {
        if (this.state.saving) return;

        const lead = this.state.lead;
        if (!lead) {
            Utils.toast('Lead non disponibile', 'danger');
            return;
        }

        const esito = document.getElementById('esito').value;
        const note = (document.getElementById('note').value || '').trim();

        if (!esito) {
            Utils.toast('Seleziona un esito', 'warning');
            return;
        }

        let dataRicontatto = null;
        let fasciaRicontatto = null;

        if (esito === 'ricontattare') {
            dataRicontatto = document.getElementById('dataRicontatto').value || null;
            fasciaRicontatto = document.getElementById('fasciaRicontatto').value || null;
            if (!dataRicontatto || !fasciaRicontatto) {
                Utils.toast('Inserisci data e fascia ricontatto', 'warning');
                return;
            }
        }

        if (esito === 'appuntamento' && !appuntamentoTipo) {
            Utils.toast('Seleziona il tipo di appuntamento', 'warning');
            return;
        }

        this.state.saving = true;
        Utils.showLoading('Salvataggio chiamata outbound...');

        try {
            const { data: chiamata, error: errInsert } = await db
                .from('call_center_lead_outbound_chiamate')
                .insert({
                    lead_id: lead.id,
                    anagrafica_id: null,
                    operatore_id: Auth.getId(),
                    operatore_nome: Auth.getNome() || '-',
                    ragione_sociale_snapshot: lead.ragione_sociale || '-',
                    telefono_snapshot: lead.telefono_raw || null,
                    localita_snapshot: lead.localita || null,
                    provincia_snapshot: lead.provincia || null,
                    esito,
                    note: note || null,
                    data_ricontatto: dataRicontatto,
                    fascia_ricontatto: fasciaRicontatto,
                    appuntamento_tipo: esito === 'appuntamento' ? appuntamentoTipo : null,
                    appuntamento_id: null
                })
                .select()
                .single();

            if (errInsert || !chiamata) {
                Utils.toast('Errore salvataggio chiamata: ' + (errInsert?.message || 'Errore sconosciuto'), 'danger');
                return;
            }

            const isAppuntamentoNegozio = esito === 'appuntamento' && appuntamentoTipo === 'negozio';
            const isAppuntamentoEsterno = esito === 'appuntamento' && appuntamentoTipo === 'esterno';
            let leadUpdateResult;

            if (isAppuntamentoNegozio) {
                leadUpdateResult = await this.aggiornaLeadDopoChiamataNegozioPending(note);
            } else {
                const statoOverride = isAppuntamentoEsterno ? 'appuntamento_fissato_esterno' : null;
                leadUpdateResult = await this.aggiornaLeadDopoChiamata(esito, note, dataRicontatto, fasciaRicontatto, statoOverride);
            }

            if (!leadUpdateResult?.ok) {
                console.error('[Lead Outbound] Update lead fallito dopo salvataggio chiamata', {
                    lead_id: lead.id,
                    chiamata_outbound_id: chiamata.id,
                    esito,
                    appuntamento_tipo: appuntamentoTipo || null,
                    error: leadUpdateResult?.error || null
                });
                const msg = leadUpdateResult?.error?.message || 'errore sconosciuto';
                Utils.toast(`Chiamata salvata ma il lead non è stato aggiornato: ${msg}`, 'danger');
                return;
            }

            if (isAppuntamentoEsterno && !chiamata.appuntamento_tipo) {
                const { error: errTipo } = await db
                    .from('call_center_lead_outbound_chiamate')
                    .update({ appuntamento_tipo: 'esterno' })
                    .eq('id', chiamata.id);
                if (errTipo) {
                    console.error('[Lead Outbound] Update appuntamento_tipo=esterno fallito', {
                        chiamata_outbound_id: chiamata.id,
                        error: errTipo
                    });
                    Utils.toast('Chiamata salvata ma tipo appuntamento non aggiornato: ' + errTipo.message, 'warning');
                    return;
                }
            }

            await this.logAttivita(lead.id, esito, chiamata.id, appuntamentoTipo, note, dataRicontatto, fasciaRicontatto);
            const chiusuraOrigine = await this.chiudiOrigineRilavorazioneOutbound();
            if (!chiusuraOrigine.ok) {
                console.error('[Lead Outbound] Chiusura chiamata origine rilavorazione fallita', {
                    lead_id: lead.id,
                    chiamata_outbound_id: chiamata.id,
                    errore: chiusuraOrigine.error
                });
                Utils.toast('Nuova chiamata salvata ma non è stato possibile chiudere la chiamata origine: ' + (chiusuraOrigine.error?.message || 'errore sconosciuto'), 'danger');
                return;
            }

            if (isAppuntamentoNegozio) {
                sessionStorage.setItem('mirox_prenota_outbound', JSON.stringify({
                    lead_id: lead.id,
                    chiamata_outbound_id: chiamata.id,
                    ragione_sociale: lead.ragione_sociale || '-',
                    telefono: lead.telefono_raw || '',
                    localita: lead.localita || '',
                    provincia: lead.provincia || '',
                    anagrafica_id: null,
                    note_chiamata: note || '',
                    from_rilavorazione: !!this.state.ricontattoOrigineOutbound,
                    chiamata_origine_id: this.state.ricontattoOrigineOutbound?.chiamata_origine_id || null
                }));

                Utils.toast('Chiamata salvata. Apriamo il calendario negozio...', 'success');
                setTimeout(() => {
                    window.location.href = this.state.ricontattoOrigineOutbound
                        ? 'prenota-interno-outbound.html?from=rilavorazione'
                        : 'prenota-interno-outbound.html';
                }, 500);
                return;
            }

            if (isAppuntamentoEsterno) {
                Utils.toast('Chiamata salvata come appuntamento esterno', 'success');
                setTimeout(() => {
                    window.location.href = this.getBackHref();
                }, 600);
                return;
            }

            Utils.toast('Chiamata outbound registrata', 'success');
            setTimeout(() => {
                window.location.href = this.getBackHref();
            }, 600);
        } finally {
            this.state.saving = false;
            Utils.hideLoading();
            Utils.closeModal('modalAppuntamentoTipo');
        }
    },

    mapStatoLead(esito) {
        if (esito === 'non_risposto') return 'non_risposto';
        if (esito === 'non_interessato') return 'non_interessato';
        if (esito === 'ricontattare') return 'ricontattare';
        return 'nuovo';
    },

    buildFollowupIso(dataRicontatto, fasciaRicontatto) {
        if (!dataRicontatto) return null;
        const hour = fasciaRicontatto === 'Pomeriggio' ? 15 : 9;
        const d = new Date(`${dataRicontatto}T${String(hour).padStart(2, '0')}:00:00`);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString();
    },

    async aggiornaLeadDopoChiamata(esito, note, dataRicontatto, fasciaRicontatto, statoOverride) {
        const nowIso = new Date().toISOString();
        const update = {
            ultimo_contatto_at: nowIso,
            stato_lead: statoOverride || this.mapStatoLead(esito),
            assegnato_a: Auth.getId()
        };

        if (esito === 'ricontattare') {
            update.prossimo_followup_at = this.buildFollowupIso(dataRicontatto, fasciaRicontatto);
        } else {
            update.prossimo_followup_at = null;
        }

        if (note) {
            update.note_ultima = note;
        }

        const { error } = await db
            .from('call_center_lead_outbound')
            .update(update)
            .eq('id', this.state.lead.id);

        if (error) {
            return { ok: false, error };
        }

        return { ok: true };
    },

    async aggiornaLeadDopoChiamataNegozioPending(note) {
        const update = {
            ultimo_contatto_at: new Date().toISOString(),
            assegnato_a: Auth.getId()
        };

        if (note) {
            update.note_ultima = note;
        }

        const { error } = await db
            .from('call_center_lead_outbound')
            .update(update)
            .eq('id', this.state.lead.id);

        if (error) {
            return { ok: false, error };
        }

        return { ok: true };
    },

    async logAttivita(leadId, esito, chiamataId, appuntamentoTipo, note, dataRicontatto, fasciaRicontatto) {
        const dettagli = [
            `Chiamata outbound registrata: ${this.esitoLabels[esito] || esito}`
        ];

        if (esito === 'appuntamento' && appuntamentoTipo) {
            dettagli.push(`Tipo appuntamento: ${appuntamentoTipo}`);
        }

        if (esito === 'ricontattare' && dataRicontatto) {
            dettagli.push(`Ricontatto: ${dataRicontatto} ${fasciaRicontatto || ''}`.trim());
        }

        if (note) {
            dettagli.push(`Note: ${note}`);
        }

        await db
            .from('call_center_lead_outbound_attivita')
            .insert({
                lead_id: leadId,
                tipo: 'sistema',
                testo: dettagli.join(' | '),
                meta: {
                    chiamata_outbound_id: chiamataId,
                    esito,
                    appuntamento_tipo: appuntamentoTipo || null,
                    data_ricontatto: dataRicontatto || null,
                    fascia_ricontatto: fasciaRicontatto || null
                },
                operatore_id: Auth.getId()
            });
    },

    getBackHref() {
        return this.state.ricontattoOrigineOutbound
            ? 'rilavorazione.html?tab=ricontatti'
            : 'call-center-lead-outbound.html';
    },

    clearRicontattoOutboundContext() {
        this.state.ricontattoOrigineOutbound = null;
        sessionStorage.removeItem('mirox_ricontatta_outbound');
    },

    async chiudiOrigineRilavorazioneOutbound() {
        const origine = this.state.ricontattoOrigineOutbound;
        if (!origine || !origine.chiamata_origine_id) return { ok: true };

        const { error } = await db
            .from('call_center_lead_outbound_chiamate')
            .update({ rilavorazione_stato: 'completato' })
            .eq('id', origine.chiamata_origine_id);

        if (error) {
            return { ok: false, error };
        }

        sessionStorage.removeItem('mirox_ricontatta_outbound');
        return { ok: true };
    }
};

document.addEventListener('DOMContentLoaded', () => {
    RegistraChiamataOutbound.init();
});
