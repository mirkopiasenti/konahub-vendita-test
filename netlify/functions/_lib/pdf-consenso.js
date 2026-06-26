/**
 * Generatore PDF informativa privacy GDPR per Mirox.
 *
 * Produce un documento A4 con:
 *  - Intestazione + titolare del trattamento (Kona Tech S.r.l.)
 *  - Sezioni informativa GDPR art. 13 (finalita', base giuridica, conservazione,
 *    diritti dell'interessato, reclamo Garante, ecc.)
 *  - Dati dell'interessato (ragione sociale, CF/PIVA, indirizzo, contatti)
 *  - Checkbox consensi (informativa obbligatoria + marketing opzionale)
 *  - Box firma:
 *      * modalita='otp_sms': metadata trascritti (numero, timestamp, hash,
 *        sms_id, IP operatore)
 *      * modalita='cartaceo': riquadro vuoto da firmare a mano
 *  - Footer con versione informativa + hash documento
 *
 * Uso:
 *   const { generateConsensoPdf, INFORMATIVA_VERSIONE } = require('./_lib/pdf-consenso');
 *   const buffer = await generateConsensoPdf({
 *     modalita: 'otp_sms',
 *     anagrafica: { ragione_sociale, cf_piva, cluster, indirizzo, email, cellulare },
 *     consensoMarketing: true,
 *     consensoContratto: true,
 *     otpMetadata: {           // solo per modalita='otp_sms'
 *       cellulareInviato: '+39...',
 *       confermatoAt: '2026-06-25T18:32:11+02:00',
 *       smsProviderId: 'sms_abc123',
 *       ipOperatore: '93.xx.xx.xx',
 *       operatoreNome: 'Mario Rossi',
 *       consensoId: 'uuid'
 *     },
 *     dataCompilazione: '2026-06-25T18:32:11+02:00'  // ISO; default now
 *   });
 *
 * Ritorna: Buffer del PDF.
 */

const PDFDocument = require('pdfkit');
const crypto = require('crypto');

// Versione corrente del testo dell'informativa. Cambiare quando si modifica
// il testo legale: ogni consenso salvato traccia la versione vista.
const INFORMATIVA_VERSIONE = 'v1_2026_06_25';

// Dati Titolare hardcoded (Kona Tech S.r.l.)
const TITOLARE = {
    ragioneSociale: 'KONA TECH S.r.l.',
    piva: '05146970230',
    sedeLegale: 'Via Dossi, 7 - 37058 Sanguinetto (VR) - Italia',
    emailContatto: 'info@konatech.it',
    pec: 'konatechsrl@pec.it',
    dpoNome: 'Mirko Piasenti',
    dpoEmail: 'info@konatech.it'
};

// Palette
const COL_PRIMARY = '#FF6600';
const COL_TEXT = '#0f172a';
const COL_MUTED = '#64748b';
const COL_BORDER = '#cbd5e1';
const COL_GREEN = '#16a34a';
const COL_RED = '#b91c1c';

function safeText(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    return String(value).trim() || fallback;
}

function formatItalianDateTime(isoOrDate) {
    let d;
    if (!isoOrDate) d = new Date();
    else if (isoOrDate instanceof Date) d = isoOrDate;
    else d = new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    // Europe/Rome rendering via Intl
    const fmt = new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = fmt.formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatItalianDate(isoOrDate) {
    let d;
    if (!isoOrDate) d = new Date();
    else if (isoOrDate instanceof Date) d = isoOrDate;
    else d = new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) d = new Date();
    const fmt = new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome',
        year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const parts = fmt.formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return `${parts.day}/${parts.month}/${parts.year}`;
}

function buildIndirizzo(a) {
    const parts = [];
    if (a.via) parts.push(a.via);
    if (a.civico) parts.push(a.civico);
    let line1 = parts.join(' ').trim();
    const line2parts = [];
    if (a.comune) line2parts.push(a.comune);
    if (a.provincia) line2parts.push(`(${a.provincia})`);
    let line2 = line2parts.join(' ').trim();
    const composed = [line1, line2].filter(Boolean).join(', ');
    return composed || '-';
}

