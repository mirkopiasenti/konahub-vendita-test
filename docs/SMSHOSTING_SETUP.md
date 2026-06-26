# Setup account Smshosting per consensi privacy OTP

Guida step-by-step per attivare l'account Smshosting e configurare l'invio degli SMS transactional (OTP) per la raccolta del consenso privacy nel wizard upload-contratti-vendita.

Il sistema consensi privacy (migration `034`) è già implementato lato codice. Per andare in produzione manca solo l'attivazione dell'account SMS provider e la configurazione di 3 env vars su Netlify.

---

## 1. Creazione account Smshosting (~10 min)

1. Vai su **<https://www.smshosting.it/>**
2. Clicca su **"Registrati"** in alto a destra
3. Inserisci i dati aziendali di **Kona Tech S.r.l.**:
   - Ragione sociale: `KONA TECH S.R.L.`
   - P.IVA: `05146970230`
   - Codice fiscale: `05146970230` (è lo stesso per le S.r.l.)
   - Email amministrativa: `info@konatech.it`
   - PEC: `konatechsrl@pec.it`
   - Telefono: il tuo cellulare per la verifica
4. Conferma email (clicca link nella mail di benvenuto)
5. Accesso al pannello: `https://www.smshosting.it/login`

---

## 2. Richiesta mittente alfanumerico (~1 giorno lavorativo)

> **Importante**: su Smshosting NON c'è una sezione "Verifica identità" separata. L'identità viene verificata contestualmente alla richiesta del mittente alfanumerico (es. `MIROX` o `KONATECH` al posto di un numero anonimo). Se cerchi "Verifica account" nel pannello non lo troverai — segui invece questa procedura.

### Modo veloce (consigliato): contatta direttamente il supporto

Smshosting risponde rapidamente. Chiama o scrivi:

- **Telefono**: `+39 0437 30419` (lun-ven 9:00-12:30 e 14:30-18:00)
- **Email**: `assistenza@smshosting.it`
- **Chat live**: icona fumetto in basso a destra nel pannello

Di':
> "Buongiorno, sono di **Kona Tech S.r.l.** (P.IVA `05146970230`), ho creato l'account oggi. Vorrei richiedere un **mittente alfanumerico `MIROX`** per l'invio di **SMS OTP transactional** (consensi privacy GDPR). Come procedo?"

