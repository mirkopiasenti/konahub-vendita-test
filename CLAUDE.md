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

### Self-check di fine task

Prima di dichiarare un task concluso:
1. Cosa ho toccato? (codice, schema, path, regola, dipendenza)
2. Riconosco la categoria nella tabella sopra?
3. Apro i file pertinenti e aggiorno
4. Cito brevemente nel report all'utente quali doc ho aggiornato

---

## Roadmap & boundaries (LEGGERE PRIMA DI MODIFICARE)

- **Vendita** = focus attuale, in lavorazione
- **Call Center** = progetto separato già in produzione (NON in questa codebase), condivide lo stesso database Supabase
- **Step 2 futuro**: merge dei due progetti in un unico front-end con navigazione integrata

### URL deploy
- `test-upload-contratti-konahub.netlify.app` — deploy del repo `konahub-vendita-test` (focus di questa codebase, wizard vendita)
- `mirox-crm.netlify.app` — sito Call Center (altro repo, condivide DB Supabase)

### Tabelle condivise — toccare con cautela

Modifiche a schema / RLS / RPC / trigger su queste tabelle hanno rischio di **rompere il Call Center in produzione**:

`profili`, `anagrafica`, `appuntamenti`, `chiamate`, `call_center_lead_outbound*`, `orari_standard`, `blocchi`, `slot_bloccati`, `impostazioni`, `blacklist`

→ **chiedere conferma all'utente** prima di alterarle.

---

## Architettura 3 layer

### 1. Frontend (`/`, `/moduli/`, `/js/`, `/css/`)

Pagine HTML statiche, no bundler. JS condiviso esposto su `window`:

| File JS | Espone | Uso |
|---|---|---|
| `js/config.js` | `window.db` (client Supabase) | URL + publishable/anon key |
| `js/auth.js` | `window.Auth` | `richiediAuth()` guard, `logout()`, `getProfilo()` |
| `js/anagrafica-helper.js` | `window.AnagraficaHelper` | `detectKind`, `cerca`, `cercaOcrea`, `setupAnagraficaSection` |
| `js/mirox-ui.js` | `window.MiroxUI` | `alert/confirm/prompt/loading/toast/allegati` |
| `js/mirox-upload.js` | `window.MiroxUpload` | drag-drop binding su `.mx-drop-zone` |
| `js/mirox-folder.js` | `window.MiroxFolder` | `build(oldName, newName, date)` per nomi cartella Storage |
| `js/mirox-mailer.js` | `window.MiroxMailer` | `send({to, template, vars})` |
| `js/vendita-storage-helper.js` | `uploadVenditaDocumento(...)` | wrapper upload PDF via Netlify function |

### 2. Server (`/netlify/functions/`)

Tutte le functions usano `SUPABASE_SERVICE_ROLE_KEY` e bypassano le RLS. 8 functions + 1 lib condivisa:

- `vendita-config.js` (GET) — catalogo per wizard
- `admin-vendita-config.js` (GET/POST action-based) — CRUD admin offerte/opzioni/reload + replace regole documentali
- `crea-vendita-pratica-carrello.js` (POST) — multi-contratto: anagrafica upsert → pratica → N contratti con validazioni categoria-specifiche, rollback completo su errore. **Promuove** i PDA caricati in staging (`temp/<sess>/`) alla cartella definitiva della pratica e crea i record `vendita_documenti` corrispondenti. Cellulare + email obbligatori.
- `upload-vendita-documento.js` (POST multipart busboy, max 20MB) — bucket `contratti-vendita`, rollback file se INSERT DB fallisce. Supporta modalità staging: se viene passato `temp_session_id` (UUID), salva in `temp/<sess>/` senza creare record DB.
- `ocr-pda.js` (POST multipart, max 20MB) — OCR del PDA via Claude API (`claude-haiku-4-5-20251001`). Estrae cf_piva/ragione_sociale/nome_referente/cellulare/email/indirizzo. Sempre 200 anche se OCR parziale (campi `null`); 500 solo per errori hard. Richiede `ANTHROPIC_API_KEY`.
- `search-anagrafica.js` (GET) — lookup CF/PIVA
- `mirox-send-email.js` (POST) — endpoint pubblico mailer
- `cron-rientro-sim.js` (scheduled `0 7 * * *`) — notifica giornaliera switch SIM
- `_lib/mailer.js` — helper SMTP Gmail + template DB + log

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

### Trasversali
- `segnalazioni` (+ `segnalazioni_backup`)
- `ticket` — badge in dashboard quando `stato='Da gestire'`
- `email_template` (con `{{placeholder}}`), `email_log` (`status` IN sent/error)
- `dashboard_righe_giornaliera` — config righe dashboard custom

