# CLAUDE.md — Guida per AI assistants

Questo file viene letto automaticamente all'avvio di ogni sessione Claude. Contiene il contesto necessario per essere subito produttivi senza ri-esplorare il repo.

## Cos'è questo progetto

**Mirox CRM Vendita** — modulo di gestione vendite e post-vendita di Konatech. Static HTML + Netlify Functions (Node) + Supabase Postgres.

---

## Manutenzione di questa guida (regola persistente)

**Regola fondamentale**: ogni task che modifica codice, struttura o regole del progetto deve aggiornare i file di documentazione (`README.md`, `CLAUDE.md`, `database/README.md`) **nella stessa sessione**, prima di considerarsi concluso. Niente "lo aggiorno dopo" — il drift documentale si crea così e questa guida diventa inutile (è già successo con il vecchio `README_UNIFICATO.txt`).

### Tabella trigger → cosa aggiornare

| Cosa cambia nel progetto | Aggiorna |
|---|---|
| Stack, dipendenza npm, libreria JS condivisa | `README.md` (Stack + Struttura) + `CLAUDE.md` (Architettura) |
| Struttura cartelle (nuova / spostata / rimossa) | `README.md` (Struttura) + `CLAUDE.md` (Architettura) |
| Env var Netlify (nuova / rimossa / rinominata) | `README.md` (Env vars) |
| Pagina HTML aggiunta / rimossa / spostata | `README.md` (tabella moduli) + `CLAUDE.md` (Flusso vendita se impattato) |
| Netlify function aggiunta / rimossa / rinominata | `README.md` (tabella Functions) + `CLAUDE.md` (Architettura layer 2) |
| Tabella / colonna / vista / RPC / trigger / RLS / bucket Supabase | `CLAUDE.md` (Mappa Supabase) + valutare migration in `/database/` + `database/README.md` |
| Nuova regola di business o validazione | `CLAUDE.md` (Regole di business) |
| Nuova convenzione (path, naming, libreria d'uso obbligata) | `CLAUDE.md` (Convenzioni) |
| Cron / schedule (nuovo / modificato / rimosso) | `README.md` (Schedulazioni) + `CLAUDE.md` (Architettura layer 2) |
| Nuova "nota operativa consapevole" (limitazione nota, soluzione temporanea) | `CLAUDE.md` (Note operative consapevoli) |
| Limitazione documentata risolta / password admin rimossa, ecc. | `CLAUDE.md` (rimuovere o aggiornare la nota corrispondente) |
| Cambio modello permessi / ruoli / pagine pannello Admin | `CLAUDE.md` (sezione "Pannello Admin Mirox") + `README.md` (sezione "Pannello Admin Mirox") |

### Self-check di fine task

Prima di dichiarare un task concluso:
1. Cosa ho toccato? (codice, schema, path, regola, dipendenza)
2. Riconosco la categoria nella tabella sopra?
3. Apro i file pertinenti e aggiorno
4. Cito brevemente nel report all'utente quali doc ho aggiornato

---

## Roadmap & boundaries (LEGGERE PRIMA DI MODIFICARE)

- **Vendita / Post-Vendita** = focus storico, completato in larga parte
- **Call Center integrato** = a partire dal 2026-06-20 le pagine CC sono integrate in `moduli/call-center/` (Fase 1: mount UI). Il CC prod su `mirox-crm.netlify.app` continua a girare in parallelo invariato — entrambi puntano allo stesso project Supabase
- **Fasi successive previste** (non ancora fatte): estensione `storico_cliente`, backfill `chiamate.anagrafica_id`, convergenza Upload Contratti con `origine_pratica` automatica

### URL deploy
- `test-upload-contratti-konahub.netlify.app` — deploy del repo `konahub-vendita-test` (focus storico di questa codebase, wizard vendita)
- `mirox-crm.netlify.app` — sito Call Center **PROD** (altro repo, NON in questa codebase, condivide DB Supabase). Continua a funzionare invariato dopo l'integrazione

### Tabelle condivise — toccare con cautela (regole NON negoziabili)

Modifiche a schema / RLS / RPC / trigger su queste tabelle hanno rischio di **rompere il Call Center in produzione**:

`profili`, `anagrafica`, `appuntamenti`, `chiamate`, `call_center_lead_outbound*`, `orari_standard`, `blocchi`, `slot_bloccati`, `impostazioni`, `blacklist`

3 regole di coordinamento col CC prod:
1. **Solo modifiche DB additive** — mai DROP/RENAME colonne, mai CHECK più stretti
2. **Mai modificare RPC esistenti** (solo aggiungerne di nuove con nuovi nomi, es. `cerca_o_crea_anagrafica_v2`)
3. **Le RLS nuove devono includere anche le pagine vecchie** — chiavi `pagine_accessibili` riutilizzate identiche (no prefisso `cc_`)

→ **chiedere conferma all'utente** prima di alterare qualsiasi tabella di questa lista.

---

## Architettura 3 layer

### 1. Frontend (`/`, `/moduli/`, `/moduli/call-center/`, `/js/`, `/css/`)

Pagine HTML statiche, no bundler. `/moduli/call-center/` contiene il modulo CC integrato (Fase 1, vedi sezione dedicata). Le pagine `admin*.html` alla root costituiscono il **Pannello Admin Mirox** (`admin.html` hub + `admin-utenti.html` + `admin-call-center-config.html` + `admin-vendita-config.html`), tutte gated da `profili.ruolo='admin'`. JS condiviso Mirox esposto su `window`:

| File JS | Espone | Uso |
|---|---|---|
| `js/config.js` | `window.db` (client Supabase) | URL + publishable/anon key |
| `js/auth.js` | `window.Auth` | `richiediAuth()` guard, `logout()`, `getProfilo()` |
| `js/anagrafica-helper.js` | `window.AnagraficaHelper` | `detectKind`, `cerca`, `cercaOcrea`, `setupAnagraficaSection` |
| `js/mirox-ui.js` | `window.MiroxUI` | `alert/confirm/prompt/loading/toast/allegati`. `allegati()` accetta sia `{url}` legacy sia `{bucket, path}` (genera signed URL on-click via MiroxStorage) |
| `js/mirox-storage.js` | `window.MiroxStorage` | `signedUrl(bucket,path,exp)`, `openAttachment(bucket,path)` — signed URL on-demand per i bucket privati (vedi sezione "Storage buckets") |
| `js/mirox-api.js` | `window.MiroxApi` | `fetch(url, opts)` wrapper che inietta `Authorization: Bearer <jwt>` dalla sessione Supabase. Usare per TUTTE le chiamate alle Netlify functions (vedi "Auth functions") |
| `js/mirox-upload.js` | `window.MiroxUpload` | drag-drop binding su `.mx-drop-zone` |
| `js/mirox-folder.js` | `window.MiroxFolder` | `build(oldName, newName, date)` per nomi cartella Storage |
| `js/mirox-mailer.js` | `window.MiroxMailer` | `send({to, template, vars})` |
| `js/vendita-storage-helper.js` | `uploadVenditaDocumento(...)` | wrapper upload PDF via Netlify function |

### 2. Server (`/netlify/functions/`)

Tutte le functions usano `SUPABASE_SERVICE_ROLE_KEY` e bypassano le RLS. Per questo motivo, dal 2026-06-24 (Fase B hardening) **TUTTE le functions tranne `cron-rientro-sim`** richiedono `Authorization: Bearer <jwt>` valido (validato via `_lib/require-auth.js`). `admin-vendita-config` richiede ulteriore check `ruolo='admin'`. Il client deve usare `MiroxApi.fetch()` o aggiungere l'header manualmente. 8 functions + 2 lib condivise:

- `vendita-config.js` (GET) — catalogo per wizard
- `admin-vendita-config.js` (GET/POST action-based) — CRUD admin offerte/opzioni/reload + replace regole documentali
- `crea-vendita-pratica-carrello.js` (POST) — multi-contratto: anagrafica upsert → pratica → N contratti con validazioni categoria-specifiche, rollback completo su errore. **Promuove** i PDA caricati in staging (`temp/<sess>/`) alla cartella definitiva della pratica e crea i record `vendita_documenti` corrispondenti. Cellulare + email obbligatori.
- `upload-vendita-documento.js` (POST multipart busboy, max 20MB) — bucket `contratti-vendita`, rollback file se INSERT DB fallisce. Supporta modalità staging: se viene passato `temp_session_id` (UUID), salva in `temp/<sess>/` senza creare record DB.
- `ocr-pda.js` (POST multipart, max 20MB) — OCR del PDA via Claude API (`claude-haiku-4-5-20251001`). Estrae cf_piva/ragione_sociale/nome_referente/cellulare/email/indirizzo. Sempre 200 anche se OCR parziale (campi `null`); 500 solo per errori hard. Richiede `ANTHROPIC_API_KEY`.
- `search-anagrafica.js` (GET) — lookup CF/PIVA
- `mirox-send-email.js` (POST) — endpoint pubblico mailer
- `cron-rientro-sim.js` (scheduled `0 7 * * *`) — notifica giornaliera switch SIM. **Non auth-gated** (chiamata dal cron Netlify, non da utente)
- `_lib/mailer.js` — helper SMTP Gmail + template DB + log
- `_lib/require-auth.js` — helper auth: valida JWT Supabase nell'header `Authorization: Bearer <token>`, ritorna `{ok, user, profilo}` o `{ok:false, status, error}`. Supporta opt `adminOnly: true` per richiedere `ruolo='admin'`. Usare in TUTTE le nuove functions

### 3. Database (Supabase Postgres)

~80 tabelle. Project ref: `lbgwamhjkjjfwgusafbi`. Credenziali pubbliche in `js/config.js` (single source of truth, non duplicarle qui).

---

## Mappa Supabase per dominio

### Anagrafica & Auth (condiviso)
- `profili` — utenti CRM, `ruolo` IN ('admin','operatore'), `pagine_accessibili` jsonb per ACL Call Center
- `anagrafica` — cliente unificato, `cf_piva` UNIQUE, `cluster` IN ('Consumer','Business','Turista'). Colonna `email` (text, NULL ammesso a livello DB ma obbligatoria lato wizard vendita). RPC `cerca_o_crea_anagrafica(p_..., p_email)` UPSERT

### Call Center (condiviso, gestito dall'altro progetto)
- `chiamate`, `appuntamenti`, `blacklist`, `orari_standard`, `blocchi`, `slot_bloccati`, `impostazioni`
- `call_center_lead_outbound` + `_chiamate` + `_attivita` + `_import` — outbound business con dedupe (`dedupe_key` UNIQUE), normalizzazione testo/telefono/email
- RPC chiave: `crm_can_access_page(text)`, `crm_normalize_*`, `crm_import_call_center_lead_outbound_batch`

### Vendita (focus di questo progetto)
- `vendita_categorie` — Mobile, Fisso, Energia, Allarmi, Customer Base, Assicurazioni
- `vendita_offerte` — `cluster_cliente`, `punteggio_gara`, `punteggio_extra_gara`, `abilita_dispositivo`, `abilita_switch_sim`
- `vendita_opzioni` — `punti_base`, `punti_extra_piva`
- `vendita_reload` — top-up
- `vendita_offerte_opzioni`, `vendita_offerte_reload` — link N:M
- `vendita_pratiche` — `origine_pratica`, `stato_pratica`, `nome_cartella_storage`, `storage_base_path`
- `vendita_contratti` — riga venduta con snapshot + punteggi server-side + `stato_controllo`
- `vendita_documenti`, `vendita_documenti_regole`, `vendita_compensi_regole`, `vendita_log_modifiche`
- Moduli operativi: `vendita_apri_chiudi`, `vendita_switch_sim`, `vendita_ordini_smartphone`, `vendita_simulatore_protecta`

### Post-Vendita
- `post_vendita_dispositivi_comodato` — codice generato da RPC `genera_codice_comodato()`
- `post_vendita_gestione_rimborsi` — codice da RPC `genera_codice_rimborso()`
- `post_vendita_controllo_fissi` — follow-up dei contratti Fisso dopo conferma in Verifica Contratti. Stati: `Da completare` → `In Attivazione` → (`Attivo` | `KO`). Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_fissi` su UPDATE `vendita_contratti.stato_controllo` quando un contratto Fisso passa a `controllato`. Campi manuali: `codice_cliente`, `tecnologia`, `cod_contratto`, `cod_pos`, `numero_fisso`, `attivazione_prevista`, `data_attivazione`, `motivo_ko`. Chat in `storico_chat` jsonb (`[{timestamp, message, autore}]`). CHECK constraint su `stato`, `tecnologia` (FTTC/FWA OUT/FWA IN/FWA VOCE/FTTH_OF/FTTH_FWCOP), `cod_pos` (9001415852/900822241).
- `post_vendita_controllo_lg` — follow-up dei contratti Energia (L&G = Luce & Gas, nome user-facing del modulo) dopo conferma in Verifica Contratti. Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_lg` su UPDATE `vendita_contratti.stato_controllo` quando un contratto Energia passa a `controllato`. Nessun campo manuale: tutti i dati sono letti dal join con `vendita_contratti` (`numero_contratto_energia`, `pod_pdr`, `ex_fornitore`, `operatore_id`) e `anagrafica` (`ragione_sociale`, `cf_piva`, `cellulare`). Colonne aggiornate dall'**upload CSV WindTre** (modulo Controllo L&G): `stato` (text, no CHECK), `causale_stato_pratica`, `messaggio_esito_sap`, `causa_annullamento` (questi 3 valorizzati solo per stato='Rifiutato'), `ultimo_csv_upload_at`, `ultimo_csv_upload_da`.
- `post_vendita_controllo_assicurazioni` — follow-up dei contratti Assicurazioni dopo conferma in Verifica Contratti. Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_assicurazioni`. Nessun campo manuale, nessuno stato: tutti i dati dal join con `vendita_contratti` (`nome_offerta_snapshot`, `modalita_pagamento_assicurazione`, `ricorrenza_assicurazione`, `operatore_id`) e `anagrafica`. Tabella minimal (solo id + FK + audit timestamp).
- `post_vendita_controllo_allarmi` — follow-up dei contratti Allarmi dopo conferma in Verifica Contratti. Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_allarmi`. Nessun campo manuale, nessuno stato: dati dal join con `vendita_contratti` (`nome_offerta_snapshot`, `modalita_pagamento`, `operatore_id`) e `anagrafica`. Tabella minimal.

### Trasversali
- `segnalazioni` (+ `segnalazioni_backup`)
- `ticket` — badge in dashboard quando `stato='Da gestire'`
- `email_template` (con `{{placeholder}}`), `email_log` (`status` IN sent/error)
- `dashboard_righe_giornaliera` — config righe dashboard custom

### Viste
- `vw_elenco_chiamate_unificate`, `vw_rilavorazione_ricontatti_unificata` — UNION standard + outbound
- `view_vendita_dashboard_giornaliera` / `_mensile` — aggregati `vendita_contratti`
- `storico_cliente` — **dal 2026-06-20 estesa con 4 UNION CC** (totale 12): tipi `ordine_smartphone`, `dispositivo_comodato`, `rimborso`, `apri_chiudi_vecchio`/`_nuovo`, `switch_sim_attuale`/`_rientro`, `contratto_vendita`, + nuovi `chiamata_cc`, `chiamata_cc_outbound`, `appuntamento_cc`, `blacklist`. Schema invariato (`anagrafica_id`, `tipo`, `record_id`, `riferimento`, `data_op`, `stato`, `descrizione`, `operatore_nome`). Definizione in `database/024_storico_cliente_extend_call_center.sql`

### RPC derivazione origine pratica (dal 2026-06-20, rilassata 2026-06-24)
- `vendita_deriva_origine(p_anagrafica_id uuid) RETURNS jsonb` — usata dal wizard Upload Contratti per pre-compilare `origine_pratica`. Output: `{origine_pratica, evento_tipo, evento_id, descrizione}`. Priorità:
  1. **Appuntamento confermato non gestito** (presentato IS NULL OR 'si') per anagrafica, con `data_ora` tra oggi e oggi+30gg → `appuntamento_callcenter`. Include sia "oggi" sia "cliente arrivato in anticipo per appuntamento futuro" (la descrizione lo segnala)
  2. **Chiamata** `passa_in_negozio`/`passa_a_cerea` per anagrafica negli ultimi 10gg, con `passaggio_stato <> 'chiuso'` (quindi `in_attesa` o `passato`) → `contatto_callcenter_entro_10_giorni`. Rilassato per coprire il caso in cui l'operatore CC non ha ancora cliccato "Presentato" in Rilavorazione ma il cliente è già passato
  3. Default → `spontaneo`
  - Migration 026 (versione iniziale) + 027 (rilassamento + trigger auto-chiusura)

### Auto-chiusura eventi CC su nuova pratica (dal 2026-06-24, fix B1)
**ATTENZIONE**: il vecchio trigger DB `trg_vendita_pratica_auto_chiudi_cc` è stato **DROPPATO** in migration 028. Motivo: scattava su INSERT pratica PRIMA della creazione contratti, lasciando appuntamenti annullati orfani in caso di rollback. La logica è stata spostata nel backend Netlify per essere eseguita solo dopo successo completo.

- **RPC** `vendita_chiudi_eventi_cc_per_pratica(p_anagrafica_id uuid, p_pratica_id uuid) RETURNS jsonb` — chiamata dal backend `crea-vendita-pratica-carrello.js` come ultimo step, DOPO che pratica + contratti + promozione PDA sono andati a buon fine. Ritorna `{appuntamenti_annullati, chiamate_chiuse, skipped}`. Best-effort: se fallisce non rompe la creazione pratica.
- Logica identica al vecchio trigger:
  - **Annulla** `appuntamenti` con `stato='confermato'` AND `presentato IS NULL` AND `data_ora >= ieri` → `stato='annullato'` + `motivo_modifica='Chiuso automaticamente: cliente passato in anticipo, pratica vendita <uuid>'`. Lascia stare `presentato='si'` (vanno esitati in "Esiti Appuntamenti") e `presentato='no'` (restano per "Rilavorazione → Non Presentati")
  - **Chiude** `chiamate` con `rilavorazione_stato='da_lavorare'` OR `passaggio_stato='in_attesa'` → `rilavorazione_stato='completato'` + `passaggio_stato='chiuso'` (solo se era `'in_attesa'`)
  - Anti-rollback safety: verifica che la pratica esista davvero prima di operare
- Migration: `database/027` (introduce funzione + trigger originale) + `database/028` (rimuove trigger, mantiene funzione + nuova variante con pratica_id)

### Indici performance RPC (dal 2026-06-24)
- `idx_appuntamenti_anagrafica_stato_data` — `(anagrafica_id, stato, data_ora) WHERE anagrafica_id IS NOT NULL` — usato da `vendita_deriva_origine` livello 1
- `idx_chiamate_anagrafica_esito_data` — `(anagrafica_id, esito, data_ora DESC) WHERE anagrafica_id IS NOT NULL` — usato da `vendita_deriva_origine` livello 2
- `idx_chiamate_anagrafica_rilavorazione` — `(anagrafica_id) WHERE anagrafica_id IS NOT NULL AND (rilavorazione_stato='da_lavorare' OR passaggio_stato='in_attesa')` — usato da `vendita_chiudi_eventi_cc_per_pratica`

### Wizard: pass-through evento origine al backend
Il wizard Upload Contratti, al submit, passa `pratica.appuntamento_id` e `pratica.chiamata_id` valorizzati con `runtimeState.origineAutoRilevata.evento_id` (solo se l'operatore non ha overridato l'origine auto-rilevata). Le colonne FK su `vendita_pratiche` esistono già da schema legacy e vengono ora effettivamente riempite per il flusso CC.

### Trigger auto-link anagrafica (dal 2026-06-20)
- `trg_chiamate_auto_link_anagrafica` — `BEFORE INSERT OR UPDATE OF cf_piva ON chiamate`: se `anagrafica_id` NULL e `cf_piva` non vuoto, fa lookup su `anagrafica` (UPPER+TRIM match) e popola `anagrafica_id`. Non sovrascrive mai un valore esplicito
- `trg_appuntamenti_auto_link_anagrafica` — stessa logica su `appuntamenti.codice_fiscale`
- Backfill già eseguito su 872 chiamate e 9 appuntamenti orfani: ora il 100% delle chiamate e il 99.2% degli appuntamenti hanno `anagrafica_id`. Definizione in `database/025_chiamate_appuntamenti_anagrafica_autolink.sql`

### Storage buckets

Dal 2026-06-24 (migration `029`) i bucket dati clienti sono **PRIVATI**. Lettura solo via **signed URL** generato lato client con `MiroxStorage.signedUrl(bucket, path)` o `MiroxStorage.openAttachment(bucket, path)` (scadenza default 5 min).

| Bucket | Public | Contenuto |
|---|---|---|
| `contratti-vendita` | privato | PDF dei contratti vendita + documenti identità clienti |
| `segnalazioni-files` | privato | Allegati segnalazioni + modelli disdetta in `modelli/<tipo>/` |
| `apri-chiudi-files` | privato | PDF apri/chiudi (cartella per pratica) |
| `switch-sim-files` | privato | PDF switch SIM (cartella per pratica) |
| `comodato-files` | privato | PDF moduli consegna/riconsegna comodato |
| `rimborsi-files` | privato | PDF moduli gestione rimborsi |
| `protecta-files` | privato | PDF preventivi simulatore Protecta |
| `moduli-template` | **pubblico** | Template modulistici (disdetta_fisso_consumer.pdf, ecc.) — generici, leggibili anche da non autenticati |

**Convenzione campi DB**: dopo migration 029 le colonne `cartella_url` / `preventivo_pdf_url` su `vendita_apri_chiudi`, `vendita_switch_sim`, `vendita_simulatore_protecta` contengono il **path** nel bucket (es. `dispositivo_X/file.pdf`), NON più un URL pubblico. I record legacy hanno ancora gli URL completi: il codice di lettura li gestisce entrambi (regex `replace` su prefisso `https://...storage/v1/object/public/<bucket>/`).

**RLS storage**: SELECT/INSERT/DELETE ristretti a `authenticated` per i bucket privati; le scritture passano comunque per Netlify functions con service_role.

---

## Flusso vendita end-to-end

1. `index.html` → login Supabase + check `profili.attivo`
2. `dashboard.html` → tab Vendita → card "Upload Contratti"
3. `moduli/upload-contratti-vendita.html` → wizard **5 step** con carrello multi-contratto:
   1. **Categoria + PDA**: dropdown categoria; se categoria ∈ `Mobile`/`Customer Base`/`Fisso` (costante `CATEGORIE_PDA`) → upload del PDA in staging via `POST /upload-vendita-documento` con `temp_session_id` UUID. Due bottoni: "Analizza con AI" (chiama `/ocr-pda` per pre-compilare anagrafica) e "Continua senza AI" (skip OCR). Per Energia/Allarmi/Assicurazioni nessun PDA viene caricato.
   2. **Anagrafica**: cf_piva (auto-detect cluster CF→Consumer, P.IVA→Business), email, cellulare, ragione sociale, ecc. Pre-compilata se l'OCR ha estratto dati. **Skippato automaticamente dal 2° contratto in poi** (anagrafica gia' nota nella pratica).
   3. **Dati contratto**: offerta/opzione/reload + campi specifici per categoria (Fisso/Energia/Allarmi/dispositivo).
   4. **Firma** (solo per categorie PDA): scelta tra `elettronica` o `cartacea`. Skippato per Energia/Allarmi/Assicurazioni. Il valore finisce in `vendita_contratti.tipo_firma`.
   5. **Documenti cliente**: documento_identita + eventuali copia_bolletta/copia_sim_mnp. Se `tipo_firma='cartacea'` appare anche il campo upload **"Contratto firmato"** (PDF della scansione del PDA firmato a mano dal cliente). **Niente upload contratto PDF originale qui** — quello e' gia' in staging dallo step 1.
