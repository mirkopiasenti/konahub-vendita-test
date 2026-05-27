/**
 * MIROX Vendita - Configurazione Supabase
 * Stesso progetto del call center per usare la tabella `profili` condivisa.
 */
const SUPABASE_URL = 'https://lbgwamhjkjjfwgusafbi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxiZ3dhbWhqa2pqZndndXNhZmJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjIxMTksImV4cCI6MjA5MDE5ODExOX0.SgmrxbP07F-8jtqvf8JHYkFqCVu-2hM4KgLEH_vPvuo';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// Espone anche su window per i moduli che accedono via window.db
window.db = db;
