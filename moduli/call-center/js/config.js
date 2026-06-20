/**
 * MIROX - Configurazione Supabase
 * 
 * ISTRUZIONI: Sostituisci SUPABASE_URL e SUPABASE_ANON_KEY
 * con i valori del tuo progetto Supabase.
 * Li trovi in: Settings → API → Project URL e anon public key
 */

const SUPABASE_URL = 'https://lbgwamhjkjjfwgusafbi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxiZ3dhbWhqa2pqZndndXNhZmJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjIxMTksImV4cCI6MjA5MDE5ODExOX0.SgmrxbP07F-8jtqvf8JHYkFqCVu-2hM4KgLEH_vPvuo';

// Inizializza il client Supabase
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Google Sheet Anagrafica sync (provvisorio)
const GOOGLE_SHEET_SYNC_URL = 'https://script.google.com/macros/s/AKfycbySCJgU3GFRR57ed7oHenD50O--r3UcBTKlOp0NEB7M3ko_MDRkVtkR24o58-ZeqLnGOw/exec';

// Configurazione app
const APP_CONFIG = {
    TIMEZONE: 'Europe/Rome',
    
    // Opzioni dropdown
    COPERTURA_OPTIONS: ['FTTH', 'FWA', 'FTTC'],
    
    MOTIVO_CHIAMATA_OPTIONS: [
        'Telefono CB', 'Fisso', 'P.iva', 'Energy', 'Duferco', 'Altro'
    ],
    
    // Motivi form pubblico (sito/social)
    MOTIVO_PUBBLICO_OPTIONS: [
        'Contratti Aziendali', 'Telefonia Mobile', 'Internet Casa',
        'Luce&Gas', 'Allarmi', 'Assicurazioni'
    ],
    
    CLUSTER_OPTIONS: ['Consumer', 'Business'],
    FASCIA_OPTIONS: ['Mattina', 'Pomeriggio'],
    
    // Mappa pagine per sidebar
    PAGINE: {
        registra_chiamata:  { titolo: 'Registra chiamata', icona: 'phone-outgoing', href: 'registra-chiamata.html', gruppo: 'call-center' },
        elenco_chiamate:    { titolo: 'Elenco chiamate',   icona: 'list',           href: 'elenco-chiamate.html',   gruppo: 'call-center' },
        rilavorazione:      { titolo: 'Rilavorazione',      icona: 'refresh-cw',     href: 'rilavorazione.html',     gruppo: 'call-center' },
        call_center_lead_outbound: { titolo: 'Lead Outbound (business)', icona: 'list', href: 'call-center-lead-outbound.html', gruppo: 'call-center' },
        appuntamenti:       { titolo: 'Appuntamenti',       icona: 'calendar',       href: 'appuntamenti.html',      gruppo: 'appuntamenti' },
        prenota_interno:    { titolo: 'Nuovo appuntamento', icona: 'plus-circle',    href: 'prenota-interno.html',   gruppo: 'appuntamenti' },
        appuntamenti_oggi:  { titolo: 'Appuntamenti oggi',  icona: 'clock',          href: 'appuntamenti-oggi.html', gruppo: 'vendita' },
        esiti_appuntamenti: { titolo: 'Esiti appuntamenti', icona: 'check-circle',   href: 'esiti-appuntamenti.html',gruppo: 'call-center' },
        blacklist:          { titolo: 'Black List',         icona: 'shield-off',     href: 'blacklist.html',         gruppo: 'altro' },
        configurazione:     { titolo: 'Configurazione',     icona: 'settings',       href: 'configurazione.html',    gruppo: 'admin' }
    },
    
    GRUPPI_SIDEBAR: {
        'call-center':  'Call Center',
        'appuntamenti': 'Appuntamenti',
        'vendita':      'Vendita',
        'altro':        'Altro',
        'admin':        'Amministrazione'
    }
};

Object.freeze(APP_CONFIG);
