PATCH KONA HUB - STORAGE DOCUMENTI VENDITA

Contenuto:
- netlify/functions/upload-vendita-documento.js
- js/vendita-storage-helper.js
- package.json

Come usarlo:
1. Apri la root del progetto Netlify/CRM.
2. Copia la cartella netlify dentro la root del progetto.
3. Copia il file js/vendita-storage-helper.js dentro la cartella js del progetto.
4. Se il progetto NON ha già package.json, copia anche package.json nella root.
5. Se il progetto HA già package.json, NON sovrascriverlo: aggiungi soltanto queste dipendenze:
   "@supabase/supabase-js": "^2.49.8",
   "busboy": "^1.6.0"
6. Su Netlify configura le variabili ambiente:
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
7. Esegui npm install e poi fai deploy.

Nota importante:
Per ora NON collegare vendita-storage-helper.js a upload_contratti.html.
Questa patch prepara solo la funzione server per caricare PDF nel bucket privato contratti-vendita.
