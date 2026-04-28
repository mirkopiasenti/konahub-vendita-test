const { createClient } = require('@supabase/supabase-js');

const ORIGINI_PRATICA_AMMESSE = new Set([
  'appuntamento_callcenter',
  'contatto_callcenter_entro_10_giorni',
  'spontaneo'
]);

const CLUSTER_AMMESSI = new Set(['Consumer', 'Business']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload)
  };
}

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeCfPiva(value) {
  return String(value || '').trim().toUpperCase();
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function parseBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'si'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;

  return fallback;
}

function normalizeCluster(value) {
  const raw = cleanString(value);

  if (!raw) {
    throw new Error('Campo obbligatorio mancante: cliente.cluster');
  }

  const normalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();

  if (!CLUSTER_AMMESSI.has(normalized)) {
    throw new Error('Cluster non valido: usa Consumer o Business');
  }

  return normalized;
}

function normalizeUuidOrNull(value) {
  const raw = cleanString(value);
  if (!raw) return null;
  return UUID_REGEX.test(raw) ? raw.toLowerCase() : null;
}

function sanitizeSegment(value, fallback = 'valore') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
}

function formatDateDdMmYyyy(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}_${mm}_${yyyy}`;
}

function buildStorageNames({ ragioneSociale, praticaId, now = new Date() }) {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const praticaShort = String(praticaId || '').replace(/-/g, '').slice(0, 6).toLowerCase() || 'xxxxxx';
  const ragioneSafe = sanitizeSegment(ragioneSociale, 'cliente');
  const datePart = formatDateDdMmYyyy(now);

  const nomeCartellaStorage = `Contratto_${ragioneSafe}_${datePart}_${praticaShort}`;
  const folderPathSegment = sanitizeSegment(nomeCartellaStorage, `contratto_${praticaShort}`).toLowerCase();
  const storageBasePath = `${year}/${month}/${folderPathSegment}/`;

  return { nomeCartellaStorage, storageBasePath };
}

function parseRequiredScore(value, label) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Configurazione non valida: ${label} non numerico`);
  }

  return parsed;
}

function parseOptionalScore(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readableError(error, fallback = 'Errore durante la creazione pratica carrello') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || error.error_description || error.details || fallback;
}

function normalizeTextArrayValue(value, allowedValues, fieldName) {
  const raw = cleanString(value);
  if (!raw) return null;

  const match = allowedValues.find((allowed) => allowed.toLowerCase() === raw.toLowerCase());

  if (!match) {
    throw new Error(`${fieldName} non valido`);
  }

  return match;
}

function normalizeContractInput(contract, index) {
  const tempId = cleanString(contract?.temp_id) || `temp_${index + 1}`;
  const categoriaId = cleanString(contract?.categoria_id);
  const offertaId = cleanString(contract?.offerta_id);
  const opzioneId = cleanString(contract?.opzione_id);
  const reloadId = cleanString(contract?.reload_id);

  const dispositivoAssociato = parseBoolean(contract?.dispositivo_associato, false);
  const imei = cleanString(contract?.imei);

  if (!categoriaId) {
    throw new Error(`Campo obbligatorio mancante: contratti[${index}].categoria_id`);
  }

  if (!offertaId) {
    throw new Error(`Campo obbligatorio mancante: contratti[${index}].offerta_id`);
  }

  if (dispositivoAssociato) {
    if (!imei || !/^\d{15}$/.test(imei)) {
      throw new Error(`IMEI non valido per contratti[${index}]: richieste 15 cifre`);
    }
  }

  const tipoAcquisto = cleanString(contract?.tipo_acquisto);
  const finanziaria = cleanString(contract?.finanziaria);

  if (dispositivoAssociato && tipoAcquisto && tipoAcquisto.toLowerCase() === 'finanziamento') {
    if (!finanziaria) {
      throw new Error(`Campo obbligatorio mancante: contratti[${index}].finanziaria`);
    }

    if (!['Findomestic', 'Compass'].includes(finanziaria)) {
      throw new Error(`Finanziaria non valida per contratti[${index}]`);
    }
  }

  return {
    temp_id: tempId,
    categoria_id: categoriaId,
    offerta_id: offertaId,
    opzione_id: opzioneId,
    reload_id: reloadId,
    tipo_attivazione: cleanString(contract?.tipo_attivazione),
    apri_chiudi: cleanString(contract?.apri_chiudi),
    intestatario: cleanString(contract?.intestatario),
    switch_sim: cleanString(contract?.switch_sim),
    modalita_pagamento: cleanString(contract?.modalita_pagamento),
    dispositivo_associato: dispositivoAssociato,
    imei: dispositivoAssociato ? imei : null,
    fascia_prezzo: dispositivoAssociato ? cleanString(contract?.fascia_prezzo) : null,
    tipo_acquisto: dispositivoAssociato ? tipoAcquisto : null,
    finanziaria: dispositivoAssociato && tipoAcquisto && tipoAcquisto.toLowerCase() === 'finanziamento' ? finanziaria : null,
    kolme: dispositivoAssociato ? parseBoolean(contract?.kolme, null) : null
  };
}

