/* ============================================================
   MIROX FOLDER NAME – Generatore unificato del nome cartella
   pratica per Storage Supabase.
   Formato:
     <SAN_OLD>_<SAN_NEW>_<GG_MM_AA>
   Esempio:
     AZIENDA_VECCHIA_SRL_AZIENDA_NUOVA_SRL_27_05_26
   Dove:
     - oldName e newName vengono sanitizzati (caratteri non
       validi rimossi, spazi -> _, accenti normalizzati).
     - se manca uno dei due lati, si usa solo il presente.
     - se entrambi mancano, si usa "PRATICA" come fallback.
     - date in input come Date | ISO string | undefined => oggi.
   Espone window.MiroxFolder.build(oldName, newName, date?)
   ============================================================ */
(function () {
    if (window.MiroxFolder) return;

    function pad2(n) { return String(n).padStart(2, '0'); }

    function formatDate(d) {
        const dt = d instanceof Date ? d : (d ? new Date(d) : new Date());
        if (isNaN(dt)) return formatDate(new Date());
        return `${pad2(dt.getDate())}_${pad2(dt.getMonth() + 1)}_${String(dt.getFullYear()).slice(-2)}`;
    }

    function sanitize(raw) {
        if (raw == null) return '';
        let s = String(raw).trim();
        if (!s) return '';
        // Normalizza accenti
        s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
        // Rimuove caratteri non validi per Storage e filesystem
        s = s.replace(/[\/\\:?*"<>|#%&{}+=`'@!^~]/g, '');
        // Sostituisce sequenze di spazi/punti/virgole con underscore
        s = s.replace(/[\s.,;]+/g, '_');
        // Collassa underscore multipli
        s = s.replace(/_+/g, '_');
        // Rimuove leading/trailing underscore
        s = s.replace(/^_+|_+$/g, '');
        return s.toUpperCase();
    }

    /**
     * Costruisce un nome cartella secondo le regole Mirox.
     * @param {string} oldName Ragione sociale vecchio intestatario
     * @param {string} newName Ragione sociale nuovo intestatario
     * @param {Date|string} [date] Data creazione pratica (default: oggi)
     * @returns {string}
     */
    function build(oldName, newName, date) {
        const a = sanitize(oldName);
        const b = sanitize(newName);
        const dt = formatDate(date);
        if (a && b) return `${a}_${b}_${dt}`;
        if (a) return `${a}_${dt}`;
        if (b) return `${b}_${dt}`;
        return `PRATICA_${dt}`;
    }

    /**
     * Variante per moduli a singolo intestatario (es. Switch SIM, segnalazioni).
     */
    function buildSingle(cliente, date) {
        const c = sanitize(cliente);
        const dt = formatDate(date);
        return c ? `${c}_${dt}` : `PRATICA_${dt}`;
    }

    window.MiroxFolder = {build, buildSingle, sanitize, formatDate};
})();