### Viste
- `vw_elenco_chiamate_unificate`, `vw_rilavorazione_ricontatti_unificata` — UNION standard + outbound
- `view_vendita_dashboard_giornaliera` / `_mensile` — aggregati `vendita_contratti`
- `storico_cliente` — UNION 7 fonti per `anagrafica_id`

### Storage buckets (tutti pubblici in lettura)
`segnalazioni-files`, `apri-chiudi-files`, `switch-sim-files`, `protecta-files`, `comodato-files`, `rimborsi-files`, `moduli-template`, `contratti-vendita`

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
- **Energia**: campo `pod_pdr` (UI mostrata solo per Energia)
- **Mobile / Customer Base**: checkbox `reload_exchange`

### Origine pratica (CHECK constraint su `vendita_pratiche`)
`appuntamento_callcenter`, `contatto_callcenter_entro_10_giorni`, `spontaneo`

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

## Convenzioni (rispettare per coerenza)

- **Path**: pagine in `/moduli/` → JS/CSS/link con `../` (es. `../js/config.js`, `../dashboard.html`)
- **Auth guard**: ogni pagina chiama `Auth.richiediAuth()` (gestisce redirect a `../index.html` o `index.html` in base al pathname)
- **Modali**: usare `window.MiroxUI.{alert,confirm,prompt,toast,loading,allegati}`. **MAI** `alert()` / `confirm()` nativo del browser
- **Anagrafica**: SEMPRE via `AnagraficaHelper.cerca` / `cercaOcrea` (RPC `cerca_o_crea_anagrafica`) per evitare doppioni
- **Upload PDF**: SEMPRE via Netlify function. MAI `db.storage.from(...).upload()` dal client — la service_role non deve mai uscire dal server
- **Email**: via `MiroxMailer.send({to, template, vars})` → endpoint `mirox-send-email`. Mai SMTP diretto dal client.
- **Nomi cartelle Storage**: via `MiroxFolder.build()` lato client o pattern equivalente nelle Netlify functions (`sanitizeSegment`)
- **Timestamp**: `timestamptz` salvati in UTC, mostrati in `Europe/Rome` lato UI (vedi pattern `formatCrmDateTime` nei moduli)
- **Nessun bundler**: import solo come `<script src=...>`, niente `import` / `require` lato browser
- **Sync con GitHub**: SOLO via `git push` dalla cartella locale (SSH già configurato per `mirkopiasenti`). **Mai upload via interfaccia web** GitHub — causerebbe drift fra locale e remoto. Repo: `git@github.com:mirkopiasenti/konahub-vendita-test.git`
- **Accesso Supabase autonomo (AI)**: il binario portable della Supabase CLI è in `.bin/supabase` (gitignored), già loggato via PAT salvato in `~/.supabase/access-token`, e il progetto è già linkato. Per introspezione/SQL su DB remoto: `.bin/supabase db query --linked "SELECT ..."` (passa per Management API, NON richiede DB password). Per applicare un file: `.bin/supabase db query --linked --file <path>`. Per migrations versionate: `.bin/supabase migration new <nome>` (crea file in `supabase/migrations/`), poi `db push` (questo richiede DB password — chiedere all'utente al momento)

---

## Note operative consapevoli (non "correggere" senza chiedere)

- **Password admin client-side hardcoded** `1234` in `moduli/upload-contratti-vendita.html` (riga ~862). Noto, da rivedere in futuro
- **Edge Functions Supabase**: non in uso, non aggiungerne senza discutere prima
- **Cluster `Turista`**: accettato solo da `crea-vendita-pratica-carrello.js`. È voluto.
- **File SQL in `/database/`**: parziali, NON riflettono lo stato attuale del DB (vedi `database/README.md`)
- **Modulo `simulatore_protecta.html`**: ~960 KB, molto pesante perché contiene asset embedded. Modificare con cautela.

---

## Quick reference

| Devo... | Faccio... |
|---|---|
| Aggiungere una nuova **regola di business** | Modificare in 3 punti: CHECK constraint DB + UI wizard + Netlify function di validazione |
| Aggiungere un **tipo documento** | Aggiornare `vendita_documenti_regole`, UI admin in `admin-vendita-config.html`, e nome standardizzato in `upload-vendita-documento.js` (`suggestedFileName`) |
| Aggiungere una **categoria vendita** | INSERT su `vendita_categorie` + eventuale ramo in `validateCategorySpecificRules` (carrello function) + UI wizard se ha campi speciali |
| Sapere lo **stato reale dello schema** | Query a `information_schema` / `pg_*` dal SQL Editor Supabase (non fidarsi dei file in `/database/`) |
| Modificare le **regole di accesso pagine Call Center** | NON farlo da qui — è gestito dall'altro progetto. Coordinare con utente. |
