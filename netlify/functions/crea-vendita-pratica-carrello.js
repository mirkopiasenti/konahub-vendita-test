const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_lib/require-auth');

const ORIGINI_PRATICA_AMMESSE = new Set([
  'appuntamento_callcenter',
  'contatto_callcenter_entro_10_giorni',
  'spontaneo'
]);

const CLUSTER_AMMESSI = new Set(['Consumer', 'Business', 'Turista']);
const TURISTA_CATEGORIA_FISSA = 'Mobile';
const TURISTA_OFFERTA_FISSA = 'Untied - Call Your Country';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
    throw new Error('Cluster non valido: usa Consumer, Business o Turista');
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

  const tipoAcquisto = cleanString(contract?.tipo_acquisto);
  const finanziaria = cleanString(contract?.finanziaria);

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
    kolme: dispositivoAssociato ? parseBoolean(contract?.kolme, null) : null,
    // Migration 035 - Smartphone Reload + modalita.
    // smartphone_reload: bool nullable (true=Si, false=No, null=non specificato).
    // smartphone_reload_modalita: text nullable, enum {Mantenere attivo, Disattivazione cliente}.
    // CHECK DB: se smartphone_reload=true, modalita NOT NULL; altrimenti modalita IS NULL.
    smartphone_reload: dispositivoAssociato ? parseBoolean(contract?.smartphone_reload, null) : null,
    smartphone_reload_modalita: (() => {
      if (!dispositivoAssociato) return null;
      const isSi = parseBoolean(contract?.smartphone_reload, null) === true;
      if (!isSi) return null;
      const raw = cleanString(contract?.smartphone_reload_modalita);
      if (!raw) return null;
      const allowed = ['Mantenere attivo', 'Disattivazione cliente'];
      if (!allowed.includes(raw)) {
        throw new Error(`contratti[${index}].smartphone_reload_modalita non valido (ammessi: ${allowed.join(', ')})`);
      }
      return raw;
    })(),
    // Campi nuovi (Mirox §): predisposizione dei dati extra
    //  - pod_pdr: identificatore contatore (solo Energia)
    //  - numero_contratto_energia: predisposto, popolato a posteriori
    //  - prezzo_fisso: prezzo di vendita per contratti Fisso (chiesto da popup UI)
    //  - reload_exchange + reload_forever: solo Mobile / Customer Base (migration 035)
    pod_pdr: cleanString(contract?.pod_pdr) || null,
    numero_contratto_energia: cleanString(contract?.numero_contratto_energia) || null,
    prezzo_fisso: (() => {
      const v = contract?.prezzo_fisso;
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    })(),
    reload_exchange: parseBoolean(contract?.reload_exchange, false) === true,
    reload_forever: parseBoolean(contract?.reload_forever, false) === true,
    // Convergenza (solo Fisso): uno dei 7 valori ammessi. null per altre categorie o se non fornita.
    // Vedi migration 017_vendita_contratti_convergenza.sql + CHECK constraint a DB.
    convergenza: (() => {
      const v = cleanString(contract?.convergenza);
      if (!v) return null;
      const allowed = ['Mobile', 'L&G', 'Allarme', 'Assicurazione', 'Sim Interna', 'NO Convergenza', 'Coupon'];
      if (!allowed.includes(v)) {
        throw new Error(`Convergenza non valida per contratti[${index}]: deve essere uno fra ${allowed.join(', ')}`);
      }
      return v;
    })(),
    // PDA caricata in modalita' staging (temp/<session_id>/<file>). null se non applicabile
    // o se contratto e' in categoria senza PDA (Energia/Allarmi/Assicurazioni).
    pda_temp_path: cleanString(contract?.pda_temp_path) || null,
    // Tipo firma: 'elettronica' o 'cartacea' (solo per categorie PDA). null altrimenti.
    tipo_firma: cleanString(contract?.tipo_firma) || null,
    // Campi specifici Assicurazioni (vedi migration 017)
    modalita_pagamento_assicurazione: cleanString(contract?.modalita_pagamento_assicurazione) || null,
    ricorrenza_assicurazione: cleanString(contract?.ricorrenza_assicurazione) || null
  };
}

const CATEGORIE_PDA = new Set(['mobile', 'customer base', 'fisso']);