4. Submit "Invia pratica" → `POST /netlify/functions/crea-vendita-pratica-carrello`:
   - Upsert `anagrafica` (cerca per `cf_piva`, aggiorna solo campi vuoti). Email + cellulare obbligatori (400 se mancanti).
   - INSERT `vendita_pratiche` con `stato_pratica='inviata'`
   - Calcolo `nome_cartella_storage` = `Contratto_<RAGSOC>_<DD_MM_YYYY>_<id6>`
   - INSERT N × `vendita_contratti` con snapshot categoria/offerta/opzione/reload + punteggi calcolati server-side
   - **Promozione PDA**: per ogni contratto con `pda_temp_path`, sposta il file da `temp/<sess>/` a `<cartella>/contratto_<categoria>.pdf` e crea il record `vendita_documenti` (tipo `contratto`)
   - Rollback pratica se anche un solo contratto fallisce
5. Upload PDF restanti (identita/bolletta/SIM) → `POST /netlify/functions/upload-vendita-documento` (multipart):
   - Upload su bucket `contratti-vendita` in `<YYYY>/<MM>/<cartella_safe>/`
   - INSERT `vendita_documenti`
   - Rollback file su Storage se INSERT DB fallisce
6. Verifica contratto in `moduli/verifica_contratti.html` → `confermaVerifica()` UPDATE `vendita_contratti SET stato_controllo='controllato'`. Il popup di conferma per i contratti Fisso/Energia evidenzia il passaggio rispettivamente al modulo Controllo Fissi / Controllo L&G. Per categoria Energia, sono obbligatori in fase di verifica `numero_contratto_energia` E `ex_fornitore` (entrambi compilati nella sezione "Campi specifici categoria" del popup verifica).
7. Post-vendita Fisso: il trigger `trg_vendita_contratti_to_controllo_fissi` crea automaticamente una riga in `post_vendita_controllo_fissi` con stato `Da completare`. L'operatore compila i 4 campi obbligatori (Cod. Cliente, Tecnologia, Cod. Contratto, Cod. POS) in `moduli/controllo_fissi.html` → click "Compilazione Completata" → stato `In Attivazione`. Poi via dropdown stato → `Attivo` (con data attivazione effettiva obbligatoria) oppure `KO` (azzera `attivazione_prevista`).
8. Post-vendita Energia (L&G): il trigger `trg_vendita_contratti_to_controllo_lg` crea automaticamente una riga in `post_vendita_controllo_lg`. La pagina `moduli/controllo_lg.html` mostra tutti i dati incolonnati in tabella (nessun popup dettagli, nessuno step di completamento): Data Inserimento, Ragione Sociale, CF/PIVA, Numero Contratto, POD/PDR, Ex Fornitore, Contatto (cellulare), Operatore, Stato.
9. Post-vendita Assicurazioni: il trigger `trg_vendita_contratti_to_controllo_assicurazioni` crea automaticamente una riga in `post_vendita_controllo_assicurazioni`. La pagina `moduli/controllo_assicurazioni.html` mostra in tabella: Data Inserimento, Ragione Sociale, CF/PIVA, Numero Contatto, Offerta scelta, Operatore, Metodo di pagamento (RID/Carta di Credito/Carta di Debito), Ricorrenza (Mensile/Annuale).
10. Post-vendita Allarmi: il trigger `trg_vendita_contratti_to_controllo_allarmi` crea automaticamente una riga in `post_vendita_controllo_allarmi`. La pagina `moduli/controllo_allarmi.html` mostra in tabella: Data Inserimento, Ragione Sociale, CF/PIVA, Numero Contatto, Offerta scelta, Operatore, Modalità di pagamento (Finanziamento/Anticipo).