Ti guidano nel form e ti dicono quali documenti caricare (di solito **visura camerale + carta d'identità del legale rappresentante**).

### Da pannello (se preferisci fare da solo)

Dalla dashboard Smshosting cerca una di queste voci nel menu (la UI può cambiare):

- **Impostazioni → Mittenti** (oppure "Sender ID")
- **Account → Mittenti personalizzati**
- Pulsante **"+ Aggiungi mittente"** o **"Richiedi nuovo mittente"**

Nel form di richiesta:

- **Mittente desiderato**: `MIROX` (max 11 caratteri, solo lettere maiuscole + numeri, no spazi)
- **Tipo**: Transactional / OTP (NON marketing)
- **Settore**: Telecomunicazioni / Rivendita servizi TLC
- Carica visura camerale + documento d'identità del legale rappresentante
- Smshosting risponde entro 24-48 ore lavorative con conferma o richiesta integrazioni

> **Puoi iniziare a testare il sistema senza aspettare l'approvazione del mittente**: imposta `SMSHOSTING_SIMULATE=true` su Netlify (vedi sezione 5). In quella modalità l'SMS non viene inviato realmente, ma il codice OTP viene loggato nei Real-time logs Netlify (cerca `[smshosting][SIMULATED]`) e puoi inserirlo nel modale per validare tutto il flusso (PDF, dedupe, salvataggio DB).

---

## 3. Acquisto credito SMS

Volume stimato a regime (300 contratti/mese → ~100 OTP/mese dopo dedupe 48 mesi): **€5-8/mese**.

Per iniziare:

1. Pannello → **"Acquista crediti"**
2. Scegli il pacchetto **Premium / Transactional** (consegna prioritaria, essenziale per OTP)
3. Consigliato per partire: **500 SMS** (~€20-25, dura circa 5-6 mesi)
4. Pagamento con carta o bonifico (fattura italiana automatica con i dati di Kona Tech)

---

## 4. Generazione credenziali API REST

1. Pannello → **"Impostazioni" → "Accesso API"** (o "API REST")
2. Clicca **"Crea nuovo accesso API"**
3. Nome accesso: `Mirox CRM Production`
4. Permessi richiesti: solo **`sms.send`** (invio SMS). NON dare permessi di lettura rubrica o di acquisto credito.
5. Smshosting genera due valori:
   - **API Key** (username) — es. `abc123def456`
   - **API Secret** (password) — es. `xyz789uvw012`
6. **Copia SUBITO il secret** in un posto sicuro (1Password, Bitwarden, ecc.). Smshosting lo mostra una sola volta: se lo perdi, devi rigenerare l'accesso.

---

## 5. Configurazione env vars su Netlify

1. Vai su <https://app.netlify.com/> → seleziona il sito Mirox
2. **Site settings → Environment variables → Add a variable**
3. Aggiungi questi 3 valori (o 4 con la simulazione):

| Variabile | Valore | Note |
|---|---|---|
| `SMSHOSTING_API_KEY` | (l'API Key dal pannello Smshosting) | Username Basic Auth |
| `SMSHOSTING_API_SECRET` | (l'API Secret) | Password Basic Auth — **non condividere via Slack/email** |
| `SMSHOSTING_SENDER` | `MIROX` | Mittente alfanumerico approvato. Default `MIROX` se omesso |
| `SMSHOSTING_SIMULATE` | `true` (solo in test) o omettere in prod | Quando `true`, le functions loggano l'SMS senza inviarlo davvero. Utile per testare il flusso senza spendere credito |

4. **Save** → Netlify chiede un redeploy: confermalo, le functions caricano le nuove variabili al primo invocation.

---

## 6. Test end-to-end

### 6.1 Test in modalità simulazione (gratis, no SMS reali)

1. Imposta `SMSHOSTING_SIMULATE=true` su Netlify
2. Trigger redeploy (push qualsiasi commit o "Trigger deploy" → "Deploy site")
3. Apri `moduli/upload-contratti-vendita.html`
4. Inserisci un cliente di test con tuo cellulare reale
5. Aggiungi un contratto al carrello, premi "Invia pratica"
6. Quando si apre il popup "OTP o cartaceo?", scegli OTP
7. Premi "Invia SMS" → vedrai nei log Netlify (Functions → richiedi-otp-privacy → Real-time logs) la riga `[smshosting][SIMULATED]` con il codice OTP in chiaro
8. Inserisci quel codice nei 6 box → "Verifica OTP" → conferma
9. La pratica viene creata normalmente. Il PDF generato è in `consensi-privacy/<YYYY>/<MM>/`

### 6.2 Test reale (1 SMS = ~€0.05)

1. **Rimuovi** `SMSHOSTING_SIMULATE` (o impostalo a `false`)
2. Redeploy
3. Stessa procedura: il cellulare riceve davvero l'SMS dal mittente `MIROX`
4. Verifica nel pannello Smshosting → **"Storico SMS"** che il messaggio risulti consegnato

### 6.3 Test del flusso cartaceo (no SMS, no credito)

1. Su upload-contratti: scegli "Modulo cartaceo" al popup
2. Clicca "Scarica modulo PDF" → ti scarica `Privacy_<RagSoc>_<CF>_<data>.pdf`
3. Apri il PDF: deve avere tutti i dati cliente + riquadro firma vuoto + 2 checkbox (la marketing dipende da come l'hai compilata)
4. Stampa, firma a mano (anche con scarabocchio per test), scansiona
5. Carica la scansione nella drop-zone → "Carica e conferma"
6. Il PDF viene salvato in `consensi-privacy/<YYYY>/<MM>/` con stesso naming. Il flusso non richiede credito SMS.

---

## 7. Monitoraggio post-go-live

### Pannello Smshosting

- **Storico SMS** (`/dashboard/storico`): vedi tutti gli invii, stato consegna, costo
- **Saldo credito** (`/dashboard/credito`): controlla periodicamente. Smshosting può mandare alert email a saldo basso (configurabile)
- **Report mensile**: esportabile in CSV/PDF per la contabilità

### Pannello Netlify

- **Functions → richiedi-otp-privacy → Real-time logs**: stream live degli invii
- Cerca `[smshosting]` per filtrare i log del provider
- In caso di errore, il log mostra `providerStatus` e `providerMessage` per debugging

### Tabella DB

- `vendita_consensi_privacy` ha campo `sms_provider_id` valorizzato con l'id Smshosting → cross-reference per audit
- Query utili:

```sql
-- Quanti consensi OTP confermati questo mese
SELECT count(*) FROM vendita_consensi_privacy
WHERE modalita='otp_sms'
  AND stato='confermato'
  AND otp_confermato_at >= date_trunc('month', now());

-- Quanti tentativi falliti (utile per spot abuse)
SELECT count(*) FROM vendita_consensi_privacy
WHERE stato='fallito'
  AND created_at >= date_trunc('month', now());

-- Tasso di successo OTP (confermati / inviati)
SELECT
  count(*) FILTER (WHERE stato='confermato') AS confermati,
  count(*) AS totali_inviati,
  round(100.0 * count(*) FILTER (WHERE stato='confermato') / count(*), 1) AS tasso_pct
FROM vendita_consensi_privacy
WHERE modalita='otp_sms'
  AND created_at >= now() - interval '30 days';
```

---

## 8. Costi attesi a regime

| Item | Costo |
|---|---|
| Account Smshosting | gratuito |
| Verifica account + mittente | gratuito |
| SMS Premium/Transactional | ~€0.045-0.055 per invio |
| Pacchetto 500 SMS (avvio) | ~€22 |
| Volume regime (anno 1) | ~€100/anno |
| Volume regime (anno 4 con dedupe 48 mesi a regime) | ~€55/anno |

**ROI**: il sistema consensi vale come prova legale in caso di reclamo Garante (sanzioni da €10k a €20M). €100/anno è una polizza assicurativa molto economica.

---

## 9. Troubleshooting

| Errore | Causa probabile | Fix |
|---|---|---|
| `Credenziali Smshosting mancanti (SMSHOSTING_API_KEY/SECRET non configurati)` | Env vars non settate o redeploy non fatto | Verifica Netlify env vars + trigger deploy |
| `HTTP 401 da Smshosting` | API Key/Secret sbagliati o scaduti | Rigenera credenziali nel pannello Smshosting |
| `HTTP 403 da Smshosting` | Mittente alfanumerico non approvato | Aspetta approvazione o usa numerico |
| `Credito insufficiente` | Saldo esaurito | Acquista altro credito + il sistema genera mail di errore al proprietario via MiroxErrorReporter |
| `Timeout chiamata Smshosting` | Smshosting lento o down | Riprovare. Se ricorrente verificare status su <https://www.smshosting.it/> |
| Cliente non riceve SMS | Numero formato sbagliato, oppure operatore mobile blocca | Verifica formato `+39XXXXXXXXXX` nel log. In caso di blocco lato cliente, usare il flusso cartaceo |
| OTP inserito ma "Codice errato" sempre | Il cliente sta dicendo un codice vecchio | Cliccare "Reinvia SMS" e usare il nuovo codice (il vecchio è invalidato automaticamente) |

---

## 10. Cosa fare prima del go-live

- [ ] Account Smshosting creato e verificato
- [ ] Mittente `MIROX` approvato da Smshosting (controlla email di conferma)
- [ ] Credenziali API generate e salvate in 1Password / vault sicuro
- [ ] Env vars su Netlify configurate (`SMSHOSTING_API_KEY`, `SMSHOSTING_API_SECRET`, `SMSHOSTING_SENDER`)
- [ ] `SMSHOSTING_SIMULATE` rimossa o impostata a `false`
- [ ] Test reale con cellulare proprio: invio + ricezione + verifica + conferma + PDF salvato
- [ ] Verificato che `vendita_consensi_privacy` ha il record con `stato='confermato'`
- [ ] Verificato che il bucket `consensi-privacy` ha il PDF con naming corretto
- [ ] **Testo informativa privacy** in `_lib/pdf-consenso.js` revisionato da legale Kona Tech
- [ ] Operatori formati sul nuovo flusso (modale OTP/cartaceo, popup "modifica numero")
- [ ] Saldo Smshosting iniziale acquistato (consigliato 500 SMS)

---

## Contatti

- Supporto Smshosting: `supporto@smshosting.it` o pannello → Chat live (lun-ven 9-18)
- Documentazione API ufficiale: <https://api.smshosting.it/docs> (se offline al momento, consultare Postman collection scaricabile dal pannello)
- DPO Kona Tech (per questioni GDPR): Mirko Piasenti — `info@konatech.it`
