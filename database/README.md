# /database/ — Migrazioni SQL storiche

I 14 file `.sql` in questa cartella sono **migrazioni storiche parziali** applicate manualmente nel SQL Editor di Supabase durante lo sviluppo iniziale.

## ⚠️ NON sono lo stato attuale del DB

Lo schema reale di Supabase contiene anche modifiche fatte:
- Direttamente dalla dashboard (creazione tabelle, colonne aggiuntive, indici)
- Tramite SQL Editor senza salvare il file qui
- Cambiamenti a RLS, RPC, trigger, viste applicati a caldo

**Per lo stato attuale, NON fare affidamento su questi file.** Interrogare direttamente Supabase con query di introspezione su `information_schema` e `pg_*` (vedi anche `../CLAUDE.md`).

## Elenco file

| File | Cosa introduce |
|---|---|
| `001_create_vendita_upload_contratti.sql` | Tabelle base upload contratti vendita |
| `002_cataloghi_opzioni_reload_e_associazioni_offerta.sql` | Opzioni, reload e link N:M con offerte |
| `003_offerte_abilita_dispositivo.sql` | Flag `abilita_dispositivo` su `vendita_offerte` |
| `004_offerte_abilita_switch_sim.sql` | Flag `abilita_switch_sim` su `vendita_offerte` |
| `005_moduli_vendita_post_vendita.sql` | Tabelle moduli operativi (`vendita_apri_chiudi`, `vendita_switch_sim`, `vendita_ordini_smartphone`, `post_vendita_dispositivi_comodato`, `post_vendita_gestione_rimborsi`) |
| `006_ticket.sql` | Sistema ticket |
| `007_anagrafica_unificata.sql` | Unificazione anagrafica + RPC `cerca_o_crea_anagrafica` |
| `008_ordini_smartphone_stati.sql` | CHECK constraint stati ordine smartphone |
| `009_bucket_moduli_template.sql` | Bucket `moduli-template` + policy |
| `010_switch_sim_mail_rientro.sql` | Colonna `mail_rientro_inviata_at` per cron giornaliero |
| `011_email_centro.sql` | `email_template` + `email_log` |
| `012_contratti_extra_fields.sql` | `pod_pdr`, `numero_contratto_energia`, `prezzo_fisso`, `reload_exchange` su `vendita_contratti` |
| `013_storico_cliente_vendita_contratti.sql` | Vista `storico_cliente` |
| `014_dashboard_pezzi_giornaliera.sql` | Viste `view_vendita_dashboard_giornaliera` e `_mensile` |
| `015_anagrafica_email_e_pda_doc_rules.sql` | Aggiunge `anagrafica.email`, aggiorna RPC `cerca_o_crea_anagrafica` con `p_email`, disattiva regole `contratto` per Energia/Allarmi/Assicurazioni (refactor wizard PDA-first) |
| `016_vendita_contratti_tipo_firma.sql` | Aggiunge `vendita_contratti.tipo_firma` ('elettronica'/'cartacea'/NULL) per il nuovo step Firma del wizard |
| `017_vendita_contratti_convergenza.sql` | Aggiunge `vendita_contratti.convergenza` (text + CHECK su 7 valori) per i contratti Fisso |

## Linee guida

- **Non aggiungere nuove migrazioni** senza coordinarle con l'utente
- Per nuove modifiche schema: applicare via SQL Editor Supabase E aggiungere il file qui con prefisso numerico progressivo (`015_`, `016_`, ...)
- Le **RLS policies**, **RPC** e **trigger** possono evolvere senza file associato qui: per uno snapshot affidabile esportare via dashboard Supabase o via query di introspezione
- Quando si aggiunge un nuovo file `.sql` in questa cartella, **aggiornare contestualmente la tabella "Elenco file"** sopra (regola di manutenzione documentale — vedi sezione "Manutenzione di questa guida" in `../CLAUDE.md`)