---

## Regole di business chiave

### CF/PIVA → Cluster
- CF italiano (16 char, regex con caratteri omocodia) → `Consumer`
- P.IVA (11 cifre + Luhn IT) → `Business`
- Nessuno dei due → errore "verifica il dato" (no fallback)
- `Turista` → forza `categoria=Mobile`, `offerta="Untied - Call Your Country"`. Accettato solo da `crea-vendita-pratica-carrello.js`.

### Campi anagrafici obbligatori
Sia UI (`validateClienteData` in `upload-contratti-vendita.html`) sia backend (`crea-vendita-pratica-carrello.js`) **bloccano** la pratica se uno qualsiasi di questi campi e' vuoto o malformato:
- `cf_piva`, `cluster`, `ragione_sociale` (sempre obbligatori)
- `nome_referente`
- `cellulare`
- `email` (formato verificato con regex)
- `provincia`, `comune`, `via`, `civico` (indirizzo completo obbligatorio)

L'email viene normalizzata in lowercase. Nota: nel backend il flag `allowStrictContacts` controlla la severita' (oggi `false` per backwards compat con vecchi consumer della API).

### OCR sovrascrive sempre i dati anagrafici esistenti
Quando l'utente carica un PDA + sceglie "Analizza con AI", i dati estratti dall'OCR **sovrascrivono sempre** i valori dei campi del form, anche se l'anagrafica esiste gia' a DB con valori precedenti. Razionale: il PDA appena firmato e' la fonte di verita' piu' recente, l'anagrafica e' "always fresh".
- Implementazione: `applyOcrToAnagrafica` overwrite incondizionato + salva `runtimeState.lastOcrData`.
- Se l'utente clicca "Cerca cliente" dopo l'OCR, il risultato DB viene comunque sovrascritto da `lastOcrData` (re-applied in `cercaCliente`).
- `lastOcrData` viene azzerato quando si reset il form contratto (nuovo contratto nello stesso carrello).