/**
 * Disegna un checkbox riempito (verde) o vuoto (rosso) accanto al testo.
 */
function drawCheckRow(doc, x, y, checked, labelText, options = {}) {
    const size = 11;
    doc.save();
    doc.lineWidth(1).strokeColor(checked ? COL_GREEN : COL_RED);
    doc.rect(x, y, size, size).stroke();
    if (checked) {
        doc.fillColor(COL_GREEN);
        doc.moveTo(x + 2, y + 6).lineTo(x + 4.5, y + 8.5).lineTo(x + 9, y + 3).stroke(COL_GREEN);
    }
    doc.restore();
    doc.fillColor(COL_TEXT).font('Helvetica').fontSize(9.5);
    const labelX = x + size + 6;
    const labelWidth = options.width || (doc.page.width - doc.page.margins.right - labelX);
    doc.text(labelText, labelX, y - 1, { width: labelWidth, lineGap: 1 });
}

function drawSectionTitle(doc, text) {
    doc.moveDown(0.3);
    doc.fillColor(COL_PRIMARY).font('Helvetica-Bold').fontSize(11);
    doc.text(text, { align: 'left' });
    doc.moveDown(0.15);
    doc.fillColor(COL_TEXT).font('Helvetica').fontSize(9.5);
}

function drawParagraph(doc, text) {
    doc.fillColor(COL_TEXT).font('Helvetica').fontSize(9.5);
    doc.text(text, { align: 'justify', lineGap: 1.5 });
    doc.moveDown(0.3);
}

function drawBulletList(doc, items) {
    doc.fillColor(COL_TEXT).font('Helvetica').fontSize(9.5);
    items.forEach((it) => {
        doc.text(`• ${it}`, { indent: 8, align: 'left', lineGap: 1.5 });
    });
    doc.moveDown(0.2);
}

function drawHeader(doc) {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    doc.rect(left, 30, right - left, 50).fillAndStroke('#FFF7ED', COL_BORDER);
    doc.fillColor(COL_PRIMARY).font('Helvetica-Bold').fontSize(16);
    doc.text('Informativa privacy e raccolta consenso', left + 12, 42, { width: right - left - 24 });
    doc.fillColor(COL_MUTED).font('Helvetica').fontSize(8.5);
    doc.text('Titolare: ' + TITOLARE.ragioneSociale + ' — P.IVA ' + TITOLARE.piva, left + 12, 62);
    doc.fillColor(COL_TEXT);
    // Reset cursor below header
    doc.y = 95;
    doc.x = left;
}

function drawFooter(doc, opts) {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const yBase = doc.page.height - 40;
    doc.lineWidth(0.5).strokeColor(COL_BORDER).moveTo(left, yBase - 6).lineTo(right, yBase - 6).stroke();
    doc.fillColor(COL_MUTED).font('Helvetica').fontSize(7.5);
    const v = `Versione informativa: ${opts.informativaVersione}`;
    const h = opts.documentoHash ? `Hash documento (SHA256): ${opts.documentoHash.slice(0, 32)}…` : '';
    doc.text(v, left, yBase, { width: right - left, align: 'left' });
    if (h) doc.text(h, left, yBase + 9, { width: right - left, align: 'left' });
    doc.text('Pagina ' + (doc.page.number || 1), left, yBase, { width: right - left, align: 'right' });
}

/**
 * Genera il PDF e ritorna { buffer, hash } dove hash e' SHA256 del PDF.
 */
