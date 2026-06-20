-- ============================================
-- FASE 4: RPC vendita_deriva_origine
-- Dato un anagrafica_id, ritorna la suggestion di origine_pratica
-- basata sull'attivita' CC piu' recente del cliente.
-- ============================================

CREATE OR REPLACE FUNCTION public.vendita_deriva_origine(p_anagrafica_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today_rome date := (now() AT TIME ZONE 'Europe/Rome')::date;
    v_appuntamento RECORD;
    v_chiamata RECORD;
BEGIN
    IF p_anagrafica_id IS NULL THEN
        RETURN jsonb_build_object(
            'origine_pratica', 'spontaneo',
            'evento_tipo', NULL,
            'evento_id', NULL,
            'descrizione', NULL
        );
    END IF;

    -- Priorita' 1: appuntamento confermato per oggi (con o senza presentato='si')
    SELECT a.id, a.data_ora, a.motivo, a.presentato
      INTO v_appuntamento
    FROM public.appuntamenti a
    WHERE a.anagrafica_id = p_anagrafica_id
      AND a.stato = 'confermato'
      AND (a.data_ora AT TIME ZONE 'Europe/Rome')::date = v_today_rome
    ORDER BY a.data_ora DESC
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'origine_pratica', 'appuntamento_callcenter',
            'evento_tipo', 'appuntamento',
            'evento_id', v_appuntamento.id,
            'descrizione', 'Appuntamento di oggi ore '
                || to_char(v_appuntamento.data_ora AT TIME ZONE 'Europe/Rome', 'HH24:MI')
                || COALESCE(' - ' || v_appuntamento.motivo, '')
                || CASE WHEN v_appuntamento.presentato = 'si'
                        THEN ' (presentato)'
                        ELSE ' (in attesa)'
                   END
        );
    END IF;

    -- Priorita' 2: chiamata "passa in negozio" / "passa a cerea" passata entro 10 giorni
    SELECT c.id, c.data_ora, c.motivo_chiamata, c.esito
      INTO v_chiamata
    FROM public.chiamate c
    WHERE c.anagrafica_id = p_anagrafica_id
      AND c.esito IN ('passa_in_negozio', 'passa_a_cerea')
      AND c.passaggio_stato = 'passato'
      AND c.data_ora >= now() - interval '10 days'
    ORDER BY c.data_ora DESC
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'origine_pratica', 'contatto_callcenter_entro_10_giorni',
            'evento_tipo', 'chiamata',
            'evento_id', v_chiamata.id,
            'descrizione', 'Chiamata "'
                || CASE v_chiamata.esito
                       WHEN 'passa_in_negozio' THEN 'passa in negozio'
                       WHEN 'passa_a_cerea' THEN 'passa a Cerea'
                       ELSE v_chiamata.esito
                   END
                || '" del '
                || to_char(v_chiamata.data_ora AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY')
                || COALESCE(' - ' || v_chiamata.motivo_chiamata, '')
        );
    END IF;

    -- Default: spontaneo
    RETURN jsonb_build_object(
        'origine_pratica', 'spontaneo',
        'evento_tipo', NULL,
        'evento_id', NULL,
        'descrizione', NULL
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.vendita_deriva_origine(uuid) TO authenticated;