### Categorie ammesse al flusso PDA
- Costante `CATEGORIE_PDA = ['Mobile', 'Customer Base', 'Fisso']`.
- Per queste 3 categorie il PDA (contratto PDF) e' obbligatorio e viene caricato allo step 1 del wizard in staging (`temp/<temp_session_id>/pda_<rand>.pdf`); poi promosso a `<cartella_pratica>/contratto_<categoria>.pdf` al submit.
- Per `Energia`, `Allarmi`, `Assicurazioni`: NESSUN PDA, NESSUN documento "contratto" (resta solo `documento_identita` + eventuali bolletta/SIM).
- L'OCR del PDA e' opzionale: il bottone "Continua senza AI" salta la chiamata a Claude API ma carica comunque il file in staging.

### Step Firma (solo categorie PDA)
- Solo per Mobile / Customer Base / Fisso il wizard chiede tra step Contratto e step Documenti la modalita' di firma: `elettronica` o `cartacea`. Il valore finisce in `vendita_contratti.tipo_firma` (vincolato dal CHECK constraint).
- `elettronica`: nessun upload aggiuntivo. Il PDA originale gia' in staging diventa l'unico `contratto.pdf` in cartella pratica.
- `cartacea`: nello step Documenti compare un upload "Contratto firmato" obbligatorio. Il file viene caricato a parte tramite `/upload-vendita-documento` con `tipo_documento='contratto_firmato'` e salvato come `<cartella_pratica>/contratto_firmato_<categoria>.pdf` (affianca il PDA originale).
- Per Energia/Allarmi/Assicurazioni lo step Firma e' saltato e `tipo_firma` resta NULL nel DB.

