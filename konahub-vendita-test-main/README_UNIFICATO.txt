KonaHub Vendita Test - pacchetto unificato

Questo pacchetto unisce:
- la cartella test Netlify già funzionante
- le nuove funzioni create per configurazione vendita e creazione pratica/contratto
- la funzione upload documento con correzione del path Storage senza cartella /file/

Struttura corretta:
- index.html
- test-upload.html
- test-crea-contratto.html
- package.json
- js/vendita-storage-helper.js
- netlify/functions/upload-vendita-documento.js
- netlify/functions/vendita-config.js
- netlify/functions/crea-vendita-pratica-contratto.js
- database/001_create_vendita_upload_contratti.sql

Su Netlify devono esistere le variabili ambiente:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

Base directory su Netlify:
Se carichi il contenuto di questa cartella direttamente nella root del repository, lascia Base directory vuota.
Se carichi la cartella intera konahub-vendita-test-unificato, imposta Base directory: konahub-vendita-test-unificato

Pagine da testare:
- /test-upload.html
- /test-crea-contratto.html
