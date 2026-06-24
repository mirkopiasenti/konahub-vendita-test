const LeadOutbound = {
    statiLeadConsentiti: [
        'nuovo',
        'non_risposto',
        'ricontattare',
        'non_interessato',
        'appuntamento_fissato_negozio',
        'appuntamento_fissato_esterno'
    ],

    statoMeta: {
        nuovo: { label: 'Nuovo', badge: 'badge-info' },
        non_risposto: { label: 'Non risposto', badge: 'badge-warning' },
        ricontattare: { label: 'Ricontattare', badge: 'badge-danger' },
        non_interessato: { label: 'Non interessato', badge: 'badge-neutral' },
        appuntamento_fissato_negozio: { label: 'Appuntamento fissato negozio', badge: 'badge-success' },
        appuntamento_fissato_esterno: { label: 'Appuntamento fissato esterno', badge: 'badge-success' },
        appuntamento_fissato: { label: 'Appuntamento fissato (legacy)', badge: 'badge-success' },
        da_contattare: { label: 'Da contattare (legacy)', badge: 'badge-warning' },
        in_lavorazione: { label: 'In lavorazione (legacy)', badge: 'badge-neutral' },
        richiamare: { label: 'Richiamare (legacy)', badge: 'badge-danger' },
        chiuso: { label: 'Chiuso (legacy)', badge: 'badge-neutral' }
    },

    state: {
        loading: false,
        page: 1,
        pageSize: 50,
        totalRows: 0,
        leads: [],
        operatori: [],
        operatoriById: {},
        filtri: {
            ricerca: '',
            stato: '',
            provincia: '',
            cap: '',
            assegnatoA: '',
            soloNuovi: true,
            soloMiei: false
        },
        modalLead: {
            id: null,
            original: null,
            editMode: false
        },
        importCsv: {
            step: 1,
            file: null,
            righeMappate: [],
            righeValide: [],
            righeDaInserire: [],
            dedupeDuplicate: 0,
            righeLette: 0
        }
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

        if (!Auth.puoAccedere('call_center_lead_outbound')) {
            for (const [key, config] of Object.entries(APP_CONFIG.PAGINE)) {
                if (Auth.puoAccedere(key)) {
                    window.location.href = config.href;
                    return;
                }
            }
            window.location.href = '../../index.html';
            return;
        }

        CcHeader.render('call_center_lead_outbound');
        await Notifiche.init();
        await Utils.caricaColoriOperatori();

        this.bindEvents();
        await this.caricaOperatori();
        this.renderOperatoriSelect();
        await this.caricaLookupFiltri();
        await this.caricaStatistiche();
        await this.caricaLead();
    },

    bindEvents() {
        const onFiltro = Utils.debounce(async () => {
            this.state.page = 1;
            this.leggiFiltriDaUI();
            await this.caricaLead();
        }, 250);

        document.getElementById('filtroRicerca').addEventListener('input', onFiltro);
        document.getElementById('filtroStato').addEventListener('change', onFiltro);
        document.getElementById('filtroProvincia').addEventListener('change', onFiltro);
        document.getElementById('filtroCap').addEventListener('input', onFiltro);
        document.getElementById('filtroAssegnato').addEventListener('change', onFiltro);
        document.getElementById('filtroSoloNuovi').addEventListener('change', onFiltro);
        document.getElementById('filtroSoloMiei').addEventListener('change', onFiltro);

        document.getElementById('btnResetFiltri').addEventListener('click', async () => {
            document.getElementById('filtroRicerca').value = '';
            document.getElementById('filtroStato').value = '';
            document.getElementById('filtroProvincia').value = '';
            document.getElementById('filtroCap').value = '';
            document.getElementById('filtroAssegnato').value = '';
            document.getElementById('filtroSoloNuovi').checked = true;
            document.getElementById('filtroSoloMiei').checked = false;
            this.state.page = 1;
            this.leggiFiltriDaUI();
            await this.caricaLead();
        });

        document.getElementById('btnPrevPage').addEventListener('click', async () => {
            if (this.state.page <= 1) return;
            this.state.page -= 1;
            await this.caricaLead();
        });

        document.getElementById('btnNextPage').addEventListener('click', async () => {
            const pagineTot = Math.max(1, Math.ceil((this.state.totalRows || 0) / this.state.pageSize));
            if (this.state.page >= pagineTot) return;
            this.state.page += 1;
            await this.caricaLead();
        });

        document.getElementById('tbodyLead').addEventListener('click', (e) => this.onTableAction(e));

        document.getElementById('btnOpenImport').addEventListener('click', () => this.openImportModal());
        document.getElementById('btnCloseImport').addEventListener('click', () => this.closeImportModal());

        document.getElementById('csvFileInput').addEventListener('change', (e) => this.onFileCsvChange(e));
        document.getElementById('btnAnalizzaCsv').addEventListener('click', () => this.analizzaCsv());
        document.getElementById('btnBackToStep1').addEventListener('click', () => this.setImportStep(1));
        document.getElementById('btnGoStep3').addEventListener('click', () => this.setImportStep(3));
        document.getElementById('btnBackToStep2').addEventListener('click', () => this.setImportStep(2));
        document.getElementById('btnConfermaImport').addEventListener('click', () => this.confermaImport());

        document.getElementById('btnCloseLeadModal').addEventListener('click', () => this.closeLeadModal());
        document.getElementById('btnLeadEdit').addEventListener('click', () => this.setLeadEditMode(true));
        document.getElementById('btnLeadCancelEdit').addEventListener('click', () => this.cancelLeadEdit());
        document.getElementById('btnLeadSave').addEventListener('click', () => this.salvaLead());
        document.getElementById('btnAggiungiNota').addEventListener('click', () => this.salvaNotaLead());
        document.getElementById('btnLeadTouchContact').addEventListener('click', () => this.registraLavorazioneManuale());
    },

    leggiFiltriDaUI() {
        this.state.filtri.ricerca = (document.getElementById('filtroRicerca').value || '').trim();
        this.state.filtri.stato = document.getElementById('filtroStato').value || '';
        this.state.filtri.provincia = document.getElementById('filtroProvincia').value || '';
        this.state.filtri.cap = (document.getElementById('filtroCap').value || '').trim();
        this.state.filtri.assegnatoA = document.getElementById('filtroAssegnato').value || '';
        this.state.filtri.soloNuovi = !!document.getElementById('filtroSoloNuovi').checked;
        this.state.filtri.soloMiei = !!document.getElementById('filtroSoloMiei').checked;
    },

    async caricaOperatori() {
        const { data, error } = await db
            .from('profili')
            .select('id, nome, ruolo, attivo')
            .eq('attivo', true)
            .order('nome');

        if (error) {
            Utils.toast('Errore caricamento operatori: ' + error.message, 'danger');
            return;
        }

        this.state.operatori = data || [];
        this.state.operatoriById = {};
        for (const op of this.state.operatori) {
            this.state.operatoriById[op.id] = op.nome;
        }
    },

    renderOperatoriSelect() {
        const filtro = document.getElementById('filtroAssegnato');
        const dettaglio = document.getElementById('leadAssegnatoA');

        let optionsFiltro = '<option value="">Tutti</option>';
        let optionsDettaglio = '<option value="">Non assegnato</option>';

        for (const op of this.state.operatori) {
            optionsFiltro += `<option value="${op.id}">${Utils.escapeHtml(op.nome)}</option>`;
            optionsDettaglio += `<option value="${op.id}">${Utils.escapeHtml(op.nome)}</option>`;
        }

        filtro.innerHTML = optionsFiltro;
        dettaglio.innerHTML = optionsDettaglio;
    },

    async caricaLookupFiltri() {
        const { data, error } = await db
            .from('call_center_lead_outbound')
            .select('provincia, regione')
            .limit(5000);

        if (error) return;

        const setProvince = new Set();
        const setRegioni = new Set();

        for (const row of data || []) {
            const provincia = (row.provincia || '').trim();
            const regione = (row.regione || '').trim();
            if (regione) setRegioni.add(regione.toLowerCase());
            if (provincia) setProvince.add(provincia);
        }

        const provinciaSelect = document.getElementById('filtroProvincia');

        const currentProvincia = provinciaSelect.value;

        provinciaSelect.innerHTML = '<option value="">Tutte</option>';
        [...setProvince]
            .filter((val) => !!val && !setRegioni.has(val.toLowerCase()))
            .sort((a, b) => a.localeCompare(b, 'it'))
            .forEach((val) => {
            const option = document.createElement('option');
            option.value = val;
            option.textContent = val;
            provinciaSelect.appendChild(option);
        });

        if (currentProvincia) provinciaSelect.value = currentProvincia;
    },

    async caricaStatistiche() {
        const [totaleRes, nuoviRes, lavoratiRes] = await Promise.all([
            db.from('call_center_lead_outbound').select('id', { count: 'exact', head: true }),
            db.from('call_center_lead_outbound').select('id', { count: 'exact', head: true }).eq('stato_lead', 'nuovo'),
            db.from('call_center_lead_outbound').select('id', { count: 'exact', head: true }).neq('stato_lead', 'nuovo')
        ]);

        document.getElementById('statTotale').textContent = String(totaleRes.count || 0);
        document.getElementById('statNuovi').textContent = String(nuoviRes.count || 0);
        document.getElementById('statLavorati').textContent = String(lavoratiRes.count || 0);
    },

    buildQueryBase() {
        this.leggiFiltriDaUI();
        const f = this.state.filtri;

        let q = db
            .from('call_center_lead_outbound')
            .select('*', { count: 'exact' });

        if (f.soloNuovi) {
            q = q.eq('stato_lead', 'nuovo');
        } else if (f.stato) {
            q = q.eq('stato_lead', f.stato);
        }
        if (f.provincia) q = q.eq('provincia', f.provincia);
        if (f.cap) q = q.eq('cap', f.cap);

        if (f.soloMiei) {
            q = q.eq('assegnato_a', Auth.getId());
        } else if (f.assegnatoA) {
            q = q.eq('assegnato_a', f.assegnatoA);
        }

        if (f.ricerca) {
            const safe = f.ricerca
                .replace(/[%(),]/g, ' ')
                .replace(/'/g, '')
                .replace(/,/g, ' ')
                .trim();
            const pattern = `%${safe}%`;
            q = q.or(`ragione_sociale.ilike.${pattern},telefono_raw.ilike.${pattern},telefono_norm.ilike.${pattern},email.ilike.${pattern},localita.ilike.${pattern}`);
        }

        q = q
            .order('prossimo_followup_at', { ascending: true, nullsFirst: false })
            .order('updated_at', { ascending: false });

        return q;
    },

    async caricaLead() {
        if (this.state.loading) return;
        this.state.loading = true;

        try {
            const from = (this.state.page - 1) * this.state.pageSize;
            const to = from + this.state.pageSize - 1;

            const query = this.buildQueryBase().range(from, to);
            const { data, error, count } = await query;

            if (error) {
                Utils.toast('Errore caricamento lead: ' + error.message, 'danger');
                this.state.loading = false;
                return;
            }

            this.state.leads = data || [];
            this.state.totalRows = count || 0;

            this.renderLeadRows();
            this.renderPagination();
        } finally {
            this.state.loading = false;
        }
    },

    renderLeadRows() {
        const tbody = document.getElementById('tbodyLead');
        const empty = document.getElementById('leadEmpty');
        const info = document.getElementById('leadCountInfo');

        info.textContent = `${this.state.totalRows || 0} risultati`;

        if (!this.state.leads.length) {
            tbody.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');

        let html = '';
        for (const lead of this.state.leads) {
            const stato = this.statoMeta[lead.stato_lead] || { label: lead.stato_lead || '-', badge: 'badge-neutral' };
            const nomeOperatore = this.state.operatoriById[lead.assegnato_a] || '-';
            const canCall = lead.stato_lead === 'nuovo';
            const callBtn = canCall
                ? `<button class="outbound-icon-btn" data-action="call" data-id="${lead.id}" title="Registra chiamata">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                        </button>`
                : `<button class="outbound-icon-btn" title="Disponibile solo per lead Nuovo" disabled style="opacity:0.45;cursor:not-allowed;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                        </button>`;

            html += `<tr>
                <td>
                    <div style="font-weight:600;">${Utils.escapeHtml(lead.ragione_sociale || '-')}</div>
                </td>
                <td>${Utils.escapeHtml(lead.telefono_raw || '-')}</td>
                <td>${Utils.escapeHtml(lead.localita || '-')}</td>
                <td>${Utils.escapeHtml(lead.categoria || '-')}</td>
                <td><span class="badge ${stato.badge}">${Utils.escapeHtml(stato.label)}</span></td>
                <td>${Utils.escapeHtml(nomeOperatore)}</td>
                <td>${lead.ultimo_contatto_at ? Utils.formatDateTime(lead.ultimo_contatto_at) : '-'}</td>
                <td>${lead.prossimo_followup_at ? Utils.formatDateTime(lead.prossimo_followup_at) : '-'}</td>
                <td>
                    <div class="outbound-table-actions">
                        <button class="outbound-icon-btn" data-action="open" data-id="${lead.id}" title="Apri dettaglio">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                        ${callBtn}
                    </div>
                </td>
            </tr>`;
        }

        tbody.innerHTML = html;
    },

    renderPagination() {
        const totPages = Math.max(1, Math.ceil((this.state.totalRows || 0) / this.state.pageSize));
        if (this.state.page > totPages) this.state.page = totPages;

        document.getElementById('pageInfo').textContent = `Pagina ${this.state.page} di ${totPages}`;
        document.getElementById('btnPrevPage').disabled = this.state.page <= 1;
        document.getElementById('btnNextPage').disabled = this.state.page >= totPages;
    },

    async onTableAction(event) {
        const btn = event.target.closest('button[data-action]');
        if (!btn) return;

        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');

        if (action === 'open') {
            await this.openLeadModal(id);
            return;
        }

        if (action === 'call') {
            window.location.href = `registra-chiamata-outbound.html?lead_id=${encodeURIComponent(id)}`;
            return;
        }
    },

    openImportModal() {
        this.resetImportState();
        this.setImportStep(1);
        Utils.openModal('modalImport');
    },

    closeImportModal() {
        Utils.closeModal('modalImport');
    },

    resetImportState() {
        this.state.importCsv = {
            step: 1,
            file: null,
            righeMappate: [],
            righeValide: [],
            righeDaInserire: [],
            dedupeDuplicate: 0,
            righeLette: 0
        };
        document.getElementById('csvFileInput').value = '';
        document.getElementById('csvFileName').textContent = 'Nessun file selezionato';
        document.getElementById('previewTableWrap').innerHTML = '';
        document.getElementById('sumRigheLette').textContent = '0';
        document.getElementById('sumRigheValide').textContent = '0';
        document.getElementById('sumRigheInserite').textContent = '0';
        document.getElementById('sumRigheDuplicate').textContent = '0';
    },

    setImportStep(step) {
        this.state.importCsv.step = step;

        document.getElementById('importStep1').classList.toggle('hidden', step !== 1);
        document.getElementById('importStep2').classList.toggle('hidden', step !== 2);
        document.getElementById('importStep3').classList.toggle('hidden', step !== 3);

        document.getElementById('stepBadge1').classList.toggle('active', step === 1);
        document.getElementById('stepBadge2').classList.toggle('active', step === 2);
        document.getElementById('stepBadge3').classList.toggle('active', step === 3);

        if (step === 3) {
            document.getElementById('confirmFileName').textContent = this.state.importCsv.file?.name || '-';
            document.getElementById('confirmValide').textContent = String(this.state.importCsv.righeValide.length || 0);
            document.getElementById('confirmInserite').textContent = String(this.state.importCsv.righeDaInserire.length || 0);
        }
    },

    onFileCsvChange(e) {
        const file = e.target.files?.[0] || null;
        this.state.importCsv.file = file;
        document.getElementById('csvFileName').textContent = file ? file.name : 'Nessun file selezionato';
    },

    async analizzaCsv() {
        const file = this.state.importCsv.file;
        if (!file) {
            Utils.toast('Seleziona un file CSV', 'warning');
            return;
        }

        Utils.showLoading('Analisi CSV...');

        try {
            const parsedRows = await this.parseCsv(file);
            const righeMappate = this.mapCsvRows(parsedRows);

            const righeValide = righeMappate.filter((r) => !!r.ragione_sociale);
            const righeDaInserire = [];
            let duplicate = 0;

            const existingLeads = await this.fetchExistingLeadsForDedupe();
            const existingNorms = existingLeads.map((lead) => this.normalizeLeadForDedupe(lead));
            const acceptedNorms = [];

            for (const row of righeValide) {
                const rowNorm = this.normalizeLeadForDedupe(row);
                const dupWithExisting = this.getDedupeMatchStrategy(rowNorm, existingNorms);
                const dupWithBatch = this.getDedupeMatchStrategy(rowNorm, acceptedNorms);

                if (dupWithExisting || dupWithBatch) {
                    duplicate += 1;
                    row._dedupe_strategy = dupWithExisting || dupWithBatch;
                    continue;
                }

                row._dedupe_strategy = 'inserimento';
                righeDaInserire.push(row);
                acceptedNorms.push(rowNorm);
            }

            this.state.importCsv.righeMappate = righeMappate;
            this.state.importCsv.righeValide = righeValide;
            this.state.importCsv.righeDaInserire = righeDaInserire;
            this.state.importCsv.dedupeDuplicate = duplicate;
            this.state.importCsv.righeLette = righeMappate.length;

            document.getElementById('sumRigheLette').textContent = String(righeMappate.length);
            document.getElementById('sumRigheValide').textContent = String(righeValide.length);
            document.getElementById('sumRigheInserite').textContent = String(righeDaInserire.length);
            document.getElementById('sumRigheDuplicate').textContent = String(duplicate);

            this.renderPreviewTable(righeDaInserire.slice(0, 12));
            this.setImportStep(2);

        } catch (err) {
            console.error(err);
            Utils.toast('Errore analisi CSV: ' + (err.message || 'Errore sconosciuto'), 'danger');
        } finally {
            Utils.hideLoading();
        }
    },

    parseCsv(file) {
        return new Promise((resolve, reject) => {
            Papa.parse(file, {
                header: true,
                delimiter: ';',
                quoteChar: '"',
                skipEmptyLines: 'greedy',
                dynamicTyping: false,
                complete: (result) => {
                    if (result.errors && result.errors.length > 0) {
                        const fatal = result.errors.find((e) => e.code !== 'UndetectableDelimiter');
                        if (fatal) {
                            reject(new Error(fatal.message));
                            return;
                        }
                    }
                    resolve(result.data || []);
                },
                error: (error) => reject(error)
            });
        });
    },

    mapCsvRows(rows) {
        const output = [];
        const mapping = {
            ragionesociale: 'ragione_sociale',
            indirizzo: 'indirizzo',
            cap: 'cap',
            localita: 'localita',
            provincia: 'provincia',
            regione: 'regione',
            tel: 'telefono_raw',
            telefono: 'telefono_raw',
            sitointernet: 'sito_internet',
            email: 'email',
            categoria: 'categoria',
            zona: 'zona',
            piva: 'partita_iva',
            partitaiva: 'partita_iva',
            codicefiscale: 'codice_fiscale',
            nazione: 'nazione',
            fax: null,
            n: null,
            '': null
        };

        for (const row of rows) {
            const normalizedRow = {};
            for (const [key, val] of Object.entries(row || {})) {
                const nKey = this.normalizeHeader(key);
                normalizedRow[nKey] = this.cleanString(val);
            }

            const mapped = {
                ragione_sociale: '',
                indirizzo: '',
                cap: '',
                localita: '',
                provincia: '',
                regione: '',
                telefono_raw: '',
                sito_internet: '',
                email: '',
                categoria: '',
                zona: '',
                partita_iva: '',
                codice_fiscale: '',
                nazione: ''
            };

            for (const [rawKey, field] of Object.entries(mapping)) {
                if (!field) continue;
                if (normalizedRow[rawKey] != null && normalizedRow[rawKey] !== '') {
                    mapped[field] = normalizedRow[rawKey];
                }
            }

            const hasAnyValue = Object.values(mapped).some((v) => !!v);
            if (!hasAnyValue) continue;

            output.push(mapped);
        }

        return output;
    },

    normalizeHeader(header) {
        return (header || '')
            .toString()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    },

    cleanString(value) {
        if (value == null) return '';
        return String(value).trim();
    },

    normalizeText(value) {
        return (value || '')
            .toString()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },

    normalizeRagioneSociale(value) {
        let v = this.normalizeText(value);
        v = v.replace(/\b(srl|srls|spa|snc|sas|societa|cooperativa|consorzio|soc|a|rl)\b/g, ' ');
        v = v.replace(/\s+/g, ' ').trim();
        return v;
    },

    normalizeTelefono(value) {
        let v = (value || '').toString().replace(/[^0-9]/g, '');
        if (!v) return '';
        if (v.startsWith('0039')) v = v.slice(4);
        else if (v.startsWith('39') && v.length >= 11) v = v.slice(2);
        return v;
    },

    normalizePartitaIva(value) {
        const v = (value || '').toString().replace(/[^0-9]/g, '');
        return /^\d{11}$/.test(v) ? v : '';
    },

    normalizeLeadForDedupe(row) {
        return {
            partita_iva_norm: this.normalizePartitaIva(row.partita_iva_norm || row.partita_iva || ''),
            telefono_norm: this.normalizeText(row.telefono_norm || this.normalizeTelefono(row.telefono_raw || '')),
            ragione_sociale_norm: this.normalizeRagioneSociale(row.ragione_sociale_norm || row.ragione_sociale || ''),
            localita_norm: this.normalizeText(row.localita_norm || row.localita || ''),
            indirizzo_norm: this.normalizeText(row.indirizzo_norm || row.indirizzo || '')
        };
    },

    isNomeCompatibile(nomeA, nomeB) {
        if (!nomeA || !nomeB) return false;
        return nomeA === nomeB || nomeA.includes(nomeB) || nomeB.includes(nomeA);
    },

    getDedupePairStrategy(a, b) {
        if (!a || !b) return null;

        if (a.partita_iva_norm && b.partita_iva_norm && a.partita_iva_norm === b.partita_iva_norm) {
            return 'partita_iva';
        }

        if (a.telefono_norm && b.telefono_norm && a.telefono_norm === b.telefono_norm &&
            a.ragione_sociale_norm && b.ragione_sociale_norm && a.ragione_sociale_norm === b.ragione_sociale_norm) {
            return 'telefono_nome_uguale';
        }

        if (a.telefono_norm && b.telefono_norm && a.telefono_norm === b.telefono_norm &&
            a.localita_norm && b.localita_norm && a.localita_norm === b.localita_norm &&
            this.isNomeCompatibile(a.ragione_sociale_norm, b.ragione_sociale_norm)) {
            return 'telefono_nome_compatibile_localita';
        }

        if (a.ragione_sociale_norm && b.ragione_sociale_norm && a.ragione_sociale_norm === b.ragione_sociale_norm &&
            a.indirizzo_norm && b.indirizzo_norm && a.indirizzo_norm === b.indirizzo_norm &&
            a.localita_norm && b.localita_norm && a.localita_norm === b.localita_norm) {
            return 'nome_indirizzo_localita';
        }

        return null;
    },

    getDedupeMatchStrategy(candidate, list) {
        for (const other of list) {
            const strategy = this.getDedupePairStrategy(candidate, other);
            if (strategy) return strategy;
        }
        return null;
    },

    async fetchExistingLeadsForDedupe() {
        const out = [];
        const pageSize = 1000;
        let from = 0;

        while (true) {
            const { data, error } = await db
                .from('call_center_lead_outbound')
                .select('id, partita_iva, telefono_raw, telefono_norm, ragione_sociale, ragione_sociale_norm, localita, localita_norm, indirizzo, indirizzo_norm')
                .range(from, from + pageSize - 1);

            if (error || !data || data.length === 0) break;
            out.push(...data);

            if (data.length < pageSize) break;
            from += pageSize;
        }

        return out;
    },

    renderPreviewTable(rows) {
        const wrap = document.getElementById('previewTableWrap');
        if (!rows.length) {
            wrap.innerHTML = '<div class="empty-state"><h3>Nessuna riga da inserire</h3></div>';
            return;
        }

        let html = '<table><thead><tr><th>Ragione sociale</th><th>Telefono</th><th>Località</th><th>Categoria</th><th>P.IVA</th></tr></thead><tbody>';
        for (const r of rows) {
            html += `<tr>
                <td>${Utils.escapeHtml(r.ragione_sociale || '-')}</td>
                <td>${Utils.escapeHtml(r.telefono_raw || '-')}</td>
                <td>${Utils.escapeHtml(r.localita || '-')}</td>
                <td>${Utils.escapeHtml(r.categoria || '-')}</td>
                <td>${Utils.escapeHtml(r.partita_iva || '-')}</td>
            </tr>`;
        }
        html += '</tbody></table>';

        wrap.innerHTML = html;
    },

    async confermaImport() {
        const rows = this.state.importCsv.righeDaInserire;
        if (!rows.length) {
            Utils.toast('Nessuna riga da importare', 'warning');
            return;
        }

        Utils.showLoading('Import in corso...');

        try {
            const { data: importRow, error: importError } = await db
                .from('call_center_lead_outbound_import')
                .insert({
                    file_name: this.state.importCsv.file?.name || 'csv',
                    totale_righe: this.state.importCsv.righeLette,
                    righe_valide: this.state.importCsv.righeValide.length,
                    importato_da: Auth.getId()
                })
                .select()
                .single();

            if (importError) {
                Utils.toast('Errore creazione import: ' + importError.message, 'danger');
                return;
            }

            const payloadRows = rows.map((r) => ({
                ragione_sociale: r.ragione_sociale || null,
                indirizzo: r.indirizzo || null,
                cap: r.cap || null,
                localita: r.localita || null,
                provincia: r.provincia || null,
                regione: r.regione || null,
                nazione: r.nazione || null,
                telefono_raw: r.telefono_raw || null,
                sito_internet: r.sito_internet || null,
                email: r.email || null,
                categoria: r.categoria || null,
                zona: r.zona || null,
                partita_iva: r.partita_iva || null,
                codice_fiscale: r.codice_fiscale || null
            }));

            const { data: rpcData, error: rpcError } = await db.rpc('crm_import_call_center_lead_outbound_batch', {
                p_import_id: importRow.id,
                p_rows: payloadRows
            });

            if (rpcError) {
                Utils.toast('Errore RPC import: ' + rpcError.message, 'danger');
                return;
            }

            const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
            const inserite = result?.righe_importate ?? rows.length;
            const duplicate = result?.righe_duplicate_scartate ?? this.state.importCsv.dedupeDuplicate;

            Utils.toast(`Import completato: ${inserite} inserite, ${duplicate} duplicate`, 'success');
            this.closeImportModal();

            await this.caricaLookupFiltri();
            await this.caricaStatistiche();
            await this.caricaLead();
        } finally {
            Utils.hideLoading();
        }
    },

    async openLeadModal(leadId) {
        Utils.showLoading('Caricamento lead...');
        try {
            const { data, error } = await db
                .from('call_center_lead_outbound')
                .select('*')
                .eq('id', leadId)
                .single();

            if (error || !data) {
                Utils.toast('Lead non trovato', 'danger');
                return;
            }

            this.state.modalLead.id = leadId;
            this.state.modalLead.original = data;
            this.state.modalLead.editMode = false;

            this.fillLeadForm(data);
            this.setLeadEditMode(false);
            await this.caricaAttivitaLead(leadId);
            Utils.openModal('modalLeadDettaglio');
        } finally {
            Utils.hideLoading();
        }
    },

    closeLeadModal() {
        Utils.closeModal('modalLeadDettaglio');
        this.state.modalLead.id = null;
        this.state.modalLead.original = null;
        this.state.modalLead.editMode = false;
        document.getElementById('leadNuovaNota').value = '';
    },

    fillLeadForm(lead) {
        document.getElementById('leadId').value = lead.id || '';
        document.getElementById('leadRagioneSociale').value = lead.ragione_sociale || '';
        document.getElementById('leadIndirizzo').value = lead.indirizzo || '';
        document.getElementById('leadCap').value = lead.cap || '';
        document.getElementById('leadLocalita').value = lead.localita || '';
        document.getElementById('leadProvincia').value = lead.provincia || '';
        document.getElementById('leadRegione').value = lead.regione || '';
        document.getElementById('leadNazione').value = lead.nazione || '';
        document.getElementById('leadTelefonoRaw').value = lead.telefono_raw || '';
        document.getElementById('leadEmail').value = lead.email || '';
        document.getElementById('leadSitoInternet').value = lead.sito_internet || '';
        document.getElementById('leadCategoria').value = lead.categoria || '';
        document.getElementById('leadZona').value = lead.zona || '';
        document.getElementById('leadPartitaIva').value = lead.partita_iva || '';
        document.getElementById('leadCodiceFiscale').value = lead.codice_fiscale || '';
        this.syncLegacyStatoOption(lead.stato_lead || 'nuovo');
        document.getElementById('leadStatoLead').value = lead.stato_lead || 'nuovo';
        document.getElementById('leadAssegnatoA').value = lead.assegnato_a || '';
        document.getElementById('leadFollowup').value = this.toDateTimeLocal(lead.prossimo_followup_at);
        document.getElementById('leadUltimoContatto').value = this.toDateTimeLocal(lead.ultimo_contatto_at);
        document.getElementById('leadNoteUltima').value = lead.note_ultima || '';
    },

    setLeadEditMode(enabled) {
        this.state.modalLead.editMode = enabled;

        const ids = [
            'leadRagioneSociale', 'leadIndirizzo', 'leadCap', 'leadLocalita', 'leadProvincia', 'leadRegione', 'leadNazione',
            'leadTelefonoRaw', 'leadEmail', 'leadSitoInternet', 'leadCategoria', 'leadZona', 'leadPartitaIva', 'leadCodiceFiscale',
            'leadStatoLead', 'leadAssegnatoA', 'leadFollowup', 'leadUltimoContatto', 'leadNoteUltima'
        ];

        ids.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.disabled = !enabled;
        });

        document.getElementById('btnLeadEdit').classList.toggle('hidden', enabled);
        document.getElementById('btnLeadSave').classList.toggle('hidden', !enabled);
        document.getElementById('btnLeadCancelEdit').classList.toggle('hidden', !enabled);
    },

    cancelLeadEdit() {
        const original = this.state.modalLead.original;
        if (!original) return;
        this.fillLeadForm(original);
        this.setLeadEditMode(false);
    },

    collectLeadFormData() {
        return {
            ragione_sociale: this.cleanString(document.getElementById('leadRagioneSociale').value) || null,
            indirizzo: this.cleanString(document.getElementById('leadIndirizzo').value) || null,
            cap: this.cleanString(document.getElementById('leadCap').value) || null,
            localita: this.cleanString(document.getElementById('leadLocalita').value) || null,
            provincia: this.cleanString(document.getElementById('leadProvincia').value) || null,
            regione: this.cleanString(document.getElementById('leadRegione').value) || null,
            nazione: this.cleanString(document.getElementById('leadNazione').value) || null,
            telefono_raw: this.cleanString(document.getElementById('leadTelefonoRaw').value) || null,
            email: this.cleanString(document.getElementById('leadEmail').value).toLowerCase() || null,
            sito_internet: this.cleanString(document.getElementById('leadSitoInternet').value) || null,
            categoria: this.cleanString(document.getElementById('leadCategoria').value) || null,
            zona: this.cleanString(document.getElementById('leadZona').value) || null,
            partita_iva: this.cleanString(document.getElementById('leadPartitaIva').value) || null,
            codice_fiscale: this.cleanString(document.getElementById('leadCodiceFiscale').value) || null,
            stato_lead: document.getElementById('leadStatoLead').value || 'nuovo',
            assegnato_a: document.getElementById('leadAssegnatoA').value || null,
            prossimo_followup_at: this.fromDateTimeLocal(document.getElementById('leadFollowup').value),
            ultimo_contatto_at: this.fromDateTimeLocal(document.getElementById('leadUltimoContatto').value),
            note_ultima: this.cleanString(document.getElementById('leadNoteUltima').value) || null
        };
    },

    isStatoLeadConsentito(stato) {
        return this.statiLeadConsentiti.includes(stato);
    },

    syncLegacyStatoOption(stato) {
        const select = document.getElementById('leadStatoLead');
        if (!select) return;

        const oldLegacy = select.querySelector('option[data-legacy-temp="1"]');
        if (oldLegacy) {
            oldLegacy.remove();
        }

        if (!stato) return;
        const exists = [...select.options].some((opt) => opt.value === stato);
        if (exists) return;

        const label = this.statoMeta[stato]?.label || stato;
        const option = document.createElement('option');
        option.value = stato;
        option.textContent = `${label} (legacy)`;
        option.disabled = true;
        option.setAttribute('data-legacy-temp', '1');
        select.appendChild(option);
    },

    async salvaLead() {
        const id = this.state.modalLead.id;
        const original = this.state.modalLead.original;
        if (!id || !original) return;

        const payload = this.collectLeadFormData();

        if (!payload.ragione_sociale) {
            Utils.toast('Ragione sociale obbligatoria', 'warning');
            return;
        }

        if (!this.isStatoLeadConsentito(payload.stato_lead)) {
            Utils.toast('Seleziona uno stato lead valido (non legacy)', 'warning');
            return;
        }

        const changed = this.diffFields(original, payload);

        if (!changed.length) {
            Utils.toast('Nessuna modifica da salvare', 'info');
            this.setLeadEditMode(false);
            return;
        }

        Utils.showLoading('Salvataggio modifiche...');
        try {
            const { error } = await db
                .from('call_center_lead_outbound')
                .update(payload)
                .eq('id', id);

            if (error) {
                if (error.code === '23505' || (error.message || '').toLowerCase().includes('dedupe')) {
                    Utils.toast('Duplicato rilevato: la modifica collide con un lead già esistente', 'danger');
                    return;
                }
                Utils.toast('Errore salvataggio: ' + error.message, 'danger');
                return;
            }

            await this.logAttivita(
                id,
                'sistema',
                'Lead aggiornato manualmente',
                { campi_modificati: changed }
            );

            Utils.toast('Lead aggiornato', 'success');

            await this.openLeadModal(id);
            await this.caricaStatistiche();
            await this.caricaLead();
        } finally {
            Utils.hideLoading();
        }
    },

    diffFields(before, after) {
        const out = [];

        const keys = [
            'ragione_sociale', 'indirizzo', 'cap', 'localita', 'provincia', 'regione', 'nazione',
            'telefono_raw', 'email', 'sito_internet', 'categoria', 'zona', 'partita_iva', 'codice_fiscale',
            'stato_lead', 'assegnato_a', 'prossimo_followup_at', 'ultimo_contatto_at', 'note_ultima'
        ];

        for (const key of keys) {
            const a = this.normalizeCompareValue(before[key]);
            const b = this.normalizeCompareValue(after[key]);
            if (a !== b) out.push(key);
        }

        return out;
    },

    normalizeCompareValue(value) {
        if (value == null) return '';
        if (typeof value === 'boolean') return value ? '1' : '0';
        return String(value).trim();
    },

    async salvaNotaLead() {
        const leadId = this.state.modalLead.id;
        if (!leadId) return;

        const nota = this.cleanString(document.getElementById('leadNuovaNota').value);
        if (!nota) {
            Utils.toast('Inserisci una nota', 'warning');
            return;
        }

        const nowIso = new Date().toISOString();

        const { error: updError } = await db
            .from('call_center_lead_outbound')
            .update({
                note_ultima: nota,
                ultimo_contatto_at: nowIso
            })
            .eq('id', leadId);

        if (updError) {
            Utils.toast('Errore salvataggio nota: ' + updError.message, 'danger');
            return;
        }

        await this.logAttivita(leadId, 'nota', nota, {});
        document.getElementById('leadNuovaNota').value = '';

        await this.openLeadModal(leadId);
        await this.caricaLead();
    },

    async registraLavorazioneManuale() {
        const leadId = this.state.modalLead.id;
        if (!leadId) return;

        const nowIso = new Date().toISOString();

        const { error } = await db
            .from('call_center_lead_outbound')
            .update({ ultimo_contatto_at: nowIso })
            .eq('id', leadId);

        if (error) {
            Utils.toast('Errore aggiornamento lavorazione: ' + error.message, 'danger');
            return;
        }

        await this.logAttivita(leadId, 'sistema', 'Lavorazione manuale registrata', { ultimo_contatto_at: nowIso });
        Utils.toast('Lavorazione registrata', 'success');

        await this.openLeadModal(leadId);
        await this.caricaLead();
    },

    async caricaAttivitaLead(leadId) {
        const { data, error } = await db
            .from('call_center_lead_outbound_attivita')
            .select('*')
            .eq('lead_id', leadId)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) {
            document.getElementById('leadActivityList').innerHTML = '<div class="text-sm text-danger">Errore caricamento attività</div>';
            return;
        }

        this.renderAttivita(data || []);
    },

    renderAttivita(items) {
        const box = document.getElementById('leadActivityList');

        if (!items.length) {
            box.innerHTML = '<div class="text-sm text-secondary">Nessuna attività registrata</div>';
            return;
        }

        let html = '';
        for (const item of items) {
            const creatoDa = this.state.operatoriById[item.operatore_id] || 'Sistema';
            const tipo = item.tipo || 'sistema';
            const badge = tipo === 'nota' ? 'badge-info' : 'badge-neutral';

            html += `<div class="outbound-activity-item">
                <div class="outbound-activity-meta">
                    <span class="badge ${badge}">${Utils.escapeHtml(tipo)}</span>
                    <span style="margin-left:6px;">${Utils.escapeHtml(creatoDa)} • ${Utils.formatDateTime(item.created_at)}</span>
                </div>
                <div>${Utils.escapeHtml(item.testo || '-')}</div>
            </div>`;
        }

        box.innerHTML = html;
    },

    async logAttivita(leadId, tipo, descrizione, payload) {
        if (!leadId) return;

        await db.from('call_center_lead_outbound_attivita').insert({
            lead_id: leadId,
            tipo: tipo || 'sistema',
            testo: descrizione || '',
            meta: payload || {},
            operatore_id: Auth.getId()
        });
    },

    toDateTimeLocal(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const tz = d.getTimezoneOffset();
        const local = new Date(d.getTime() - tz * 60000);
        return local.toISOString().slice(0, 16);
    },

    fromDateTimeLocal(localValue) {
        if (!localValue) return null;
        const d = new Date(localValue);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    LeadOutbound.init();
});