### Punteggi (anti-tampering)
- Il **frontend NON deve mai mandare i punteggi**
- Il server li legge da `vendita_offerte.punteggio_gara` + `vendita_opzioni.punteggio_gara` (e `_extra_gara`)
- Trigger `vendita_calcola_punteggio_totale` ricalcola il totale su ogni INSERT/UPDATE

### Validazioni categoria-specifiche (in `crea-vendita-pratica-carrello.js → validateCategorySpecificRules`)
- **Fisso**: `tipo_attivazione` IN ('Nuova Attivazione','Portabilita'); `apri_chiudi` Si/No; se Sì → `intestatario` IN ('Stesso intestatario','Intestatario diverso'). Al passaggio step 2 → step Firma il wizard apre un popup che richiede 2 campi obbligatori: `prezzo_fisso` (numerico >= 0) e `convergenza` IN ('Mobile','L&G','Allarme','Assicurazione','Sim Interna','NO Convergenza','Coupon'). La `convergenza` è enforced anche a livello DB con CHECK constraint (vedi migration 017).
- **Allarmi**: `modalita_pagamento` IN ('Finanziamento','Anticipo')
- **Dispositivo** (solo se `vendita_offerte.abilita_dispositivo=true` E `dispositivo_associato=true`):
  - `imei` regex `^\d{15}$`
  - `fascia_prezzo` obbligatoria
  - `tipo_acquisto` IN ('VAR','Finanziamento'); se Finanziamento → `finanziaria` IN ('Findomestic','Compass')
  - `kolme` boolean obbligatorio
- **Energia**: campo `pod_pdr` raccolto nel wizard. `numero_contratto_energia` e `ex_fornitore` (text libero) sono predisposti vuoti dal wizard e diventano **obbligatori in fase di verifica** (`moduli/verifica_contratti.html` → `confermaVerifica` valida entrambi prima del passaggio a `stato_controllo='controllato'`).
- **Assicurazioni**: `modalita_pagamento_assicurazione` IN ('RID','Carta di Credito','Carta di Debito') e `ricorrenza_assicurazione` IN ('Mensile','Annuale'), entrambi obbligatori (CHECK DB su migration 021). Sono colonne separate dal `modalita_pagamento` di Allarmi.
- **Mobile / Customer Base**: checkbox `reload_exchange`

### Origine pratica (CHECK constraint su `vendita_pratiche`)
`appuntamento_callcenter`, `contatto_callcenter_entro_10_giorni`, `spontaneo`

