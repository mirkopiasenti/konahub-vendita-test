/**
 * MIROX Vendita - Helper Anagrafica Unificata
 *
 * Esposto globalmente come `AnagraficaHelper`. Usato da tutti i moduli per:
 *   - validare e classificare CF/PIVA (Consumer/Business)
 *   - cercare il cliente in Supabase (`anagrafica` via cf_piva)
 *   - creare l'anagrafica al volo (RPC `cerca_o_crea_anagrafica`)
 *
 * Richiede `js/config.js` (db) caricato prima.
 *
 * Flusso UX standard nei moduli:
 *   1. Operatore inserisce CF/PIVA
 *   2. AnagraficaHelper.detectKind() → 'cf'/'piva'/null
 *   3. Se null → mostra errore "verifica il dato inserito" (no turista)
 *   4. AnagraficaHelper.cerca(cfPiva) → ritorna {found:true,data:{...}} o {found:false}
 *   5. Se found → pre-compila form + lock cluster
 *   6. Se non found → mostra campi di censimento (ragione_sociale, nome_referente, cellulare)
 *   7. Al submit → AnagraficaHelper.cercaOcrea(...) → ritorna UUID da salvare
 */

(function (window) {
  'use strict';

  // ---- 1. Normalizzazione e validazione ---------------------------------
  function normalizeCfPiva(value) {
    return String(value || '').trim().toUpperCase();
  }

  // CF italiano: 16 caratteri con pattern preciso
  function isCodiceFiscale(value) {
    const v = normalizeCfPiva(value);
    return /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(v);
  }

  // P.IVA: 11 cifre con check digit corretto (algoritmo di Luhn modificato italiano)
  function isPartitaIva(value) {
    const input = String(value || '').trim();
    if (!/^\d{11}$/.test(input)) return false;
    let sum = 0;
    for (let i = 0; i < 10; i += 1) {
      let digit = Number(input[i]);
      if ((i + 1) % 2 === 0) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    const control = (10 - (sum % 10)) % 10;
    return control === Number(input[10]);
  }

  /**
   * Classifica il CF/PIVA.
   * @returns {'cf'|'piva'|null} — null se nessuno dei due (errore di compilazione)
   */
  function detectKind(value) {
    const v = normalizeCfPiva(value);
    if (!v) return null;
    if (isCodiceFiscale(v)) return 'cf';
    if (isPartitaIva(v)) return 'piva';
    return null;
  }

  /**
   * Ritorna il cluster atteso in base al tipo: 'Consumer' (CF) o 'Business' (PIVA).
   */
  function clusterFromKind(kind) {
    if (kind === 'cf') return 'Consumer';
    if (kind === 'piva') return 'Business';
    return null;
  }

  // ---- 2. Ricerca cliente in Supabase -----------------------------------

  /**
   * Cerca in `anagrafica` per cf_piva (case-insensitive).
   * @returns {Promise<{found:boolean, data?:object}>}
   */
  async function cerca(cfPiva) {
    const v = normalizeCfPiva(cfPiva);
    if (!v) return { found: false };
    var sbClient = window.db || (typeof db !== 'undefined' ? db : null);
    if (!sbClient) throw new Error('Supabase client (db) non inizializzato');

    const { data, error } = await sbClient
      .from('anagrafica')
      .select('id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, email, provincia, comune, via, civico')
      .ilike('cf_piva', v)
      .limit(1);

    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : null;
    return row ? { found: true, data: row } : { found: false };
  }

  // ---- 3. Crea o aggiorna anagrafica (via RPC server-side) --------------

  /**
   * Cerca o crea l'anagrafica. Ritorna l'UUID.
   * Validazione minima: cf_piva, cluster, ragione_sociale obbligatori.
   *
   * @param {Object} dati
   * @param {string} dati.cf_piva
   * @param {string} dati.cluster - 'Consumer'|'Business'
   * @param {string} dati.ragione_sociale
   * @param {string} [dati.nome_referente]
   * @param {string} [dati.cellulare]
   * @param {string} [dati.provincia]
   * @param {string} [dati.comune]
   * @param {string} [dati.via]
   * @param {string} [dati.civico]
   * @returns {Promise<string>} UUID dell'anagrafica
   */
  async function cercaOcrea(dati) {
    var sbClient = window.db || (typeof db !== 'undefined' ? db : null);
    if (!sbClient) throw new Error('Supabase client (db) non inizializzato');

    const payload = {
      p_cf_piva: normalizeCfPiva(dati.cf_piva),
      p_cluster: String(dati.cluster || '').trim(),
      p_ragione_sociale: String(dati.ragione_sociale || '').trim(),
      p_nome_referente: dati.nome_referente ? String(dati.nome_referente).trim() : null,
      p_cellulare: dati.cellulare ? String(dati.cellulare).trim() : null,
      p_provincia: dati.provincia ? String(dati.provincia).trim() : null,
      p_comune: dati.comune ? String(dati.comune).trim() : null,
      p_via: dati.via ? String(dati.via).trim() : null,
      p_civico: dati.civico ? String(dati.civico).trim() : null,
      p_creato_da: dati.creato_da || null,
      p_email: dati.email ? String(dati.email).trim().toLowerCase() : null
    };

    if (!payload.p_cf_piva) throw new Error('CF/P.IVA obbligatorio');
    if (!payload.p_cluster) throw new Error('Cluster obbligatorio');
    if (!payload.p_ragione_sociale) throw new Error('Ragione sociale obbligatoria');

    const { data, error } = await sbClient.rpc('cerca_o_crea_anagrafica', payload);
    if (error) throw error;
    return data; // uuid
  }

  // ---- 4. Validazione finale del form di censimento ---------------------

  /**
   * Verifica che i dati minimi di censimento siano presenti.
   * @returns {string|null} messaggio errore o null se OK
   */
  function validaDatiMinimi(dati) {
    if (!normalizeCfPiva(dati.cf_piva)) return 'Inserisci CF o P.IVA';
    const kind = detectKind(dati.cf_piva);
    if (!kind) return 'Il valore inserito non è un CF (16 caratteri) né una P.IVA (11 cifre). Verifica il dato.';
    const expectedCluster = clusterFromKind(kind);
    if (!dati.cluster) return 'Cluster mancante';
    if (dati.cluster !== expectedCluster) {
      return `Cluster errato: aspettato "${expectedCluster}" per ${kind === 'cf' ? 'codice fiscale' : 'partita IVA'}`;
    }
    if (!String(dati.ragione_sociale || '').trim()) return 'Ragione sociale obbligatoria';
    if (!String(dati.nome_referente || '').trim()) return 'Nome referente obbligatorio';
    if (!String(dati.cellulare || '').trim()) return 'Cellulare obbligatorio';
    const emailTrim = String(dati.email || '').trim();
    if (!emailTrim) return 'Email obbligatoria';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) return 'Email non valida';
    return null;
  }

  // ---- 5. Factory section UI (riutilizzabile in moduli a 1 o 2 anagrafiche) -

  /**
   * Crea un "blocco anagrafica" autosufficiente collegandosi a campi del DOM
   * identificati da un prefisso (es. "anag", "anag_vecchio", "anag_nuovo").
   *
   * Campi attesi nel DOM (con il prefisso passato):
   *   #{prefix}_cfpiva           (input testo)
   *   #{prefix}_status           (div: messaggi di stato)
   *   #{prefix}_fields           (wrapper dei campi censimento, hidden di default)
   *   #{prefix}_cluster          (input readonly)
   *   #{prefix}_ragione_sociale  (input)
   *   #{prefix}_nome_referente   (input)
   *   #{prefix}_cellulare        (input)
   *
   * Espone uno `state` con: { id, cfPiva, kind, cluster, lookupDone, exists }
   * Espone metodi: reset(), executeLookup(), getDati(creato_da), validate()
   *
   * @param {string} prefix
   * @param {Object} [opts]
   * @param {Function} [opts.onLookupComplete] - callback({state}) dopo ogni lookup
   * @param {Function} [opts.onReset] - callback al reset
   * @param {Function} [opts.onValidationError] - callback(messaggio)
   * @returns {Object} sezione con state e metodi
   */
  function setupAnagraficaSection(prefix, opts) {
    opts = opts || {};
    const $ = (suffix) => document.getElementById(prefix + '_' + suffix);

    const state = {
      id: null,
      cfPiva: '',
      kind: null,
      cluster: null,
      lookupDone: false,
      exists: false,
      // Promise del lookup attualmente in corso (null se nessuno).
      // Permette ad altri handler (es. flag "coincide") di attenderne il completamento.
      lookupPromise: null
    };

    function setStatus(msg, type) {
      const el = $('status');
      if (!el) return;
      const colors = { ok: '#047857', warn: '#b45309', err: '#b91c1c', info: '#1d4ed8' };
      el.style.color = colors[type] || '#0f172a';
      el.textContent = msg || '';
    }

    function setFieldsReadonly(readonly) {
      ['ragione_sociale', 'nome_referente', 'cellulare', 'email'].forEach((s) => {
        const el = $(s);
        if (!el) return;
        el.readOnly = !!readonly;
        el.style.background = readonly ? '#f3f4f6' : '';
        el.style.cursor = readonly ? 'not-allowed' : '';
      });
    }

    function showFields(show) {
      const el = $('fields');
      if (el) el.style.display = show ? 'block' : 'none';
    }

    function reset() {
      state.id = null;
      state.cfPiva = '';
      state.kind = null;
      state.cluster = null;
      state.lookupDone = false;
      state.exists = false;
      state.lookupPromise = null;
      ['cluster', 'ragione_sociale', 'nome_referente', 'cellulare', 'email'].forEach((s) => {
        const el = $(s);
        if (el) el.value = '';
      });
      setFieldsReadonly(false);
      showFields(false);
      setStatus('', '');
      if (typeof opts.onReset === 'function') opts.onReset();
    }

    function _doLookup() {
      // Logica interna del lookup. Avvolta in una funzione perchè wrappata
      // in una Promise tracciabile (state.lookupPromise).
      return (async () => {
        const raw = $('cfpiva').value;
        const cfPiva = normalizeCfPiva(raw);
        $('cfpiva').value = cfPiva;

        reset(); // azzera tutto (incluso lookupPromise) — la ripristiniamo subito sotto
        if (!cfPiva) return;

        const kind = detectKind(cfPiva);
        if (!kind) {
          setStatus("Il valore inserito non è un CF (16 caratteri) né una P.IVA (11 cifre). Verifica il dato.", 'err');
          return;
        }
        state.cfPiva = cfPiva;
        state.kind = kind;
        state.cluster = clusterFromKind(kind);
        if ($('cluster')) $('cluster').value = state.cluster;

        setStatus('Ricerca cliente in corso...', 'info');
        try {
          const res = await cerca(cfPiva);
          state.lookupDone = true;
          if (res.found) {
            state.id = res.data.id;
            state.exists = true;
            if ($('ragione_sociale')) $('ragione_sociale').value = res.data.ragione_sociale || '';
            if ($('nome_referente')) $('nome_referente').value = res.data.nome_referente || '';
            if ($('cellulare')) $('cellulare').value = res.data.cellulare || '';
            if ($('email')) $('email').value = res.data.email || '';
            const dbCluster = (res.data.cluster || '').trim();
            if (dbCluster && dbCluster !== state.cluster) {
              setStatus('✓ Cliente trovato: ' + (res.data.ragione_sociale || '-') +
                ' — ⚠ cluster in DB era "' + dbCluster + '" ma è stato corretto a "' + state.cluster +
                '" in base al ' + (kind === 'cf' ? 'CF' : 'P.IVA'), 'warn');
            } else {
              setStatus('✓ Cliente trovato: ' + (res.data.ragione_sociale || '-'), 'ok');
            }
            setFieldsReadonly(true);
            showFields(true);
          } else {
            state.id = null;
            state.exists = false;
            setFieldsReadonly(false);
            showFields(true);
            setStatus('Cliente nuovo — compila i dati di censimento.', 'warn');
            if ($('ragione_sociale')) $('ragione_sociale').focus();
          }
          if (typeof opts.onLookupComplete === 'function') opts.onLookupComplete({ state, found: res.found });
        } catch (err) {
          setStatus('Errore ricerca: ' + err.message, 'err');
        }
      })();
    }

    /**
     * Avvia un lookup e registra la sua Promise su state.lookupPromise.
     * Se è già in corso un lookup, ne attende il completamento e poi ne avvia uno nuovo.
     * Restituisce la Promise del lookup corrente.
     */
    async function executeLookup() {
      // Se c'è già un lookup in volo, riusiamo la sua promise (idempotenza per
      // i casi in cui blur + change vengano scatenati a brevissima distanza).
      if (state.lookupPromise) {
        try { await state.lookupPromise; } catch (_) { /* ignora errori del precedente */ }
      }
      const p = _doLookup();
      state.lookupPromise = p;
      try { await p; } finally {
        // Manteniamo lookupPromise valorizzata: chi chiama awaitLookup() dopo che
        // è già finito riceverà una promise già risolta (zero-cost).
      }
      return p;
    }

    /**
     * Se è in corso un lookup, ne attende il completamento. Se il campo CF/P.IVA
     * contiene un valore ma nessun lookup è mai stato fatto (es. l'utente clicca un
     * altro pulsante prima che scatti il blur), avvia il lookup e lo attende.
     * Risolve quando lo state riflette il risultato attuale del campo.
     */
    async function awaitLookup() {
      // Caso 1: un lookup è in corso o appena terminato → aspettalo.
      if (state.lookupPromise) {
        try { await state.lookupPromise; } catch (_) {}
      }
      // Caso 2: il campo contiene un CF/PIVA diverso da quello su cui abbiamo lo
      // stato corrente → triggera un nuovo lookup. Questo cattura il "click prima
      // del blur" senza richiedere modifiche ai consumer.
      const cfInputEl = $('cfpiva');
      if (cfInputEl) {
        const current = normalizeCfPiva(cfInputEl.value);
        if (current && current !== state.cfPiva) {
          await executeLookup();
        }
      }
    }

    function getDati(creatoDa) {
      return {
        cf_piva: $('cfpiva') ? $('cfpiva').value : '',
        cluster: $('cluster') ? $('cluster').value : '',
        ragione_sociale: $('ragione_sociale') ? $('ragione_sociale').value : '',
        nome_referente: $('nome_referente') ? $('nome_referente').value : '',
        cellulare: $('cellulare') ? $('cellulare').value : '',
        email: $('email') ? $('email').value : '',
        creato_da: creatoDa || null
      };
    }

    /**
     * Popola i campi del form di censimento con dati esterni
     * (es. risultati OCR). I campi non presenti nel DOM vengono ignorati.
     * Non chiama il lookup; serve solo per pre-compilazione.
     */
    function populate(dati) {
      if (!dati || typeof dati !== 'object') return;
      const mapping = {
        cluster: 'cluster',
        ragione_sociale: 'ragione_sociale',
        nome_referente: 'nome_referente',
        cellulare: 'cellulare',
        email: 'email',
        provincia: 'provincia',
        comune: 'comune',
        via: 'via',
        civico: 'civico'
      };
      Object.keys(mapping).forEach((src) => {
        const v = dati[src];
        if (v === null || v === undefined) return;
        const el = $(mapping[src]);
        if (el && (!el.value || String(el.value).trim() === '')) {
          el.value = String(v);
        }
      });
    }

    function validate() {
      return validaDatiMinimi(getDati());
    }

    // Bind listeners
    const cfInput = $('cfpiva');
    if (cfInput) {
      cfInput.addEventListener('blur', executeLookup);
      cfInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); executeLookup(); }
      });
      cfInput.addEventListener('input', () => {
        const v = normalizeCfPiva(cfInput.value);
        if (v !== state.cfPiva) reset();
      });
    }

    return { state, reset, executeLookup, awaitLookup, getDati, populate, validate, setStatus };
  }

  // Esposizione globale
  window.AnagraficaHelper = {
    normalizeCfPiva,
    isCodiceFiscale,
    isPartitaIva,
    detectKind,
    clusterFromKind,
    cerca,
    cercaOcrea,
    validaDatiMinimi,
    setupAnagraficaSection
  };
})(window);
