# Mirox CRM — Vendita

Modulo CRM per la gestione di vendite, post-vendita e supporto operativo della rete Konatech. Static frontend HTML/JS + Netlify Functions (Node) + Supabase Postgres.

## Stack

- **Frontend**: HTML statico + JavaScript vanilla (no bundler), Inter via Google Fonts, client Supabase `@supabase/supabase-js@2` da CDN
- **Backend serverless**: Netlify Functions (Node + esbuild), librerie `@supabase/supabase-js`, `nodemailer`, `busboy`
- **Database**: Supabase Postgres (Auth + Storage + RLS + RPC + Trigger), 8 bucket Storage pubblici per dominio
- **Email**: Gmail SMTP via nodemailer + template DB (`email_template` + `email_log`)
- **Hosting**: Netlify (static + functions + cron schedules)

## Struttura cartelle

| Cartella / File | Cosa contiene |
|---|---|
| `index.html` | Login Supabase Auth |
| `dashboard.html` | Home con tabs Vendita / Post-Vendita / Call Center + bottone topbar Call Center + badge ticket aperti |
| `admin-vendita-config.html` | CRUD cataloghi (categorie, offerte, opzioni, reload, regole documenti) |
| `moduli/` | 16 pagine funzionali Vendita / Post-Vendita (`apri_chiudi`, `switch_sim`, `ordini_smartphone`, `dispositivi_comodato`, `gestione_rimborsi`, `segnalazioni`, `simulatore_protecta`, `storico_cliente`, `ticket`, `verifica_contratti`, `controllo_fissi`, `controllo_lg`, `controllo_assicurazioni`, `controllo_allarmi`, `dashboard_pezzi`, `upload-contratti-vendita`) |
| `moduli/call-center/` | **Modulo Call Center integrato (Fase 1)** — 12 pagine (`registra-chiamata`, `elenco-chiamate`, `rilavorazione`, `appuntamenti`, `appuntamenti-oggi`, `prenota-interno`, `esiti-appuntamenti`, `blacklist`, `call-center-lead-outbound`, `prenota-interno-outbound`, `registra-chiamata-outbound`, `configurazione`) + `prenota.html` (form pubblico). Vedi sezione "Modulo Call Center" sotto e [CLAUDE.md](CLAUDE.md) per i dettagli di coordinamento col CC prod |
| `js/` | Librerie condivise: `config`, `auth`, `mirox-ui`, `mirox-upload`, `mirox-folder`, `mirox-mailer`, `anagrafica-helper`, `vendita-storage-helper` |
| `css/` | `style.css`, `mirox-modules.css` |
| `assets/` | Logo, favicon |
| `netlify/functions/` | Endpoint server-side (vedi sotto) |
| `netlify/functions/_lib/` | Helper condivisi (`mailer.js`) |
| `database/` | Migrazioni SQL storiche **parziali** — vedi `database/README.md` |
| `netlify.toml` | Config Netlify + cron `cron-rientro-sim` |
| `package.json` | Dipendenze Node delle functions |
| `CLAUDE.md` | Mappa completa per AI assistants (architettura, schema, regole di business, convenzioni) |

### Netlify Functions

| Function | Metodo | Scopo |
|---|---|---|
| `vendita-config` | GET | Carica catalogo per il wizard contratti |
| `admin-vendita-config` | GET / POST | CRUD admin del catalogo |
| `crea-vendita-pratica-carrello` | POST | Crea pratica + N contratti con validazioni; promuove i PDA da staging |
| `upload-vendita-documento` | POST multipart | Upload PDF su bucket `contratti-vendita` (anche staging `temp/<sess>/`) |
| `ocr-pda` | POST multipart | OCR del PDA (Pratica di Adesione PDF) via Claude API — pre-compila l'anagrafica |
| `search-anagrafica` | GET | Ricerca cliente per CF/PIVA |
| `mirox-send-email` | POST | Invio email con template DB |
| `cron-rientro-sim` | scheduled | Notifica giornaliera rientro SIM |

## Setup locale

```bash
npm install
npx netlify dev   # serve frontend + functions su http://localhost:8888
```

Per le functions in locale servono le env vars (vedi sotto). Mettile in un file `.env` nella root o passale a `netlify dev`.

## Deploy Netlify

1. Collega il repo su Netlify
2. Le build settings vengono lette da `netlify.toml` (base directory vuota se il contenuto sta in root del repo)
3. Imposta le env vars nel pannello Netlify (sezione Site settings → Environment variables)
4. Deploy automatico al push

## Workflow di aggiornamento

Il repo è sincronizzato con GitHub via `git` (chiave SSH già configurata). Per ogni modifica:

```bash
git add -A
git commit -m "Descrizione modifica"
git push origin main
```

**Non caricare più file tramite l'interfaccia web GitHub** (`Add files via upload`): si creerebbe drift fra locale e remoto, esattamente il problema che abbiamo risolto in fase di setup. Se proprio serve modificare qualcosa al volo dalla web UI, sincronizza poi qui con `git pull` prima di riprendere a lavorare in locale.

