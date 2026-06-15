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
| `dashboard.html` | Home con tabs Vendita / Post-Vendita + badge ticket aperti |
| `admin-vendita-config.html` | CRUD cataloghi (categorie, offerte, opzioni, reload, regole documenti) |
| `moduli/` | 12 pagine funzionali (`apri_chiudi`, `switch_sim`, `ordini_smartphone`, `dispositivi_comodato`, `gestione_rimborsi`, `segnalazioni`, `simulatore_protecta`, `storico_cliente`, `ticket`, `verifica_contratti`, `dashboard_pezzi`, `upload-contratti-vendita`) |
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
| `crea-vendita-pratica-carrello` | POST | Crea pratica + N contratti con validazioni |
| `upload-vendita-documento` | POST multipart | Upload PDF su bucket `contratti-vendita` |
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

## Env vars Netlify

| Variabile | Obbligatoria | Note |
|---|---|---|
| `SUPABASE_URL` | sì | `https://lbgwamhjkjjfwgusafbi.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | sì | Service role key (NON la anon/publishable — solo lato server) |
| `SMTP_USER` | sì | Account Gmail mittente |
| `SMTP_PASS` | sì | App Password Gmail |
| `NOTIFICA_RIENTRO_TO` | no | Default `info@konatech.it` |
| `PUBLIC_BASE_URL` | no | Base URL del sito per i link nelle mail |
| `MAIL_FROM_NAME` | no | Default `Mirox CRM` |

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