function normalizeCategoryName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function containsAny(value, fragments) {
  const normalized = normalizeCategoryName(value);
  return fragments.some((fragment) => normalized.includes(fragment));
}

function validateCategorySpecificRules({ contract, category, offerName, index }) {
  const categoryName = normalizeCategoryName(category?.nome);
  const offerHasTelefono = containsAny(offerName, ['telefono', 'telefono incluso']);
  const offerHasFwaOrFttc = containsAny(offerName, ['fwa', 'fttc']);

  if (categoryName === 'fisso') {
    const tipoAttivazione = normalizeTextArrayValue(
      contract.tipo_attivazione,
      ['Nuova Attivazione', 'Portabilita', 'Portabilità'],
      `contratti[${index}].tipo_attivazione`
    );
    const apriChiudi = normalizeTextArrayValue(
      contract.apri_chiudi,
      ['Si', 'Sì', 'No'],
      `contratti[${index}].apri_chiudi`
    );

    contract.tipo_attivazione = tipoAttivazione === 'Portabilita' ? 'Portabilita' : tipoAttivazione;
    contract.apri_chiudi = apriChiudi === 'Si' ? 'Sì' : apriChiudi;

    if (contract.apri_chiudi === 'Sì') {
      contract.intestatario = normalizeTextArrayValue(
        contract.intestatario,
        ['Stesso intestatario', 'Intestatario diverso'],
        `contratti[${index}].intestatario`
      );
    } else {
      contract.intestatario = null;
    }
  }

  if (categoryName === 'allarmi') {
    contract.modalita_pagamento = normalizeTextArrayValue(
      contract.modalita_pagamento,
      ['Finanziamento', 'Anticipo'],
      `contratti[${index}].modalita_pagamento`
    );
  }

  if (!contract.dispositivo_associato) {
    contract.imei = null;
    contract.fascia_prezzo = null;
    contract.tipo_acquisto = null;
    contract.finanziaria = null;
    contract.kolme = null;
    return;
  }

  if (categoryName === 'customer base' && !offerHasTelefono) {
    throw new Error(`Dispositivo non ammesso per contratti[${index}] categoria Customer Base con questa offerta`);
  }

  if (categoryName === 'fisso' && !offerHasFwaOrFttc) {
    throw new Error(`Dispositivo non ammesso per contratti[${index}] categoria Fisso con questa tecnologia`);
  }

  if (categoryName === 'energia') {
    throw new Error(`Dispositivo non ammesso per contratti[${index}] categoria Energia`);
  }

  if (categoryName === 'mobile' && containsAny(offerName, ['untied', 'smart security'])) {
    throw new Error(`Dispositivo non ammesso per contratti[${index}] con questa offerta Mobile`);
  }

  if (categoryName === 'assicurazioni') {
    throw new Error(`Dispositivo non ammesso per contratti[${index}] categoria Assicurazioni`);
  }

  if (categoryName === 'allarmi') {
    throw new Error(`Dispositivo non ammesso per contratti[${index}] categoria Allarmi`);
  }
}