## Env vars Netlify

| Variabile | Obbligatoria | Note |
|---|---|---|
| `SUPABASE_URL` | sì | `https://lbgwamhjkjjfwgusafbi.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | sì | Service role key (NON la anon/publishable — solo lato server) |
| `ANTHROPIC_API_KEY` | sì | Chiave Claude API per la function `ocr-pda` (estrazione AI dati dal PDA) |
| `SMTP_USER` | sì | Account Gmail mittente |
| `SMTP_PASS` | sì | App Password Gmail |
| `NOTIFICA_RIENTRO_TO` | no | Default `info@konatech.it` |
| `PUBLIC_BASE_URL` | no | Base URL del sito per i link nelle mail |
| `MAIL_FROM_NAME` | no | Default `Mirox CRM` |

## Modulo Call Center (integrato, Fase 1)

A partire dal 2026-06-20 il progetto Call Center — fino a quel momento deployato a parte su `mirox-crm.netlify.app` — è integrato dentro Mirox Completo in `moduli/call-center/`. L'integrazione è **additiva**: il deploy CC esistente continua a funzionare invariato (entrambi puntano allo stesso project Supabase `lbgwamhjkjjfwgusafbi`).

### Cosa c'è in `moduli/call-center/`

12 pagine portate dal CC + i loro asset (`js/`, `css/`, `assets/`):

- `registra-chiamata.html` (cuore CC: cerca CF/PIVA → registra esito)
- `elenco-chiamate.html`, `rilavorazione.html` (rilettura via viste unificate `vw_elenco_chiamate_unificate` / `vw_rilavorazione_ricontatti_unificata`)
- `appuntamenti.html`, `appuntamenti-oggi.html`, `prenota-interno.html`, `esiti-appuntamenti.html` (gestione appuntamenti)
- `blacklist.html` (clienti da non contattare)
- `call-center-lead-outbound.html`, `prenota-interno-outbound.html`, `registra-chiamata-outbound.html` (flusso outbound business)
- `configurazione.html` (admin: utenti, orari, blocchi, parametri)
- `prenota.html` (form pubblico per prenotazioni da sito/social — **non in dashboard**, raggiungibile solo via URL diretto)

### Adattamenti applicati nel port

Le pagine sono state copiate **mantenendo la loro logica interna** (testata in produzione da mesi). Modifiche fatte solo:

- Redirect login: `window.location.href='index.html'` → `'../../index.html'` (nelle pagine HTML e in `js/auth.js`, `js/call-center-lead-outbound.js`, `js/prenota-interno-outbound.js`, `js/registra-chiamata-outbound.js`)
- Aggiunto breadcrumb "← Torna alla dashboard Mirox" in cima a ogni pagina (eccetto `prenota.html` pubblica)
- Rimosso `index.html` del CC (Mirox ha già il proprio login)
- Sidebar CC laterale **mantenuta** dentro il modulo: è la navigazione nativa fra pagine CC. Il bottone "Esci" della sidebar usa il logout Mirox via `Auth.logout()` → `../../index.html`

### Accesso dalla dashboard Mirox

- **Solo bottone topbar** "Call Center" (la dashboard ha solo tab Vendita / Post-Vendita; il CC non ha tab/card dedicate, la sua sidebar interna è già la navigazione)
- Al login, il JS calcola la prima pagina CC accessibile in `profilo.pagine_accessibili` e imposta l'`href` del bottone topbar a quell'URL. Se l'utente non ha nessun permesso CC (e non è admin), il bottone resta `disabled`
- Chiavi permessi riutilizzate identiche al CC prod: `registra_chiamata`, `elenco_chiamate`, `rilavorazione`, `call_center_lead_outbound`, `appuntamenti`, `prenota_interno`, `appuntamenti_oggi`, `esiti_appuntamenti`, `blacklist`, `configurazione` (admin-only)
- Dentro ogni pagina CC: bottone arancione "← Torna alla dashboard Mirox" in cima

### Regole di coordinamento col CC prod (NON NEGOZIABILI)

Il CC prod su `mirox-crm.netlify.app` legge le stesse tabelle. Per non romperlo:

1. **Solo modifiche DB additive** — mai DROP/RENAME colonne, mai CHECK più stretti, mai modificare RPC esistenti (solo aggiungerne di nuove)
2. **RLS nuove devono includere anche i path vecchi** (es. `crm_can_access_page('registra_chiamata') OR crm_can_access_page('cc_registra_chiamata')`) — usare le chiavi esistenti senza prefisso (deciso così nella sessione di Fase 1)
3. Tutte le modifiche allo schema vanno discusse con l'utente prima di applicarle

### Fasi 2 e 3 — applicate nella stessa sessione

- **Fase 2** (eseguita): vista `storico_cliente` estesa con 4 UNION nuove (`chiamata_cc`, `chiamata_cc_outbound`, `appuntamento_cc`, `blacklist`). Migration: `database/024_storico_cliente_extend_call_center.sql`. Il modulo `storico_cliente.html` ora mostra anche chiamate, appuntamenti e blacklist (totali aggiunti: 2.351 chiamate, 249 appuntamenti, 91 blacklist)
- **Fase 3** (eseguita): backfill `chiamate.anagrafica_id` su 872 record orfani (ora 100% popolato) + backfill `appuntamenti.anagrafica_id` (99.2%) + trigger `BEFORE INSERT` su entrambe le tabelle per auto-popolare il FK quando manca. Migration: `database/025_chiamate_appuntamenti_anagrafica_autolink.sql`. Il CC prod continua a funzionare invariato (passa NULL sull'INSERT, il trigger lo riempie)

### Fase 4 — applicata (+ 4.1 rilassamento e auto-chiusura)

- **Fase 4** (eseguita): convergenza Upload Contratti con il Call Center
  - Nuova RPC `vendita_deriva_origine(p_anagrafica_id uuid)` ritorna jsonb `{origine_pratica, evento_tipo, evento_id, descrizione}`. Migration `026` (versione iniziale)
  - Wizard `upload-contratti-vendita.html`: dopo lookup anagrafica, chiama la RPC, pre-compila il dropdown `origine_pratica` e mostra un banner azzurro con la descrizione del match. L'operatore può overridare il valore: popup di conferma per evitare scollegamenti accidentali. Dropdown ora ha label umane
  - Bottone "💼 Inizia vendita" in `appuntamenti-oggi.html` accanto al badge "Presentato": click → sessionStorage `mirox_vendita_da_cc` + redirect al wizard
- **Fase 4.1** (eseguita): rilassamento RPC + auto-chiusura eventi CC. Migration `027`
  - RPC livello 1 ora copre anche appuntamenti FUTURI confermati fino a 30 giorni (cliente che arriva in anticipo)
  - RPC livello 2 rilassato: include chiamate `passa_in_negozio`/`passa_a_cerea` anche con `passaggio_stato='in_attesa'` (non solo `'passato'`)
  - **Trigger `trg_vendita_pratica_auto_chiudi_cc`** su `vendita_pratiche AFTER INSERT`: quando si crea una nuova pratica per anagrafica, gli appuntamenti futuri non gestiti della stessa anagrafica vengono `annullati` automaticamente e le chiamate in rilavorazione vengono `completate/chiuse`. Così il cliente sparisce dalle code CC senza rischio di essere ricontattato dopo aver già firmato
  - Wizard al submit valorizza `vendita_pratiche.appuntamento_id` / `chiamata_id` con l'evento auto-rilevato (FK esistenti da schema legacy ora riempite)

### Fasi successive previste

- **Fase 5** (debito tecnico): refactor profondo pagine CC a `MiroxUI.*` / `AnagraficaHelper.cercaOcrea` (rimuovere `Utils.toast`, `alert/confirm` nativi, `db.from('anagrafica').insert(...)` diretto)
- **Estensioni Fase 4**: bottoni "Inizia vendita" anche in `registra-chiamata.html` (dopo passa-in-negozio), `esiti-appuntamenti.html` (prima di esitare), `rilavorazione.html` (tab Passa Negozio/Cerea) — da fare on-demand quando si ha bisogno

## Schedulazioni

- `cron-rientro-sim`: ogni giorno alle **07:00 UTC** (09:00 ora italiana estate / 08:00 inverno). Cerca pratiche `vendita_switch_sim` con `giorno_rientro = oggi` e `mail_rientro_inviata_at IS NULL`, invia notifica via template `rientro_sim`, imposta `mail_rientro_inviata_at = now()`.

## Link utili

- Dashboard Supabase: <https://supabase.com/dashboard/project/lbgwamhjkjjfwgusafbi>
- Mappa completa progetto (per AI e per chi vuole dettagli): [`CLAUDE.md`](CLAUDE.md)
- Stato file SQL nella cartella `database/`: [`database/README.md`](database/README.md)

## Note

- Le credenziali pubbliche (URL Supabase + publishable key) vivono in `js/config.js` come unica sorgente di verità
- L'autenticazione passa per `profili.attivo`: utenti disattivati non entrano
- Esiste un secondo progetto **Call Center** non incluso in questo repo che condivide lo stesso database Supabase. Vedi `CLAUDE.md` per i boundaries delle tabelle condivise.

## Manutenzione

Ogni modifica al progetto deve essere riflessa in `README.md`, `CLAUDE.md` e `database/README.md` **nella stessa sessione/PR** in cui avviene la modifica. Niente "lo aggiorno dopo" — è così che `README_UNIFICATO.txt` (il file che questo README ha sostituito) era diventato obsoleto.

Vedi la sezione "Manutenzione di questa guida" in [`CLAUDE.md`](CLAUDE.md) per la **tabella completa dei trigger** (cosa aggiornare quando cambia cosa) e il self-check di fine task.