function isCategoriaPda(categoryName) {
  return CATEGORIE_PDA.has(normalizeCategoryName(categoryName));
}

/**
 * Promuove un PDA caricato in temp/<session>/<file> alla cartella definitiva
 * della pratica creata, e crea il record vendita_documenti corrispondente.
 * Best-effort: ritorna { ok: true } o { ok: false, error } senza throwing.
 */
async function promoteTempPda({ supabase, tempPath, basePath, categoriaName, praticaId, contrattoId, anagraficaId, uploadedBy }) {
  try {
    const categoriaSlug = sanitizeSegment(categoriaName || 'generico', 'generico').toLowerCase();
    const finalFileName = `contratto_${categoriaSlug}.pdf`;
    const cleanBase = String(basePath || '').replace(/\/+$/, '');
    const newPath = `${cleanBase}/${finalFileName}`;

    const { error: moveError } = await supabase
      .storage
      .from('contratti-vendita')
      .move(tempPath, newPath);

    if (moveError) {
      return { ok: false, error: `Move PDA fallito (${tempPath} -> ${newPath}): ${moveError.message}` };
    }

    const { error: insertError } = await supabase
      .from('vendita_documenti')
      .insert({
        pratica_id: praticaId,
        contratto_id: contrattoId,
        anagrafica_id: anagraficaId,
        tipo_documento: 'contratto',
        storage_bucket: 'contratti-vendita',
        storage_path: newPath,
        file_name: finalFileName,
        mime_type: 'application/pdf',
        file_size: null,
        uploaded_by: uploadedBy || null
      });

    if (insertError) {
      return { ok: false, error: `Insert record vendita_documenti fallito per PDA ${newPath}: ${insertError.message}` };
    }

    return { ok: true, storage_path: newPath };
  } catch (err) {
    return { ok: false, error: err?.message || 'Errore promozione PDA' };
  }
}

function normalizeCategoryName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeComparableText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase()
    .trim();
}