### Controllo Fissi (post-vendita)
- Tabella: `post_vendita_controllo_fissi` (vedi Mappa Supabase → Post-Vendita).
- **Trigger automatico** `trg_vendita_contratti_to_controllo_fissi`: alla conferma verifica di un contratto Fisso (UPDATE `vendita_contratti.stato_controllo` da `da_controllare` a `controllato`) viene creata una riga in `post_vendita_controllo_fissi` con stato `Da completare`. Idempotente grazie a UNIQUE su `contratto_id`.
- **Stati ammessi** (CHECK `pvcf_stato_chk`): `Da completare`, `In Attivazione`, `Attivo`, `KO`. Transizioni: `Da completare` → `In Attivazione` (via bottone "Compilazione Completata") → `Attivo` (richiede `data_attivazione` effettiva) | `KO` (azzera `attivazione_prevista`, opzionale `motivo_ko`). `KO` ammesso solo da `In Attivazione`. Stati `Attivo`/`KO` sono terminali (non modificabili da UI).
- **Campi obbligatori** per "Compilazione Completata" (validati lato UI in `moduli/controllo_fissi.html`): `codice_cliente`, `tecnologia`, `cod_contratto`, `cod_pos`. `numero_fisso` e `attivazione_prevista` opzionali.
- **Tecnologia** (CHECK `pvcf_tecnologia_chk`): `FTTC`, `FWA OUT`, `FWA IN`, `FWA VOCE`, `FTTH_OF`, `FTTH_FWCOP`.
- **Cod. POS** (CHECK `pvcf_cod_pos_chk`): `9001415852`, `900822241`.
- **Chat note**: array JSONB `storico_chat = [{timestamp, message, autore}]` — stesso pattern di `segnalazioni.storico_chat`.
- **UI a 2 tab**: `Da Completare` (pratiche aperte) + `Elenco Contratti` (vista unificata In Attivazione / Attivo / KO). La tab Elenco ha 3 filtri dropdown (Cluster, Tecnologia, Stato) e una search; la search è mutuamente esclusiva coi filtri (digitando si svuotano i dropdown, cambiando un filtro si svuota la search). Default all'apertura della tab Elenco: filtro Stato = `In Attivazione`. Tre stat-card live sopra la tabella: `In Attivazione` (totale aperti), `Attivati nel mese` (`stato=Attivo` AND `data_attivazione` nel mese corrente), `KO nel mese` (`stato=KO` AND `stato_cambiato_at` nel mese corrente).

### Controllo L&G (post-vendita Energia)
- Tabella: `post_vendita_controllo_lg` (vedi Mappa Supabase → Post-Vendita).
- **Trigger automatico** `trg_vendita_contratti_to_controllo_lg`: alla conferma verifica di un contratto Energia (UPDATE `vendita_contratti.stato_controllo` da `da_controllare` a `controllato`) viene creata una riga in `post_vendita_controllo_lg`. Idempotente grazie a UNIQUE su `contratto_id`.
- **Campi colonna** (UI `moduli/controllo_lg.html`, tabella diretta senza popup dettagli): Data Inserimento (`vendita_contratti.data_contratto`), Ragione Sociale, CF/PIVA, Numero Contratto (`vendita_contratti.numero_contratto_energia`, compilato in verifica), POD/PDR (`vendita_contratti.pod_pdr`), Ex Fornitore (`vendita_contratti.ex_fornitore`, compilato in verifica), Contatto (`anagrafica.cellulare`), Operatore (`profili.nome` via `vendita_contratti.operatore_id`), Stato (`post_vendita_controllo_lg.stato`).
- **`stato`**: text NULLABLE senza CHECK constraint (l'utente vuole flessibilita' nel caso il portale WindTre aggiunga stati nuovi). UI mostra "—" se NULL. Pillola colorata in base al valore (Attivato verde, Rifiutato rosso, ecc.).
- **Upload CSV WindTre** (bottone "📥 Carica CSV WindTre" nella tab Elenco):
  - Parser via PapaParse (CDN), separatore `;`, header riga 1.
  - **Match primario**: colonna `Proposta di Contratto` (CSV) ↔ `vendita_contratti.numero_contratto_energia` (exact match, trim).
  - **Double check**: per cluster `Consumer` confronta `Codice Fiscale` (col E) con `anagrafica.cf_piva`. Per `Business` confronta `Partita Iva` (col F) **normalizzata con padding zeri a sinistra fino a 11 cifre** (il portale rimuove gli zeri iniziali).
  - **Sovrascrittura sempre**: se il match passa, lo `stato` viene aggiornato anche se gia' valorizzato (es. da `Nuovo` a `Rifiutato` dopo qualche giorno).
  - **Aggregazione duplicati LUCE/GAS**: stesso `Proposta di Contratto` con 2 righe (1 LUCE + 1 GAS) → vince lo stato a priorita' maggiore (Rifiutato > Annullato > In lavorazione > In attivazione > Nuovo > Attivato), cosi' l'operatore vede sempre l'eventuale problema.
  - **Colonne dettaglio rifiuto** (`causale_stato_pratica`, `messaggio_esito_sap`, `causa_annullamento`) valorizzate **solo** se stato='Rifiutato' (azzerate altrimenti).
  - **Report finale**: popup con 5 stat-card (Righe CSV, Pratiche uniche, Aggiornati, Double check KO, Non trovati DB) + tabelle dettagliate delle incongruenze.
- **Icona occhio 👁️** in fondo alle righe con stato='Rifiutato': apre popup con i 3 campi dettaglio (causale/messaggio/causa). Per gli altri stati nessuna icona.

### Storage folder naming
- Contratti vendita: `Contratto_<RAGSOC_SAFE>_<DD_MM_YYYY>_<praticaIdShort6>` sotto `<YYYY>/<MM>/` (lowercase)
- Altri moduli: `MiroxFolder.build(old, new, date)` → `OLD_NEW_GG_MM_AA` (uppercase)

### Documenti
- Bucket: `contratti-vendita`
- Tipi gestiti: `documento_identita`, `contratto`, `contratto_firmato`, `copia_bolletta`, `copia_sim_mnp`
- Regole con `campo_condizione='admin_config'` sono gestibili da UI admin
- Nome standard: `documento_identita.pdf`, `contratto_<categoria_slug>.pdf`, `contratto_firmato_<categoria_slug>.pdf` (solo per firma cartacea), `copia_sim_mnp.pdf`, `copia_bolletta.pdf`
- Solo `application/pdf`, max 20 MB

---

## Modulo Call Center integrato (Fase 1, dal 2026-06-20)

Le 11 pagine CC + asset stanno in `moduli/call-center/` (la 12esima — `configurazione.html` — è stata spostata sotto Admin Mirox il 2026-06-24, vedi sezione "Pannello Admin Mirox"). Sono **port pragmatico** dalle pagine prod del CC: logica interna invariata (è testata in produzione da mesi), modifiche minimali per integrarle in Mirox.

### Cosa è stato modificato nel port (Fase 1 + harmonization 2026-06-24 + Admin split 2026-06-24)