function indexById(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    map.set(row.id, row);
  });
  return map;
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, error: 'Metodo non consentito: usa POST' });
  }

  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';

  if (!contentType.toLowerCase().includes('application/json')) {
    return response(415, {
      success: false,
      error: 'Content-Type non valido: usare application/json'
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return response(500, {
      success: false,
      error: 'Variabili ambiente mancanti: SUPABASE_URL e/o SUPABASE_SERVICE_ROLE_KEY'
    });
  }

  let payload;

  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return response(400, {
      success: false,
      error: 'JSON non valido nel body della richiesta'
    });
  }

  const cliente = payload.cliente || {};
  const pratica = payload.pratica || {};
  const contrattiRaw = Array.isArray(payload.contratti) ? payload.contratti : [];

  const cfPiva = normalizeCfPiva(cliente.cf_piva);
  const ragioneSociale = cleanString(cliente.ragione_sociale);
  const nomeReferente = cleanString(cliente.nome_referente);
  const cellulare = cleanString(cliente.cellulare);
  const provincia = cleanString(cliente.provincia);
  const comune = cleanString(cliente.comune);
  const via = cleanString(cliente.via);
  const civico = cleanString(cliente.civico);

  let cluster;

  try {
    cluster = normalizeCluster(cliente.cluster);
  } catch (error) {
    return response(400, { success: false, error: error.message });
  }

  if (!cfPiva) {
    return response(400, { success: false, error: 'Campo obbligatorio mancante: cliente.cf_piva' });
  }

  if (!ragioneSociale) {
    return response(400, { success: false, error: 'Campo obbligatorio mancante: cliente.ragione_sociale' });
  }

  if (contrattiRaw.length === 0) {
    return response(400, { success: false, error: 'Inserire almeno un contratto nel carrello' });
  }

  let normalizedContracts = [];

  try {
    normalizedContracts = contrattiRaw.map((contract, index) => normalizeContractInput(contract, index));
  } catch (error) {
    return response(400, { success: false, error: error.message });
  }

  const originePratica = cleanString(pratica.origine_pratica) || 'spontaneo';
  const appuntamentoId = normalizeUuidOrNull(pratica.appuntamento_id);
  const chiamataId = normalizeUuidOrNull(pratica.chiamata_id);
  const operatoreId = normalizeUuidOrNull(pratica.operatore_id);

  if (!ORIGINI_PRATICA_AMMESSE.has(originePratica)) {
    return response(400, {
      success: false,
      error: 'origine_pratica non valida. Valori ammessi: appuntamento_callcenter, contatto_callcenter_entro_10_giorni, spontaneo'
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let createdPraticaId = null;

  try {
    let anagraficaId;

    const { data: anagraficaRows, error: anagraficaLookupError } = await supabase
      .from('anagrafica')
      .select('id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, provincia, comune, via, civico')
      .ilike('cf_piva', cfPiva)
      .limit(1);

    if (anagraficaLookupError) {
      throw new Error(readableError(anagraficaLookupError, 'Errore ricerca anagrafica'));
    }

    const anagraficaEsistente = Array.isArray(anagraficaRows) ? anagraficaRows[0] || null : null;

    if (anagraficaEsistente) {
      anagraficaId = anagraficaEsistente.id;

      const updates = {};
      const candidateFields = {
        cluster,
        ragione_sociale: ragioneSociale,
        nome_referente: nomeReferente,
        cellulare,
        provincia,
        comune,
        via,
        civico
      };

      if (cleanString(anagraficaEsistente.cf_piva) !== cfPiva) {
        updates.cf_piva = cfPiva;
      }

      Object.entries(candidateFields).forEach(([column, newValue]) => {
        if (isBlank(newValue)) return;
        const currentValue = anagraficaEsistente[column];

        if (isBlank(currentValue) || String(currentValue).trim() !== String(newValue).trim()) {
          updates[column] = newValue;
        }
      });

      if (Object.keys(updates).length > 0) {
        const { error: anagraficaUpdateError } = await supabase
          .from('anagrafica')
          .update(updates)
          .eq('id', anagraficaId);

        if (anagraficaUpdateError) {
          throw new Error(readableError(anagraficaUpdateError, 'Errore aggiornamento anagrafica esistente'));
        }
      }
    } else {
      const { data: anagraficaNuova, error: anagraficaInsertError } = await supabase
        .from('anagrafica')
        .insert({
          cf_piva: cfPiva,
          cluster,
          ragione_sociale: ragioneSociale,
          nome_referente: nomeReferente,
          cellulare,
          provincia,
          comune,
          via,
          civico
        })
        .select('id')
        .single();

      if (anagraficaInsertError) {
        throw new Error(readableError(anagraficaInsertError, 'Errore creazione anagrafica'));
      }

      anagraficaId = anagraficaNuova.id;
    }

    const { data: praticaRow, error: praticaInsertError } = await supabase
      .from('vendita_pratiche')
      .insert({
        anagrafica_id: anagraficaId,
        appuntamento_id: appuntamentoId,
        chiamata_id: chiamataId,
        operatore_id: operatoreId,
        origine_pratica: originePratica,
        stato_pratica: 'inviata',
        note: cleanString(pratica.note) || 'Pratica creata da carrello upload contratti vendita'
      })
      .select('*')
      .single();

    if (praticaInsertError) {
      throw new Error(readableError(praticaInsertError, 'Errore creazione vendita_pratiche'));
    }

    createdPraticaId = praticaRow.id;

    const { nomeCartellaStorage, storageBasePath } = buildStorageNames({
      ragioneSociale,
      praticaId: praticaRow.id,
      now: new Date()
    });

    const { error: praticaUpdateStorageError } = await supabase
      .from('vendita_pratiche')
      .update({
        nome_cartella_storage: nomeCartellaStorage,
        storage_base_path: storageBasePath
      })
      .eq('id', praticaRow.id);

    if (praticaUpdateStorageError) {
      throw new Error(readableError(praticaUpdateStorageError, 'Errore aggiornamento storage path pratica'));
    }

    const categoriaIds = [...new Set(normalizedContracts.map((item) => item.categoria_id))];
    const offertaIds = [...new Set(normalizedContracts.map((item) => item.offerta_id))];
    const opzioneIds = [...new Set(normalizedContracts.map((item) => item.opzione_id).filter(Boolean))];
    const reloadIds = [...new Set(normalizedContracts.map((item) => item.reload_id).filter(Boolean))];

    const queryPromises = [
      supabase.from('vendita_categorie').select('*').in('id', categoriaIds).eq('attiva', true),
      supabase.from('vendita_offerte').select('*').in('id', offertaIds).eq('attiva', true),
      opzioneIds.length > 0
        ? supabase.from('vendita_opzioni').select('*').in('id', opzioneIds).eq('attiva', true)
        : Promise.resolve({ data: [], error: null }),
      reloadIds.length > 0
        ? supabase.from('vendita_reload').select('*').in('id', reloadIds).eq('attivo', true)
        : Promise.resolve({ data: [], error: null })
    ];

    const [categorieRes, offerteRes, opzioniRes, reloadRes] = await Promise.all(queryPromises);

    const firstError =
      categorieRes.error ||
      offerteRes.error ||
      opzioniRes.error ||
      reloadRes.error;

    if (firstError) {
      throw new Error(readableError(firstError, 'Errore caricamento configurazione contratti'));
    }

    const categorieById = indexById(categorieRes.data);
    const offerteById = indexById(offerteRes.data);
    const opzioniById = indexById(opzioniRes.data);
    const reloadById = indexById(reloadRes.data);

    const createdContracts = [];

    for (let index = 0; index < normalizedContracts.length; index += 1) {
      const item = normalizedContracts[index];
      const categoria = categorieById.get(item.categoria_id);
      const offerta = offerteById.get(item.offerta_id);

      if (!categoria) {
        throw new Error(`Categoria non trovata o non attiva per contratti[${index}]`);
      }

      if (!offerta) {
        throw new Error(`Offerta non trovata o non attiva per contratti[${index}]`);
      }

      if (offerta.categoria_id !== item.categoria_id) {
        throw new Error(`Offerta non coerente con categoria per contratti[${index}]`);
      }

      if (cluster && offerta.cluster_cliente && offerta.cluster_cliente !== cluster) {
        throw new Error(`Offerta non coerente con cluster per contratti[${index}]`);
      }

      let opzione = null;

      if (item.opzione_id) {
        opzione = opzioniById.get(item.opzione_id);

        if (!opzione) {
          throw new Error(`Opzione non trovata o non attiva per contratti[${index}]`);
        }

        const opzioneCategoriaOk = !opzione.categoria_id || opzione.categoria_id === item.categoria_id;
        const opzioneOffertaOk = !opzione.offerta_id || opzione.offerta_id === item.offerta_id;

        if (!opzioneCategoriaOk || !opzioneOffertaOk) {
          throw new Error(`Opzione non coerente con categoria/offerta per contratti[${index}]`);
        }

        if (cluster && opzione.cluster_cliente && opzione.cluster_cliente !== cluster) {
          throw new Error(`Opzione non coerente con cluster per contratti[${index}]`);
        }
      }

      let reload = null;

      if (item.reload_id) {
        reload = reloadById.get(item.reload_id);

        if (!reload) {
          throw new Error(`Reload non trovato o non attivo per contratti[${index}]`);
        }
      }

      validateCategorySpecificRules({
        contract: item,
        category: categoria,
        offerName: offerta.nome_offerta || '',
        index
      });

      const punteggioGaraOfferta = parseRequiredScore(
        offerta.punteggio_gara,
        `punteggio_gara offerta (contratti[${index}])`
      );
      const punteggioGaraOpzione = opzione
        ? parseRequiredScore(opzione.punteggio_gara, `punteggio_gara opzione (contratti[${index}])`)
        : 0;
      const punteggioExtraGaraOfferta = parseOptionalScore(offerta.punteggio_extra_gara, 0);
      const punteggioExtraGaraOpzione = opzione ? parseOptionalScore(opzione.punteggio_extra_gara, 0) : 0;

      const punteggioOfferta = punteggioGaraOfferta;
      const punteggioOpzione = punteggioGaraOpzione;
      const punteggioExtra = 0;
      const punteggioTotale = Number((punteggioOfferta + punteggioOpzione + punteggioExtra).toFixed(2));

      const contrattoPayload = {
        pratica_id: praticaRow.id,
        anagrafica_id: anagraficaId,
        appuntamento_id: appuntamentoId,
        chiamata_id: chiamataId,
        operatore_id: operatoreId,

        cluster_cliente: cluster,
        categoria_id: item.categoria_id,
        offerta_id: item.offerta_id,
        opzione_id: item.opzione_id,
        reload_id: item.reload_id,

        categoria_snapshot: categoria.nome,
        nome_offerta_snapshot: offerta.nome_offerta,
        nome_opzione_snapshot: opzione ? opzione.nome_opzione : null,
        nome_reload_snapshot: reload ? reload.nome : null,

        punteggio_gara_offerta: punteggioGaraOfferta,
        punteggio_gara_opzione: punteggioGaraOpzione,
        punteggio_extra_gara_offerta: punteggioExtraGaraOfferta,
        punteggio_extra_gara_opzione: punteggioExtraGaraOpzione,

        punteggio_offerta: punteggioOfferta,
        punteggio_opzione: punteggioOpzione,
        punteggio_extra: punteggioExtra,
        punteggio_totale: punteggioTotale,

        tipo_attivazione: item.tipo_attivazione,
        apri_chiudi: item.apri_chiudi,
        intestatario: item.intestatario,
        switch_sim: item.switch_sim,
        modalita_pagamento: item.modalita_pagamento,

        dispositivo_associato: item.dispositivo_associato,
        imei: item.imei,
        fascia_prezzo: item.fascia_prezzo,
        tipo_acquisto: item.tipo_acquisto,
        finanziaria: item.finanziaria,
        kolme: item.kolme,

        stato_controllo: 'da_controllare'
      };

      const { data: insertedContract, error: contractInsertError } = await supabase
        .from('vendita_contratti')
        .insert(contrattoPayload)
        .select('*')
        .single();

      if (contractInsertError) {
        throw new Error(readableError(contractInsertError, `Errore creazione contratto indice ${index}`));
      }

      createdContracts.push({
        temp_id: item.temp_id,
        contratto_id: insertedContract.id,
        categoria_snapshot: insertedContract.categoria_snapshot,
        nome_offerta_snapshot: insertedContract.nome_offerta_snapshot,
        nome_opzione_snapshot: insertedContract.nome_opzione_snapshot,
        nome_reload_snapshot: insertedContract.nome_reload_snapshot,
        punteggio_gara_totale: numeric(
          insertedContract.punteggio_gara_totale,
          numeric(insertedContract.punteggio_gara_offerta, 0) + numeric(insertedContract.punteggio_gara_opzione, 0)
        ),
        punteggio_extra_gara_totale: numeric(
          insertedContract.punteggio_extra_gara_totale,
          numeric(insertedContract.punteggio_extra_gara_offerta, 0) + numeric(insertedContract.punteggio_extra_gara_opzione, 0)
        )
      });
    }

    return response(200, {
      success: true,
      anagrafica_id: anagraficaId,
      pratica_id: praticaRow.id,
      storage_base_path: storageBasePath,
      nome_cartella_storage: nomeCartellaStorage,
      contratti: createdContracts
    });
  } catch (error) {
    if (createdPraticaId) {
      await supabase.from('vendita_pratiche').delete().eq('id', createdPraticaId);
    }

    const message = readableError(error);
    const statusCode = /obbligatorio|non valido|coerente|ammesso|trovata|trovato|inserire/i.test(message) ? 400 : 500;

    return response(statusCode, {
      success: false,
      error: message
    });
  }
};
