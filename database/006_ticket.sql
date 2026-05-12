-- =============================================================================
-- 006 - Tabella TICKET (gestione ticket clienti, globale)
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ticket (
    id                  bigserial PRIMARY KEY,
    data_creazione      timestamptz NOT NULL DEFAULT now(),

    intestatario        text NOT NULL,
    codice_fiscale_piva text,             -- opzionale
    cellulare           text NOT NULL,
    con_chi             text NOT NULL,    -- "con chi vuole parlare"
    motivazione         text NOT NULL,

    stato               text NOT NULL DEFAULT 'Da gestire'
                        CHECK (stato IN ('Da gestire','Lavorata')),

    nota_lavorazione    text,
    data_lavorazione    timestamptz,

    operatore_id        uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL,
    operatore_nome      text NULL,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_stato  ON public.ticket(stato);
CREATE INDEX IF NOT EXISTS idx_ticket_data   ON public.ticket(data_creazione DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_cell   ON public.ticket(cellulare);

-- Trigger updated_at (riusa funzione esistente touch_updated_at se presente, altrimenti la crea)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_touch ON public.ticket;
CREATE TRIGGER trg_ticket_touch BEFORE UPDATE ON public.ticket
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS: accessibile solo agli utenti autenticati
ALTER TABLE public.ticket ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ticket_authenticated_all ON public.ticket;
CREATE POLICY ticket_authenticated_all ON public.ticket
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

COMMIT;
