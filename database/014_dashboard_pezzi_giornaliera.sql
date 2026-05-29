-- =============================================================================
-- Migration 014: Dashboard Pezzi Giornaliera
-- =============================================================================
-- Tabella `dashboard_righe_giornaliera` che descrive ogni RIGA della dashboard
-- pezzi (replica del Google Sheet "MAGGIO 28 - MATTEO/MIRKO/FRANCESCA/CEREA").
--
-- Ogni riga ha:
--   - nome         : etichetta visualizzata (es. "TIED + DEVICE VAR")
--   - gruppo       : il blocco colorato (Mobile, Customer Base, Fisso, Energia,
--                    Assicurazioni, Protecta)
--   - colore_hex   : sfondo della riga (per replicare la palette del foglio)
--   - ordine       : posizione (1, 2, 3, ...) per ordinare nella griglia
--   - regola       : JSONB con le condizioni di matching applicate ai contratti
--                    (un contratto "appartiene" alla riga se TUTTE le condizioni
--                    del JSON sono soddisfatte).
--   - attiva       : flag per nascondere righe deprecate senza cancellarle.
--
-- LE REGOLE SONO STATE INSERITE IN BASE AL NOME DELLA RIGA E A IPOTESI
-- RAGIONEVOLI. SONO DA AFFINARE: appena la dashboard mostra i conteggi
-- effettivi, basta una UPDATE sulla regola per correggere il mapping.
-- =============================================================================
-- Schema regola JSONB (campi tutti opzionali, in AND fra loro):
--   {
--     "categoria":             "Mobile",            // match esatto su categoria_snapshot
--     "categoria_in":          ["Mobile","Customer Base"],
--     "cluster":               "Business",          // match su cluster_cliente
--     "cluster_in":            ["Consumer","Business"],
--     "tipo_attivazione":      "Portabilita",
--     "apri_chiudi":           "Si",
--     "intestatario":          "Stesso intestatario",
--     "switch_sim":            "Si",
--     "modalita_pagamento":    "Anticipo",
--     "dispositivo_associato": true,
--     "tipo_acquisto":         "VAR",
--     "fascia_prezzo":         "250-599",
--     "fascia_prezzo_in":      ["0-249","250-599"],
--     "finanziaria":           "Findomestic",
--     "kolme":                 true,
--     "reload_exchange":       true,
--     "offerta_match":         "tied",              // regex case-insensitive su nome_offerta_snapshot
--     "offerta_not_match":     "untied",            // regex di esclusione
--     "opzione_match":         "device",            // regex su nome_opzione_snapshot
--     "reload_match":          "easy.?pay"
--   }
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.dashboard_righe_giornaliera (
    id          bigserial PRIMARY KEY,
    nome        text NOT NULL,
    gruppo      text NOT NULL,
    colore_hex  text NOT NULL DEFAULT '#f1f5f9',
    ordine      integer NOT NULL DEFAULT 0,
    regola      jsonb NOT NULL DEFAULT '{}'::jsonb,
    attiva      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_righe_gruppo_ordine
    ON public.dashboard_righe_giornaliera(gruppo, ordine);

GRANT SELECT ON public.dashboard_righe_giornaliera TO authenticated;

-- RLS — lettura libera per autenticati, scrittura via service role / SQL editor
ALTER TABLE public.dashboard_righe_giornaliera ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_dashboard_righe" ON public.dashboard_righe_giornaliera;
CREATE POLICY "auth_select_dashboard_righe"
    ON public.dashboard_righe_giornaliera FOR SELECT
    TO authenticated USING (true);

-- =============================================================================
-- SEED — righe iniziali (basate sul Google Sheet del 28 MAGGIO)
-- =============================================================================
-- I colori sono ispirati alla palette dello sheet:
--   Mobile          → giallo/ocra  #FFE8A3
--   Customer Base   → rosa salmone #F8D7DA
--   Fisso           → azzurro      #BEE3F8
--   Energia         → verde chiaro #C6F6D5
--   Assicurazioni   → verde scuro  #9AE6B4
--   Protecta        → verde acqua  #B2F5EA
-- =============================================================================

-- Pulizia se ri-eseguito (rimuove solo righe seed, non quelle aggiunte a mano)
DELETE FROM public.dashboard_righe_giornaliera WHERE ordine < 1000;

INSERT INTO public.dashboard_righe_giornaliera (nome, gruppo, colore_hex, ordine, regola) VALUES
-- ===== MOBILE =====
('UNTIED',                              'Mobile',        '#FFE8A3', 10,  '{"categoria":"Mobile","offerta_match":"untied"}'::jsonb),
('TIED',                                'Mobile',        '#FFE8A3', 20,  '{"categoria":"Mobile","offerta_match":"tied","offerta_not_match":"untied","dispositivo_associato":false}'::jsonb),
('TIED + DEVICE VAR',                   'Mobile',        '#FFE8A3', 30,  '{"categoria":"Mobile","offerta_match":"tied","offerta_not_match":"untied","dispositivo_associato":true,"tipo_acquisto":"VAR"}'::jsonb),
('TIED + DEVICE FINANZIATO',            'Mobile',        '#FFE8A3', 40,  '{"categoria":"Mobile","offerta_match":"tied","offerta_not_match":"untied","dispositivo_associato":true,"tipo_acquisto":"Finanziamento"}'::jsonb),
('BUSINESS - WORLD o STAFF',            'Mobile',        '#FFE8A3', 50,  '{"categoria":"Mobile","cluster":"Business","offerta_match":"world|staff"}'::jsonb),
('BUSINESS - FULL o COUNTRY',           'Mobile',        '#FFE8A3', 60,  '{"categoria":"Mobile","cluster":"Business","offerta_match":"full|country"}'::jsonb),
('BUSINESS - FLEX o SPECIAL',           'Mobile',        '#FFE8A3', 70,  '{"categoria":"Mobile","cluster":"Business","offerta_match":"flex|special"}'::jsonb),
('BUSINESS - DATI 1 pt.',               'Mobile',        '#FFE8A3', 80,  '{"categoria":"Mobile","cluster":"Business","offerta_match":"dati.*1"}'::jsonb),
('BUSINESS - DATI 0,5 pt.',             'Mobile',        '#FFE8A3', 90,  '{"categoria":"Mobile","cluster":"Business","offerta_match":"dati.*0[\\.,]5"}'::jsonb),
('FWA INDOOR + DEVICE FINANZIATO',      'Mobile',        '#FFE8A3', 100, '{"categoria":"Mobile","offerta_match":"fwa.*indoor","dispositivo_associato":true,"tipo_acquisto":"Finanziamento"}'::jsonb),
('SMART SECURITY',                      'Mobile',        '#FFE8A3', 110, '{"offerta_match":"smart.?security"}'::jsonb),

-- ===== CUSTOMER BASE =====
('CB UNTIED',                           'Customer Base', '#F8D7DA', 200, '{"categoria":"Customer Base","offerta_match":"untied"}'::jsonb),
('CAMBIO PIANO EASY PAY',               'Customer Base', '#F8D7DA', 210, '{"categoria":"Customer Base","offerta_match":"cambio.?piano|easy.?pay"}'::jsonb),
('CB TELEFONO VAR RID',                 'Customer Base', '#F8D7DA', 220, '{"categoria":"Customer Base","offerta_match":"telefono","tipo_acquisto":"VAR"}'::jsonb),
('CB TELEFONO FINANZIATO',              'Customer Base', '#F8D7DA', 230, '{"categoria":"Customer Base","offerta_match":"telefono","tipo_acquisto":"Finanziamento"}'::jsonb),
('CB CARING - FISSO',                   'Customer Base', '#F8D7DA', 240, '{"categoria":"Customer Base","offerta_match":"caring.*fiss"}'::jsonb),
('CB CARING - MOBILE',                  'Customer Base', '#F8D7DA', 250, '{"categoria":"Customer Base","offerta_match":"caring.*mob"}'::jsonb),

-- ===== FISSO =====
('FTTC - FTTH - FWA OUTDOOR',           'Fisso',         '#BEE3F8', 300, '{"categoria":"Fisso","cluster":"Consumer","offerta_match":"ftt|fwa.*outdoor"}'::jsonb),
('FWA INDOOR',                          'Fisso',         '#BEE3F8', 310, '{"categoria":"Fisso","cluster":"Consumer","offerta_match":"fwa.*indoor"}'::jsonb),
('FWA VOCE',                            'Fisso',         '#BEE3F8', 320, '{"categoria":"Fisso","cluster":"Consumer","offerta_match":"fwa.*voce"}'::jsonb),
('BUSINESS - FTTC - FTTH - FWA OUTDOOR','Fisso',         '#BEE3F8', 330, '{"categoria":"Fisso","cluster":"Business","offerta_match":"ftt|fwa.*outdoor"}'::jsonb),
('BUSINESS - FWA VOCE',                 'Fisso',         '#BEE3F8', 340, '{"categoria":"Fisso","cluster":"Business","offerta_match":"fwa.*voce"}'::jsonb),
('PROFESSIONAL BOX FRTIZIBox',          'Fisso',         '#BEE3F8', 350, '{"categoria":"Fisso","offerta_match":"professional.?box|fritz"}'::jsonb),
('2° LINEA P.IVA',                      'Fisso',         '#BEE3F8', 360, '{"categoria":"Fisso","cluster":"Business","offerta_match":"2.?linea|seconda.?linea"}'::jsonb),
('NETFLIX',                             'Fisso',         '#BEE3F8', 370, '{"offerta_match":"netflix"}'::jsonb),

-- ===== ENERGIA =====
('LUCE',                                'Energia',       '#C6F6D5', 400, '{"categoria":"Energia","cluster":"Consumer","offerta_match":"luce"}'::jsonb),
('GAS',                                 'Energia',       '#C6F6D5', 410, '{"categoria":"Energia","cluster":"Consumer","offerta_match":"gas"}'::jsonb),
('LUCE P.IVA',                          'Energia',       '#C6F6D5', 420, '{"categoria":"Energia","cluster":"Business","offerta_match":"luce"}'::jsonb),
('GAS P.IVA',                           'Energia',       '#C6F6D5', 430, '{"categoria":"Energia","cluster":"Business","offerta_match":"gas"}'::jsonb),

-- ===== ASSICURAZIONI =====
('ASSICURAZIONE - 0,5 pt.',             'Assicurazioni', '#9AE6B4', 500, '{"categoria":"Assicurazioni","offerta_match":"0[\\.,]5"}'::jsonb),
('ASSICURAZIONE - 1,5 pt.',             'Assicurazioni', '#9AE6B4', 510, '{"categoria":"Assicurazioni","offerta_match":"1[\\.,]5"}'::jsonb),
('ASSICURAZIONE - 2 pt.',               'Assicurazioni', '#9AE6B4', 520, '{"categoria":"Assicurazioni","offerta_match":"^(?!.*[\\.,]5).*\\b2\\b"}'::jsonb),
('ASSICURAZIONE - 3 pt.',               'Assicurazioni', '#9AE6B4', 530, '{"categoria":"Assicurazioni","offerta_match":"^(?!.*[\\.,]5).*\\b3\\b"}'::jsonb),

-- ===== PROTECTA =====
('PROTECTA CASA - 499€ - 39€/MESE',     'Protecta',      '#B2F5EA', 600, '{"offerta_match":"protecta.*casa.*499|protecta.*casa.*39"}'::jsonb),
('PROTECTA CASA PLUS - 799€ - 49€/MESE','Protecta',      '#B2F5EA', 610, '{"offerta_match":"protecta.*casa.*plus|protecta.*casa.*799|protecta.*casa.*49"}'::jsonb),
('PROTECTA BUSINESS - 599€+iva - 39€/MESE+iva','Protecta','#B2F5EA',620, '{"offerta_match":"protecta.*business"}'::jsonb);

COMMIT;