1. **Redirect login**: `window.location.href='index.html'` → `'../../index.html'` (nei 11 HTML loggati + 4 JS: `js/auth.js`, `js/call-center-lead-outbound.js`, `js/prenota-interno-outbound.js`, `js/registra-chiamata-outbound.js`)
2. **Rimosso `index.html`** del CC (Mirox ha il proprio login alla root)
3. **Sidebar laterale CC RIMOSSA** (harmonization 2026-06-24): sostituita da `cc-header` (topbar + tabs orizzontali), generato dinamicamente da `js/cc-header.js`. Le tab sono filtrate per `pagine_accessibili` come la vecchia sidebar
4. **CSS DEDUPLICATO**: cancellata cartella `moduli/call-center/css/` (era duplicato byte-per-byte di `css/style.css`). Tutte le pagine CC ora referenziano `../../css/style.css` (single source of truth)
5. **Layout classes**: `.app-layout` → `.cc-layout`, `.main-content` → `.cc-main` (nuove classi in `css/style.css` senza margin-left della sidebar)
6. **Vecchio breadcrumb arancione rimosso**: era redundante con il bottone "Dashboard" nella nuova topbar
7. **`configurazione.html` ELIMINATA**: spostata fuori dal CC in `admin-call-center-config.html` (root). La tab Utenti è stata estratta in pagina separata `admin-utenti.html`. La vecchia chiave `configurazione` resta in `profili.pagine_accessibili` per coerenza col CC prod, ma non è più consumata da Mirox

### Componente JS `js/cc-header.js`

Esposto globalmente come `window.CcHeader`. API: `CcHeader.render(paginaChiavePerm)`. Genera in `#ccHeader`:
- **Topbar**: bottone "Dashboard" arancione (a sinistra) + logo Mirox (centro) + user chip + bottone logout (a destra)
- **Tab nav orizzontale**: 9 voci CC, filtrate per `profili.pagine_accessibili[perm]` (admin vede tutte). Tab corrente in evidenza arancione. La voce `configurazione` è stata rimossa il 2026-06-24 quando la pagina è migrata sotto Admin Mirox

### Cosa NON è ancora unificato (debito tecnico)

Le pagine CC ancora usano:
- `Utils.toast/openModal/closeModal/showLoading/...` (in `moduli/call-center/js/app.js`) invece di `MiroxUI.*`
- `alert()` / `confirm()` nativi in alcuni punti (es. `blacklist.html` rimuovi conferma)
- `db.from('anagrafica').insert(...)` diretto in `registra-chiamata.html` (riga ~651) invece di `AnagraficaHelper.cercaOcrea` — rischio basso di duplicati grazie al check precedente `cercaCliente()`, ma non rispetta lo standard Mirox

→ refactor profondo da fare iterativamente in sessioni successive, una pagina per volta

### Accesso dalla dashboard Mirox

- **Solo via bottone topbar** "Call Center" — niente tab/card nella dashboard (scelta UX dell'utente: la dashboard è focus Vendita/Post-Vendita, il CC ha la sua sidebar interna come navigazione)
- **Redirect dinamico runtime**: al caricamento dashboard, il JS calcola la **prima pagina CC accessibile** per l'utente (ordine: registra_chiamata → elenco_chiamate → rilavorazione → call_center_lead_outbound → appuntamenti → prenota_interno → appuntamenti_oggi → esiti_appuntamenti → blacklist) e imposta `href` del bottone topbar a quell'URL diretto
- **Disabilitato se nessun permesso**: se l'utente non ha **nessuna** delle chiavi CC in `pagine_accessibili` (e non è admin), il bottone resta in classe `.disabled` (come nasce nell'HTML statico) e il click è bloccato
- **Bottone "Torna alla dashboard Mirox"** in cima a ogni pagina CC integrata: arancione, ben visibile (era un breadcrumb piccolo, ora è un bottone stilizzato — eccetto `prenota.html` pubblica)

### Chiavi permessi (riusate identiche al CC prod)

`registra_chiamata`, `elenco_chiamate`, `rilavorazione`, `call_center_lead_outbound`, `appuntamenti`, `prenota_interno`, `appuntamenti_oggi`, `esiti_appuntamenti`, `blacklist`. La chiave `configurazione` resta valida in DB (CC prod la usa) ma da Mirox la pagina è sotto Admin (gated da `ruolo='admin'`, NON da `pagine_accessibili`).

→ Zero migrazione utenti: chi ha permesso `'registra_chiamata'` su `mirox-crm.netlify.app` vede la stessa card anche qua.

### Pagina pubblica `prenota.html`

Form esterno per prenotazioni dal sito/social. **NON in dashboard** (non ha auth guard). Raggiungibile solo via URL diretto. Lasciata invariata: usa `alert()` nativo e insert diretto su `appuntamenti` con `fonte='pubblico'`.

### Rischi e limiti noti