async function generateConsensoPdf(opts) {
    const modalita = opts.modalita === 'cartaceo' ? 'cartaceo' : 'otp_sms';
    const a = opts.anagrafica || {};
    const consensoContratto = opts.consensoContratto !== false;
    const consensoMarketing = !!opts.consensoMarketing;
    const dataCompilazione = opts.dataCompilazione || new Date().toISOString();
    const otpMd = opts.otpMetadata || {};
    const informativaVersione = INFORMATIVA_VERSIONE;

    return new Promise((resolve, reject) => {
        try {
            const chunks = [];
            const doc = new PDFDocument({
                size: 'A4',
                margins: { top: 95, right: 50, bottom: 60, left: 50 },
                info: {
                    Title: `Informativa privacy ${safeText(a.ragione_sociale, 'cliente')}`,
                    Author: TITOLARE.ragioneSociale,
                    Subject: 'Informativa GDPR e raccolta consenso al trattamento',
                    Keywords: 'GDPR, privacy, consenso, ' + safeText(a.cf_piva)
                }
            });

            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const hash = crypto.createHash('sha256').update(buffer).digest('hex');
                resolve({ buffer, hash });
            });
            doc.on('error', reject);

            // Header su ogni pagina
            drawHeader(doc);
            doc.on('pageAdded', () => drawHeader(doc));

            // -------- Intestazione titolare --------
            drawSectionTitle(doc, '1. Titolare del trattamento');
            drawParagraph(doc,
                `Il titolare del trattamento dei dati personali raccolti tramite il presente modulo è ${TITOLARE.ragioneSociale}, ` +
                `con sede legale in ${TITOLARE.sedeLegale}, P.IVA ${TITOLARE.piva}.`);
            drawParagraph(doc,
                `Recapiti per esercitare i propri diritti o ricevere chiarimenti sul trattamento dei dati: ` +
                `email ${TITOLARE.emailContatto} - PEC ${TITOLARE.pec}.`);
            drawParagraph(doc,
                `Responsabile della Protezione dei Dati (DPO): ${TITOLARE.dpoNome}, contattabile all'indirizzo ${TITOLARE.dpoEmail}.`);

            // -------- Dati raccolti --------
            drawSectionTitle(doc, '2. Categorie di dati personali trattati');
            drawParagraph(doc, 'Il Titolare tratta le seguenti categorie di dati personali dell\'interessato:');
            drawBulletList(doc, [
                'dati anagrafici e identificativi (nome, cognome / ragione sociale, codice fiscale o partita IVA, data di nascita ove applicabile);',
                'dati di contatto (indirizzo di residenza/sede, numero di telefono cellulare, indirizzo email);',
                'copia del documento d\'identità in corso di validità (necessaria per gli adempimenti KYC degli operatori di telecomunicazioni);',
                'dati relativi al contratto di fornitura di servizi di telecomunicazioni e/o ai servizi accessori (offerta sottoscritta, IMEI dispositivo eventualmente acquistato, dati di portabilità);',
                'eventuali dati di contatto pregressi e storico delle interazioni con il servizio clienti.'
            ]);

            // -------- Finalita' --------
            drawSectionTitle(doc, '3. Finalità del trattamento e base giuridica');
            drawParagraph(doc, 'I dati personali sono trattati per le finalità di seguito indicate:');
            drawBulletList(doc, [
                'a) gestione del rapporto contrattuale di rivendita (raccolta della proposta di adesione PDA, archiviazione del contratto, trasmissione al gestore di telecomunicazioni o al partner di riferimento) - base giuridica: esecuzione di un contratto di cui l\'interessato è parte ex art. 6, par. 1, lett. b) GDPR;',
                'b) adempimento degli obblighi di legge in materia di KYC (Know Your Customer) e di anti-frode previsti dalla normativa di settore per gli operatori di telecomunicazioni - base giuridica: obbligo legale ex art. 6, par. 1, lett. c) GDPR;',
                'c) gestione dell\'assistenza post-vendita e ricontatto dell\'interessato per finalità tecniche connesse al contratto (verifica documentazione, attivazione, anomalie, supporto) - base giuridica: legittimo interesse del Titolare ex art. 6, par. 1, lett. f) GDPR;',
                'd) invio di comunicazioni commerciali via SMS, email o chiamata telefonica relative a nuove offerte e promozioni di prodotti e servizi commercializzati dal Titolare - base giuridica: consenso specifico dell\'interessato ex art. 6, par. 1, lett. a) GDPR (consenso opzionale, separato, sempre revocabile).'
            ]);

            // -------- Modalita' --------
            drawSectionTitle(doc, '4. Modalità del trattamento');
            drawParagraph(doc,
                'I dati sono trattati con strumenti elettronici tramite il sistema gestionale interno del Titolare (CRM Mirox) e custoditi su infrastruttura cloud con cifratura at-rest e in-transit. L\'accesso ai dati è riservato al personale autorizzato del Titolare, formalmente nominato incaricato del trattamento e vincolato al segreto professionale. Il trattamento è effettuato adottando le misure di sicurezza tecniche e organizzative adeguate ai sensi dell\'art. 32 GDPR.');

            // -------- Comunicazione a terzi --------
            drawSectionTitle(doc, '5. Comunicazione e destinatari dei dati');
            drawParagraph(doc,
                'I dati personali possono essere comunicati ai seguenti soggetti: (i) operatori di telecomunicazioni e partner commerciali presso cui sono attivati i contratti sottoscritti (a titolo esemplificativo: WindTre, Engie, Verisure), nei limiti strettamente necessari all\'erogazione del servizio richiesto; (ii) consulenti, professionisti e fornitori di servizi tecnici (commercialista, fornitori cloud, gestori dei sistemi informatici) nominati Responsabili del trattamento ex art. 28 GDPR; (iii) autorità competenti in caso di richieste formali ai sensi di legge.');
            drawParagraph(doc, 'I dati non sono diffusi e non sono oggetto di trasferimento verso paesi extra-UE.');

            // -------- Conservazione --------
            drawSectionTitle(doc, '6. Periodo di conservazione');
            drawBulletList(doc, [
                'dati relativi al contratto e copia del documento d\'identità: 10 anni dalla cessazione del rapporto contrattuale, in conformità agli obblighi di conservazione previsti dalla normativa fiscale e di settore (artt. 2214-2220 c.c. e D.P.R. 633/1972);',
                'dati trattati per finalità di marketing diretto (di cui al punto 3.d): 24 mesi dalla raccolta del consenso, salvo rinnovo espresso da parte dell\'interessato;',
                'log tecnici, registri di accesso e copia del presente modulo di consenso: per il tempo necessario all\'esercizio dei diritti del Titolare in eventuale contenzioso, e comunque non oltre 10 anni.'
            ]);

            // -------- Diritti --------
            drawSectionTitle(doc, '7. Diritti dell\'interessato');
            drawParagraph(doc,
                'L\'interessato può esercitare in ogni momento, scrivendo ai recapiti indicati al punto 1, i diritti riconosciuti dagli artt. 15-22 del GDPR:');
            drawBulletList(doc, [
                'diritto di accesso ai propri dati personali (art. 15);',
                'diritto di rettifica dei dati inesatti (art. 16);',
                'diritto alla cancellazione dei dati ("diritto all\'oblio", art. 17), nei limiti consentiti dagli obblighi di conservazione;',
                'diritto alla limitazione del trattamento (art. 18);',
                'diritto alla portabilità dei dati (art. 20);',
                'diritto di opposizione al trattamento per finalità di marketing (art. 21);',
                'diritto di revocare in qualsiasi momento il consenso prestato per le finalità di cui al punto 3.d, senza pregiudicare la liceità del trattamento effettuato prima della revoca.'
            ]);
            drawParagraph(doc,
                'L\'interessato ha inoltre diritto di proporre reclamo al Garante per la Protezione dei Dati Personali (www.garanteprivacy.it) qualora ritenga che il trattamento dei propri dati personali avvenga in violazione della normativa applicabile.');

            // -------- Natura conferimento --------
            drawSectionTitle(doc, '8. Natura del conferimento dei dati');
            drawParagraph(doc,
                'Il conferimento dei dati per le finalità di cui ai punti 3.a, 3.b e 3.c è necessario per dare esecuzione al contratto e adempiere agli obblighi di legge: l\'eventuale rifiuto comporta l\'impossibilità di sottoscrivere il contratto. Il conferimento dei dati per la finalità di marketing (punto 3.d) è invece facoltativo: l\'eventuale rifiuto non pregiudica la sottoscrizione del contratto.');

            // -------- Dati interessato --------
            doc.addPage();
            drawSectionTitle(doc, '9. Dati dell\'interessato');
            const isBusiness = String(a.cluster || '').toLowerCase() === 'business';
            const labelCfPiva = isBusiness ? 'Partita IVA' : 'Codice fiscale';
            const labelRagSoc = isBusiness ? 'Ragione sociale' : 'Nome e cognome';

            const dataRows = [
                [labelRagSoc, safeText(a.ragione_sociale)],
                [labelCfPiva, safeText(a.cf_piva)],
                ['Tipologia cliente', safeText(a.cluster)],
                ['Persona di riferimento', safeText(a.nome_referente)],
                ['Indirizzo', buildIndirizzo(a)],
                ['Cellulare', safeText(a.cellulare)],
                ['Email', safeText(a.email)],
                ['Data raccolta consenso', formatItalianDate(dataCompilazione)]
            ];
            const left = doc.page.margins.left;
            const right = doc.page.width - doc.page.margins.right;
            const colLabelW = 160;
            let rowY = doc.y;
            doc.fontSize(9.5);
            dataRows.forEach(([k, v]) => {
                doc.lineWidth(0.5).strokeColor(COL_BORDER);
                doc.rect(left, rowY, colLabelW, 22).stroke();
                doc.rect(left + colLabelW, rowY, right - left - colLabelW, 22).stroke();
                doc.fillColor(COL_MUTED).font('Helvetica-Bold').text(k, left + 6, rowY + 6, { width: colLabelW - 12 });
                doc.fillColor(COL_TEXT).font('Helvetica').text(v, left + colLabelW + 6, rowY + 6, { width: right - left - colLabelW - 12 });
                rowY += 22;
            });
            doc.y = rowY + 10;

            // -------- Consensi --------
            drawSectionTitle(doc, '10. Consensi prestati dall\'interessato');
            doc.fillColor(COL_TEXT).font('Helvetica').fontSize(9.5);

            let cy = doc.y + 2;
            drawCheckRow(doc, left, cy, consensoContratto,
                'Dichiaro di aver preso visione dell\'informativa di cui sopra ai sensi dell\'art. 13 GDPR e ' +
                'acconsento al trattamento dei miei dati personali per le finalità contrattuali, di adempimento ' +
                'degli obblighi di legge e di assistenza post-vendita (punti 3.a, 3.b, 3.c). ' +
                'CONSENSO OBBLIGATORIO ai fini della sottoscrizione del contratto.',
                { width: right - left - 22 });
            cy = doc.y + 12;
            doc.y = cy;

            drawCheckRow(doc, left, cy, consensoMarketing,
                'Acconsento al trattamento dei miei dati personali per finalità di marketing diretto (invio di ' +
                'comunicazioni commerciali via SMS, email o chiamata telefonica relative a nuove offerte e ' +
                'promozioni di prodotti e servizi del Titolare - punto 3.d). ' +
                'CONSENSO FACOLTATIVO, sempre revocabile.',
                { width: right - left - 22 });

            doc.y = doc.y + 18;

            // -------- Firma --------
            drawSectionTitle(doc, '11. Modalità di sottoscrizione e firma');

            if (modalita === 'otp_sms') {
                const firmaBoxY = doc.y;
                const firmaBoxH = 130;
                doc.lineWidth(1).strokeColor(COL_GREEN);
                doc.rect(left, firmaBoxY, right - left, firmaBoxH).stroke();
                doc.fillColor(COL_GREEN).font('Helvetica-Bold').fontSize(10);
                doc.text('Documento firmato elettronicamente tramite OTP via SMS', left + 12, firmaBoxY + 10, { width: right - left - 24 });
                doc.fillColor(COL_TEXT).font('Helvetica').fontSize(8.5);

                const metaY = firmaBoxY + 28;
                const linesL = [
                    'Cellulare destinatario OTP:  ' + safeText(otpMd.cellulareInviato, '-'),
                    'Data e ora conferma OTP:    ' + formatItalianDateTime(otpMd.confermatoAt),
                    'ID messaggio SMS:           ' + safeText(otpMd.smsProviderId, '-')
                ];
                const linesR = [
                    'Operatore Mirox:    ' + safeText(otpMd.operatoreNome, '-'),
                    'IP operatore:       ' + safeText(otpMd.ipOperatore, '-'),
                    'ID consenso:        ' + safeText(otpMd.consensoId, '-')
                ];
                let ly = metaY;
                linesL.forEach((t) => { doc.text(t, left + 12, ly, { width: (right - left) / 2 - 12 }); ly += 14; });
                ly = metaY;
                linesR.forEach((t) => { doc.text(t, left + (right - left) / 2 + 4, ly, { width: (right - left) / 2 - 12 }); ly += 14; });

                doc.fillColor(COL_MUTED).fontSize(8);
                doc.text(
                    'Ai sensi dell\'art. 20 del Regolamento (UE) n. 910/2014 (eIDAS) la presente firma elettronica ' +
                    'semplice, generata tramite invio di codice usa-e-getta al recapito telefonico dell\'interessato ' +
                    'e validata da operatore terzo identificato, costituisce evidenza informatica idonea a dimostrare ' +
                    'la manifestazione di consenso da parte dell\'interessato.',
                    left + 12, firmaBoxY + firmaBoxH - 38,
                    { width: right - left - 24, align: 'justify' });
                doc.y = firmaBoxY + firmaBoxH + 14;
            } else {
                // Cartaceo: riquadro vuoto + istruzioni
                doc.fillColor(COL_TEXT).font('Helvetica').fontSize(9.5);
                doc.text(
                    'Il presente modulo viene sottoscritto in forma cartacea. L\'interessato appone la propria firma ' +
                    'autografa nello spazio sottostante. Il documento firmato viene successivamente acquisito in formato ' +
                    'elettronico (scansione PDF) e archiviato nel sistema gestionale del Titolare.',
                    { align: 'justify', lineGap: 1.5 });
                doc.moveDown(0.5);

                const firmaBoxY = doc.y;
                const firmaBoxH = 110;
                doc.lineWidth(0.8).strokeColor(COL_BORDER);
                doc.rect(left, firmaBoxY, right - left, firmaBoxH).stroke();
                doc.fillColor(COL_MUTED).font('Helvetica').fontSize(8);
                doc.text('Firma leggibile dell\'interessato', left + 12, firmaBoxY + 8);
                doc.text('Luogo e data: ____________________________________', left + 12, firmaBoxY + firmaBoxH - 24);
                doc.y = firmaBoxY + firmaBoxH + 14;
            }

            // -------- Footer su tutte le pagine --------
            // Calcoliamo l'hash del documento "preliminare" basato sui dati invariati;
            // l'hash finale del PDF e' restituito a chi chiama (per salvarlo su DB).
            // Qui mettiamo solo la versione informativa.
            const range = doc.bufferedPageRange();
            for (let i = 0; i < range.count; i += 1) {
                doc.switchToPage(range.start + i);
                drawFooter(doc, { informativaVersione });
            }

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = {
    generateConsensoPdf,
    INFORMATIVA_VERSIONE,
    TITOLARE
};
