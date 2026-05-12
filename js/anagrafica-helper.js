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
    if (!window.db) throw new Error('Supabase client (db) non inizializzato');

    const { data, error } = await window.db
      .from('anagrafica')
      .select('id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, provincia, comune, via, civico')
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
    if (!window.db) throw new Error('Supabase client (db) non inizializzato');

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
      p_creato_da: dati.creato_da || null
    };

    if (!payload.p_cf_piva) throw new Error('CF/P.IVA obbligatorio');
    if (!payload.p_cluster) throw new Error('Cluster obbligatorio');
    if (!payload.p_ragione_sociale) throw new Error('Ragione sociale obbligatoria');

    const { data, error } = await window.db.rpc('cerca_o_crea_anagrafica', payload);
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
    return null;
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
    validaDatiMinimi
  };
})(window);