- **Permessi granulari Mirox solo per CC**: la modale "Permessi CC" in `admin-utenti.html` lista solo le 9 chiavi CC (le pagine Vendita/Post-Vendita sono accessibili a tutti gli utenti attivi, non c'è ancora granularità). Da estendere quando serve gating per modulo Vendita/Post-Vendita
- **`vw_elenco_chiamate_unificate` / `vw_rilavorazione_ricontatti_unificata`**: usate dalle pagine CC, dipendono dalla colonna `chiamate.rilavorazione_stato` (esiste) e dalle viste già createSE — verificate online in Fase 1
- **`get_slot_disponibili` RPC**: usata da `prenota.html`, `prenota-interno.html`, `appuntamenti.html` (per spostamento). Confermata esistente nel DB

---

## Pannello Admin Mirox (dal 2026-06-24)

Hub centralizzato di amministrazione, gated da `profili.ruolo='admin'`. Visibile dalla dashboard come bottone topbar "Admin" (disabilitato per operatori).

### Pagine

| Pagina | Scopo |
|---|---|
| `admin.html` | Hub con 3 card di navigazione (Gestione Utenti / Configurazione CC / Catalogo Vendita) |
| `admin-utenti.html` | CRUD su `profili`: cambio ruolo admin↔operatore con conferma, abilita/disabilita, modale permessi granulari CC (9 chiavi). Un admin non può togliersi il ruolo né disabilitarsi |
| `admin-call-center-config.html` | Configurazione CC (orari settimanali, blocchi/chiusure, parametri sistema). Spostata da `moduli/call-center/configurazione.html` (eliminata). NON dipende da `CcHeader` o dai JS del CC: usa solo `js/config.js` + `js/auth.js` + `js/mirox-ui.js` Mirox |
| `admin-vendita-config.html` | Esistente: CRUD cataloghi vendita. Aggiunto check `ruolo='admin'` (prima era solo `richiediAuth`). Bottone "← Admin" rimpiazza "← Dashboard" |

### Guard pattern (riusato in tutte le pagine admin*)

```js
const profilo = await Auth.richiediAuth();
if (!profilo) return;
if (profilo.ruolo !== 'admin') {
  await MiroxUI.alert('Accesso riservato agli amministratori.');
  window.location.href = 'dashboard.html';
  return;
}
```

### Attivazione bottone Admin in dashboard

In `dashboard.html` lo script di init aggiunge `href='admin.html'` e rimuove `.disabled` dal `#btnAdmin` solo se `profilo.ruolo === 'admin'`. Per gli operatori il bottone resta visibile ma in stato disabled (no click).

### Rimozione bottone Admin in upload

Il bottone "Admin" dentro `moduli/upload-contratti-vendita.html` è stato **rimosso** (sia HTML sia handler JS). L'accesso al pannello Admin avviene esclusivamente dalla topbar della dashboard (bottone `#btnAdmin`, attivo solo se `ruolo='admin'`). La vecchia password client-side `'1234'` non esiste più.

### Note operative

- La creazione di un nuovo utente richiede ancora due step manuali (Supabase Authentication → add user con email/password, poi qui si gli assegna ruolo/permessi). Una function `admin-create-user` con service_role potrebbe automatizzare in futuro
- I permessi granulari Vendita/Post-Vendita NON esistono ancora: tutte queste pagine sono accessibili a chiunque sia loggato e attivo. Quando serviranno, estendere la mappa `PAGINE_LABELS` in `admin-utenti.html`

---

## Convenzioni (rispettare per coerenza)

- **Path**: pagine in `/moduli/` → JS/CSS/link con `../` (es. `../js/config.js`, `../dashboard.html`). Pagine in `/moduli/call-center/` → JS/CSS/link Mirox con `../../` (es. `../../index.html`). I JS interni del CC (`/moduli/call-center/js/`) sono path-relativi alla pagina e funzionano out-of-the-box
- **Auth guard**: ogni pagina chiama `Auth.richiediAuth()` (gestisce redirect a `../index.html` o `index.html` in base al pathname). Le pagine CC continuano a usare il proprio `Auth` (in `moduli/call-center/js/auth.js`) — è un'entità separata da `js/auth.js` di Mirox, ma fa la stessa cosa
- **Modali**: usare `window.MiroxUI.{alert,confirm,prompt,toast,loading,allegati}`. **MAI** `alert()` / `confirm()` nativo del browser
- **Anagrafica**: SEMPRE via `AnagraficaHelper.cerca` / `cercaOcrea` (RPC `cerca_o_crea_anagrafica`) per evitare doppioni
- **Upload PDF**: SEMPRE via Netlify function. MAI `db.storage.from(...).upload()` dal client — la service_role non deve mai uscire dal server
- **Lettura allegati da bucket privati**: SEMPRE via `MiroxStorage.openAttachment(bucket, path)` o `MiroxStorage.signedUrl(...)`. **MAI** `getPublicUrl()` per i bucket privati (vedi sezione "Storage buckets"). Eccezione: `moduli-template` resta pubblico e accetta `getPublicUrl()`
- **Chiamate a Netlify functions dal client**: SEMPRE via `MiroxApi.fetch(url, opts)` — inietta `Authorization: Bearer <jwt>` dalla sessione Supabase. MAI `fetch()` diretto, altrimenti la function ritorna 401. Per FormData, NON settare `Content-Type` manualmente (il browser inserisce il boundary)
- **Auth in nuove Netlify functions**: usare `const { requireAuth } = require('./_lib/require-auth')` e all'inizio dell'handler `const auth = await requireAuth(event); if (!auth.ok) return response(auth.status, { success: false, error: auth.error });`. Per endpoint solo admin: `requireAuth(event, { adminOnly: true })`. CORS `Access-Control-Allow-Headers` deve includere `Authorization`
- **Email**: via `MiroxMailer.send({to, template, vars})` → endpoint `mirox-send-email`. Mai SMTP diretto dal client.
- **Nomi cartelle Storage**: via `MiroxFolder.build()` lato client o pattern equivalente nelle Netlify functions (`sanitizeSegment`)
- **Timestamp**: `timestamptz` salvati in UTC, mostrati in `Europe/Rome` lato UI (vedi pattern `formatCrmDateTime` nei moduli)
- **Nessun bundler**: import solo come `<script src=...>`, niente `import` / `require` lato browser
- **Sync con GitHub**: SOLO via `git push` dalla cartella locale (SSH già configurato per `mirkopiasenti`). **Mai upload via interfaccia web** GitHub — causerebbe drift fra locale e remoto. Repo: `git@github.com:mirkopiasenti/konahub-vendita-test.git`
- **Accesso Supabase autonomo (AI)**: il binario portable della Supabase CLI è in `.bin/supabase` (gitignored), già loggato via PAT salvato in `~/.supabase/access-token`, e il progetto è già linkato. Per introspezione/SQL su DB remoto: `.bin/supabase db query --linked "SELECT ..."` (passa per Management API, NON richiede DB password). Per applicare un file: `.bin/supabase db query --linked --file <path>`. Per migrations versionate: `.bin/supabase migration new <nome>` (crea file in `supabase/migrations/`), poi `db push` (questo richiede DB password — chiedere all'utente al momento)

---

## Note operative consapevoli (non "correggere" senza chiedere)

- **Edge Functions Supabase**: non in uso, non aggiungerne senza discutere prima
- **Cluster `Turista`**: accettato solo da `crea-vendita-pratica-carrello.js`. È voluto.
- **File SQL in `/database/`**: parziali, NON riflettono lo stato attuale del DB (vedi `database/README.md`)
- **Modulo `simulatore_protecta.html`**: ~960 KB, molto pesante perché contiene asset embedded. Modificare con cautela.
- **Permessi granulari Vendita/Post-Vendita**: non esistono ancora. Solo CC ha permessi fine-grained via `pagine_accessibili`. Le pagine Vendita/Post-Vendita sono accessibili a tutti gli utenti attivi, indipendentemente dal ruolo (admin/operatore). Solo il pannello Admin è gated dal `ruolo`.

---

## Quick reference

| Devo... | Faccio... |
|---|---|
| Aggiungere una nuova **regola di business** | Modificare in 3 punti: CHECK constraint DB + UI wizard + Netlify function di validazione |
| Aggiungere un **tipo documento** | Aggiornare `vendita_documenti_regole`, UI admin in `admin-vendita-config.html`, e nome standardizzato in `upload-vendita-documento.js` (`suggestedFileName`) |
| Aggiungere una **categoria vendita** | INSERT su `vendita_categorie` + eventuale ramo in `validateCategorySpecificRules` (carrello function) + UI wizard se ha campi speciali |
| Sapere lo **stato reale dello schema** | Query a `information_schema` / `pg_*` dal SQL Editor Supabase (non fidarsi dei file in `/database/`) |
| Modificare le **regole di accesso pagine Call Center** | NON farlo da qui — è gestito dall'altro progetto. Coordinare con utente. |
| **Promuovere un utente ad Admin** o gestire i permessi CC | Dashboard → Admin → Gestione Utenti (`admin-utenti.html`). Bottoni "Rendi Admin"/"Rendi Operatore" + modale "Permessi CC". Solo accessibile se sei admin |
| **Aggiungere una nuova pagina al pannello Admin** | Nuova card in `admin.html` + nuova pagina `admin-<nome>.html` alla root, riusare guard pattern `Auth.richiediAuth()` + check `ruolo === 'admin'` (vedi sezione "Pannello Admin Mirox") |