function validateCategorySpecificRules({ contract, category, offer, index }) {
  const categoryName = normalizeCategoryName(category?.nome);

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

  if (categoryName === 'assicurazioni') {
    contract.modalita_pagamento_assicurazione = normalizeTextArrayValue(
      contract.modalita_pagamento_assicurazione,
      ['RID', 'Carta di Credito', 'Carta di Debito'],
      `contratti[${index}].modalita_pagamento_assicurazione`
    );
    if (!contract.modalita_pagamento_assicurazione) {
      throw new Error(`Campo obbligatorio mancante: contratti[${index}].modalita_pagamento_assicurazione`);
    }
    contract.ricorrenza_assicurazione = normalizeTextArrayValue(
      contract.ricorrenza_assicurazione,
      ['Mensile', 'Annuale'],
      `contratti[${index}].ricorrenza_assicurazione`
    );
    if (!contract.ricorrenza_assicurazione) {
      throw new Error(`Campo obbligatorio mancante: contratti[${index}].ricorrenza_assicurazione`);
    }
  } else {
    // Per altre categorie, ignora valori eventualmente arrivati dal client
    contract.modalita_pagamento_assicurazione = null;
    contract.ricorrenza_assicurazione = null;
  }

  const deviceEnabledForOffer = parseBoolean(offer?.abilita_dispositivo, false) === true;

  if (!deviceEnabledForOffer) {
    if (contract.dispositivo_associato) {
      throw new Error(`Dispositivo non ammesso per contratti[${index}]: offerta non abilitata alla gestione dispositivo`);
    }
    contract.imei = null;
    contract.fascia_prezzo = null;
    contract.tipo_acquisto = null;
    contract.finanziaria = null;
    contract.kolme = null;
    return;
  }

  if (!contract.dispositivo_associato) {
    contract.imei = null;
    contract.fascia_prezzo = null;
    contract.tipo_acquisto = null;
    contract.finanziaria = null;
    contract.kolme = null;
    return;
  }

  // Riconosce l'offerta Fisso "FWA Indoor" (case-insensitive, match parziale)
  // sul nome offerta. Per FWA Indoor: il device (modem) e' sempre associato,
  // ma tipo_acquisto + kolme + smartphone_reload non sono rilevanti.
  const offerName = String(offer?.nome_offerta || '').toLowerCase();
  const isFwaIndoor = categoryName === 'fisso' && offerName.includes('fwa') && offerName.includes('indoor');

  if (!contract.imei || !/^\d{15}$/.test(contract.imei)) {
    throw new Error(`IMEI non valido per contratti[${index}]: richieste 15 cifre`);
  }

  if (!contract.fascia_prezzo) {
    throw new Error(`Campo obbligatorio mancante: contratti[${index}].fascia_prezzo`);
  }

  // tipo_acquisto: obbligatorio per Mobile/Customer Base.
  // Per Fisso FWA Indoor e' SEMPRE 'VAR' (modem a rate, mai finanziamento) -
  // il wizard lo blocca lato UI, qui lo forziamo come safety net server-side.
  if (isFwaIndoor) {
    contract.tipo_acquisto = 'VAR';
    contract.finanziaria = null;
  } else if (!contract.tipo_acquisto) {
    throw new Error(`Campo obbligatorio mancante: contratti[${index}].tipo_acquisto`);
  }

  if (contract.tipo_acquisto && contract.tipo_acquisto.toLowerCase() === 'finanziamento') {
    if (!contract.finanziaria) {
      throw new Error(`Campo obbligatorio mancante: contratti[${index}].finanziaria`);
    }

    if (!['Findomestic', 'Compass'].includes(contract.finanziaria)) {
      throw new Error(`Finanziaria non valida per contratti[${index}]`);
    }
  } else {
    contract.finanziaria = null;
  }

  // kolme: obbligatorio per Mobile/Customer Base (device con telefono).
  // Per Fisso FWA Indoor (modem) e' opzionale: il wizard nasconde il campo
  // e il backend lo forza a NULL.
  if (isFwaIndoor) {
    contract.kolme = null;
    contract.smartphone_reload = null;
    contract.smartphone_reload_modalita = null;
  } else if (contract.kolme === null) {
    throw new Error(`Campo obbligatorio mancante: contratti[${index}].kolme`);
  }

  // Migration 035 — Smartphone Reload: la modalita e' obbligatoria solo se Si.
  // Coerenza con CHECK DB vc_smartphone_reload_coerenza_chk.
  if (contract.smartphone_reload === true && !contract.smartphone_reload_modalita) {
    throw new Error(`contratti[${index}].smartphone_reload=Si: smartphone_reload_modalita obbligatoria`);
  }
  if (contract.smartphone_reload !== true && contract.smartphone_reload_modalita) {
    // Sanity: il CHECK DB la rifiuterebbe; meglio normalizzarla qui.
    contract.smartphone_reload_modalita = null;
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

  const auth = await requireAuth(event);
  if (!auth.ok) return response(auth.status, { success: false, error: auth.error });

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
  const email = cleanString(cliente.email);
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

  // Strict contacts validation: il nuovo wizard PDA-first richiede sempre cellulare + email
  // validi. L'UI lo applica gia' lato client (validateClienteData), ma il backend e' la
  // source of truth.
  if (!cellulare) {
    return response(400, { success: false, error: 'Campo obbligatorio mancante: cliente.cellulare' });
  }
  if (!email) {
    return response(400, { success: false, error: 'Campo obbligatorio mancante: cliente.email' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response(400, { success: false, error: 'cliente.email non e\' un indirizzo valido' });
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
      .select('id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, email, provincia, comune, via, civico')
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
        email,
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
          email,
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

    // ----------------------------------------------------------------
    // GUARD CONSENSO PRIVACY (migration 034).
    // La pratica non puo' essere creata se per l'anagrafica non esiste
    // un consenso 'confermato', non scaduto, non revocato. Il wizard
    // dovrebbe averlo raccolto (modale OTP o cartaceo) prima del submit
    // oppure trovato in dedupe 48 mesi. Il client puo' passare
    // pratica.consenso_id per evitare race su consensi multipli; se
    // passato, verifichiamo che corrisponda davvero a quello attivo.
    // ----------------------------------------------------------------
    const consensoIdInput = normalizeUuidOrNull(pratica.consenso_id);
    const { data: consensoAttivo, error: consensoLookupError } = await supabase
      .from('vendita_consensi_privacy')
      .select('id, anagrafica_id, stato, modalita, valido_fino_al, revocato_at')
      .eq('anagrafica_id', anagraficaId)
      .eq('stato', 'confermato')
      .is('revocato_at', null)
      .gt('valido_fino_al', new Date().toISOString())
      .order('valido_fino_al', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (consensoLookupError) {
      throw new Error(readableError(consensoLookupError, 'Errore verifica consenso privacy'));
    }
    if (!consensoAttivo) {
      throw new Error('Consenso privacy mancante o scaduto per questo cliente. Raccogliere un nuovo consenso (OTP via SMS o modulo cartaceo firmato) prima di inviare la pratica.');
    }
    if (consensoIdInput && consensoIdInput !== consensoAttivo.id) {
      throw new Error('consenso_id passato dal client non corrisponde al consenso attivo per questa anagrafica');
    }
    const consensoIdValidato = consensoAttivo.id;

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

    // Back-link al consenso privacy: se il consenso non aveva pratica_id (es.
    // appena raccolto senza pratica_id forward dal client), lo agganciamo qui.
    // Best-effort: se l'update fallisce non rompiamo la pratica.
    try {
      await supabase
        .from('vendita_consensi_privacy')
        .update({ pratica_id: praticaRow.id })
        .eq('id', consensoIdValidato)
        .is('pratica_id', null);
    } catch (_) { /* ignore */ }

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
    const pdaWarnings = [];

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

      const isTuristaCluster = cluster === 'Turista';

      if (isTuristaCluster) {
        const categoriaNormalized = normalizeCategoryName(categoria.nome);
        const offertaNormalized = normalizeComparableText(offerta.nome_offerta);

        if (categoriaNormalized !== normalizeCategoryName(TURISTA_CATEGORIA_FISSA)) {
          throw new Error(`Per cluster Turista la categoria deve essere ${TURISTA_CATEGORIA_FISSA} (contratti[${index}])`);
        }

        if (offertaNormalized !== normalizeComparableText(TURISTA_OFFERTA_FISSA)) {
          throw new Error(`Per cluster Turista l'offerta deve essere "${TURISTA_OFFERTA_FISSA}" (contratti[${index}])`);
        }
      } else if (cluster && offerta.cluster_cliente && offerta.cluster_cliente !== cluster) {
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

        if (!isTuristaCluster && cluster && opzione.cluster_cliente && opzione.cluster_cliente !== cluster) {
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
        offer: offerta,
        index
      });

      // Validazione reinserimento (migration 033).
      //   - stato_inserimento default 'inserimento'; ammessi 'inserimento'/'reinserimento'
      //   - se 'reinserimento' => reinserimento_di_contratto_id DEVE essere UUID valido
      //     e riferire un contratto esistente con stessa anagrafica e stessa categoria.
      //   - se 'inserimento' => reinserimento_di_contratto_id viene forzato a null.
      const statoInsRaw = cleanString(item.stato_inserimento);
      const statoInserimento = statoInsRaw || 'inserimento';
      if (!['inserimento', 'reinserimento'].includes(statoInserimento)) {
        throw new Error(`contratti[${index}].stato_inserimento non valido: usa "inserimento" o "reinserimento"`);
      }
      item.stato_inserimento = statoInserimento;

      if (statoInserimento === 'reinserimento') {
        const reinsId = normalizeUuidOrNull(item.reinserimento_di_contratto_id);
        if (!reinsId) {
          throw new Error(`contratti[${index}].reinserimento_di_contratto_id obbligatorio (UUID) se stato_inserimento='reinserimento'`);
        }
        const { data: parentContract, error: parentErr } = await supabase
          .from('vendita_contratti')
          .select('id, anagrafica_id, categoria_id')
          .eq('id', reinsId)
          .maybeSingle();
        if (parentErr) {
          throw new Error(`Errore verifica reinserimento_di_contratto_id (contratti[${index}]): ${parentErr.message}`);
        }
        if (!parentContract) {
          throw new Error(`contratti[${index}].reinserimento_di_contratto_id non trovato`);
        }
        if (parentContract.anagrafica_id !== anagraficaId) {
          throw new Error(`contratti[${index}].reinserimento_di_contratto_id appartiene a un altro cliente`);
        }
        if (parentContract.categoria_id !== item.categoria_id) {
          throw new Error(`contratti[${index}].reinserimento_di_contratto_id e' di una categoria diversa`);
        }
        item.reinserimento_di_contratto_id = reinsId;
      } else {
        item.reinserimento_di_contratto_id = null;
      }

      // Validazione tipo_firma:
      //  - categorie PDA (Mobile/Customer Base/Fisso): valore obbligatorio in
      //    ('elettronica','cartacea')
      //  - categorie senza PDA: deve essere null (verra' resettato a null se inviato)
      if (isCategoriaPda(categoria.nome)) {
        if (!item.tipo_firma) {
          throw new Error(`Campo obbligatorio mancante: contratti[${index}].tipo_firma`);
        }
        if (!['elettronica', 'cartacea'].includes(item.tipo_firma)) {
          throw new Error(`contratti[${index}].tipo_firma non valido: usa "elettronica" o "cartacea"`);
        }
      } else {
        item.tipo_firma = null;
      }

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

        // Migration 035 - Smartphone Reload + modalita
        smartphone_reload: item.smartphone_reload,
        smartphone_reload_modalita: item.smartphone_reload_modalita,

        // Campi extra Mirox (vedi migration 012_contratti_extra_fields.sql)
        pod_pdr: item.pod_pdr,
        numero_contratto_energia: item.numero_contratto_energia,
        prezzo_fisso: item.prezzo_fisso,
        reload_exchange: item.reload_exchange,
        reload_forever: item.reload_forever,

        // Tipo firma (vedi migration 016): solo per categorie PDA. null altrimenti.
        tipo_firma: item.tipo_firma,

        // Convergenza (vedi migration 017): solo Fisso. null altrimenti.
        convergenza: item.convergenza,

        // Campi specifici Assicurazioni (vedi migration 021): null per altre categorie.
        modalita_pagamento_assicurazione: item.modalita_pagamento_assicurazione,
        ricorrenza_assicurazione: item.ricorrenza_assicurazione,

        // Reinserimento (vedi migration 033): default 'inserimento'.
        // Se 'reinserimento', reinserimento_di_contratto_id e' gia' stato
        // validato sopra (UUID, stessa anagrafica, stessa categoria).
        stato_inserimento: item.stato_inserimento,
        reinserimento_di_contratto_id: item.reinserimento_di_contratto_id,

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

      // Promozione PDA temp -> cartella pratica (se applicabile).
      // Best-effort: warning ma non fa fallire la pratica gia' creata.
      if (item.pda_temp_path) {
        const result = await promoteTempPda({
          supabase,
          tempPath: item.pda_temp_path,
          basePath: storageBasePath,
          categoriaName: categoria.nome,
          praticaId: praticaRow.id,
          contrattoId: insertedContract.id,
          anagraficaId,
          uploadedBy: operatoreId
        });
        if (!result.ok) {
          pdaWarnings.push({ contratto_index: index, pda_temp_path: item.pda_temp_path, error: result.error });
        }
      }
    }

    // Fase 4.1-fix: auto-chiusura eventi CC (appuntamenti futuri non gestiti
    // + chiamate in rilavorazione) per questo cliente. Eseguita SOLO ora,
    // dopo che la pratica + i contratti sono andati a buon fine. Cosi' un
    // eventuale rollback (catch sotto) non lascia eventi CC orfani.
    // Best-effort: warning ma non fa fallire la pratica gia' creata.
    let cleanupCcEventi = null;
    try {
      const { data: cleanupResult, error: cleanupError } = await supabase.rpc(
        'vendita_chiudi_eventi_cc_per_pratica',
        { p_anagrafica_id: anagraficaId, p_pratica_id: praticaRow.id }
      );
      if (cleanupError) {
        console.warn('Auto-chiusura eventi CC fallita (non bloccante):', cleanupError.message);
      } else {
        cleanupCcEventi = cleanupResult;
      }
    } catch (cleanupEx) {
      console.warn('Auto-chiusura eventi CC eccezione (non bloccante):', cleanupEx?.message || cleanupEx);
    }

    return response(200, {
      success: true,
      anagrafica_id: anagraficaId,
      pratica_id: praticaRow.id,
      consenso_id: consensoIdValidato,
      storage_base_path: storageBasePath,
      nome_cartella_storage: nomeCartellaStorage,
      contratti: createdContracts,
      pda_warnings: pdaWarnings,
      cleanup_cc_eventi: cleanupCcEventi
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
