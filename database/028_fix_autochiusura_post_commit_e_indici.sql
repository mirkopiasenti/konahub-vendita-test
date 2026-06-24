-- ============================================
-- FIX B1: rimuovi trigger auto-chiusura su INSERT vendita_pratiche.
-- Motivo: il trigger scatta PRIMA che vengano creati i contratti.
-- Se la creazione contratti fallisce, il backend fa rollback (delete
-- della pratica) ma gli appuntamenti gia' annullati restano orfani.
-- La logica viene spostata nel backend Netlify (eseguita solo a fine
-- flusso, dopo che tutti i contratti sono inseriti con successo).
--
-- FIX B3: aggiungi indici per la RPC vendita_deriva_origine, in modo
-- che il lookup appuntamenti/chiamate per anagrafica_id sia veloce.
-- ============================================

-- Drop trigger (sopravvive la funzione, viene chiamata dal backend)
DROP TRIGGER IF EXISTS trg_vendita_pratica_auto_chiudi_cc ON public.vendita_pratiche;

-- La funzione vendita_pratica_auto_chiudi_cc resta in DB perche'
-- il backend la richiama via RPC. Ma esponiamo una variante piu' diretta
-- che il backend puo' chiamare passando solo anagrafica_id + pratica_id.

CREATE OR REPLACE FUNCTION public.vendita_chiudi_eventi_cc_per_pratica(
    p_anagrafica_id uuid,
    p_pratica_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_app_count integer;
    v_chi_count integer;
    v_motivo text;
    v_pratica_created_at timestamptz;
BEGIN
    IF p_anagrafica_id IS NULL OR p_pratica_id IS NULL THEN
        RETURN jsonb_build_object(
            'appuntamenti_annullati', 0,
            'chiamate_chiuse', 0,
            'skipped', true
        );
    END IF;

    -- Verifica che la pratica esista davvero (anti-rollback safety)
    SELECT created_at INTO v_pratica_created_at
    FROM public.vendita_pratiche
    WHERE id = p_pratica_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'appuntamenti_annullati', 0,
            'chiamate_chiuse', 0,
            'skipped', true,
            'reason', 'pratica_inesistente'
        );
    END IF;

    v_motivo := 'Chiuso automaticamente: cliente passato in anticipo, '
             || 'pratica vendita ' || p_pratica_id::text
             || ' creata il ' || to_char(v_pratica_created_at AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI');

    -- (a) Annulla appuntamenti futuri/odierni non ancora gestiti
    UPDATE public.appuntamenti
    SET stato = 'annullato',
        motivo_modifica = v_motivo
    WHERE anagrafica_id = p_anagrafica_id
      AND stato = 'confermato'
      AND presentato IS NULL
      AND data_ora >= (now() AT TIME ZONE 'Europe/Rome')::date - interval '1 day';
    GET DIAGNOSTICS v_app_count = ROW_COUNT;

    -- (b) Chiudi chiamate in rilavorazione
    UPDATE public.chiamate
    SET rilavorazione_stato = 'completato',
        passaggio_stato = CASE
            WHEN passaggio_stato = 'in_attesa' THEN 'chiuso'
            ELSE passaggio_stato
        END
    WHERE anagrafica_id = p_anagrafica_id
      AND (
            rilavorazione_stato = 'da_lavorare'
         OR passaggio_stato = 'in_attesa'
      );
    GET DIAGNOSTICS v_chi_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'appuntamenti_annullati', v_app_count,
        'chiamate_chiuse', v_chi_count,
        'skipped', false
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.vendita_chiudi_eventi_cc_per_pratica(uuid, uuid) TO authenticated, service_role;

-- ============================================
-- FIX B3: indici per RPC vendita_deriva_origine
-- ============================================

-- Lookup appuntamenti per cliente (livello 1 RPC)
CREATE INDEX IF NOT EXISTS idx_appuntamenti_anagrafica_stato_data
    ON public.appuntamenti (anagrafica_id, stato, data_ora)
    WHERE anagrafica_id IS NOT NULL;

-- Lookup chiamate per cliente + esito (livello 2 RPC + trigger auto-chiusura)
CREATE INDEX IF NOT EXISTS idx_chiamate_anagrafica_esito_data
    ON public.chiamate (anagrafica_id, esito, data_ora DESC)
    WHERE anagrafica_id IS NOT NULL;

-- Lookup chiamate per cliente con rilavorazione aperta (auto-chiusura)
CREATE INDEX IF NOT EXISTS idx_chiamate_anagrafica_rilavorazione
    ON public.chiamate (anagrafica_id)
    WHERE anagrafica_id IS NOT NULL
      AND (rilavorazione_stato = 'da_lavorare' OR passaggio_stato = 'in_attesa');
