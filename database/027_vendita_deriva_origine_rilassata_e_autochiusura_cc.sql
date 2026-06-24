-- ============================================
-- FASE 4.1: rilassamento RPC vendita_deriva_origine
-- + trigger auto-chiusura eventi CC quando si crea una pratica vendita.
-- Tutto additivo: il CC prod su mirox-crm.netlify.app non viene impattato
-- (il trigger usa stato='annullato' che esiste gia' nel CHECK constraint;
-- il passaggio_stato='chiuso' e' gia' valore valido del CHECK).
-- ============================================

-- 1) RPC rilassata
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

    -- Priorita' 1: appuntamento confermato non ancora gestito (presentato IS NULL),
    -- da oggi fino a 30 giorni nel futuro.
    -- Copre sia l'arrivo "puntuale" oggi sia l'arrivo "in anticipo" per appuntamento
    -- programmato nei prossimi giorni. Anche presentato='si' va bene (vendita immediata).
    SELECT a.id, a.data_ora, a.motivo, a.presentato
      INTO v_appuntamento
    FROM public.appuntamenti a
    WHERE a.anagrafica_id = p_anagrafica_id
      AND a.stato = 'confermato'
      AND (a.presentato IS NULL OR a.presentato = 'si')
      AND (a.data_ora AT TIME ZONE 'Europe/Rome')::date >= v_today_rome
      AND (a.data_ora AT TIME ZONE 'Europe/Rome')::date <= v_today_rome + interval '30 days'
    ORDER BY a.data_ora ASC
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'origine_pratica', 'appuntamento_callcenter',
            'evento_tipo', 'appuntamento',
            'evento_id', v_appuntamento.id,
            'descrizione',
                CASE
                    WHEN (v_appuntamento.data_ora AT TIME ZONE 'Europe/Rome')::date = v_today_rome
                        THEN 'Appuntamento di oggi ore '
                             || to_char(v_appuntamento.data_ora AT TIME ZONE 'Europe/Rome', 'HH24:MI')
                             || COALESCE(' - ' || v_appuntamento.motivo, '')
                             || CASE WHEN v_appuntamento.presentato = 'si'
                                     THEN ' (presentato)' ELSE ' (in attesa)' END
                    ELSE 'Appuntamento del '
                         || to_char(v_appuntamento.data_ora AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI')
                         || COALESCE(' - ' || v_appuntamento.motivo, '')
                         || ' (cliente arrivato in anticipo)'
                END
        );
    END IF;

    -- Priorita' 2: chiamata "passa in negozio" / "passa a cerea" entro 10 giorni.
    -- Rilassamento: NON richiediamo piu' passaggio_stato='passato'.
    -- Includiamo anche passaggio_stato='in_attesa' o NULL: se il CC ha
    -- segnalato il passaggio entro 10 giorni e il cliente arriva, e' un
    -- contatto CC anche se l'operatore CC non ha ancora cliccato "Presentato"
    -- in Rilavorazione. Escludiamo solo 'chiuso' (gia' archiviata).
    SELECT c.id, c.data_ora, c.motivo_chiamata, c.esito, c.passaggio_stato
      INTO v_chiamata
    FROM public.chiamate c
    WHERE c.anagrafica_id = p_anagrafica_id
      AND c.esito IN ('passa_in_negozio', 'passa_a_cerea')
      AND COALESCE(c.passaggio_stato, 'in_attesa') <> 'chiuso'
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
                || CASE WHEN v_chiamata.passaggio_stato = 'passato'
                        THEN ' (passato)'
                        ELSE ' (in attesa CC)'
                   END
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


-- 2) Trigger auto-chiusura eventi CC alla creazione di una nuova pratica.
-- Quando una pratica vendita viene creata per un'anagrafica:
--   a) Appuntamenti CONFERMATI non ancora gestiti (presentato IS NULL) di
--      quell'anagrafica vengono annullati automaticamente con motivo descrittivo.
--      I 'presentato=si' vengono LASCIATI per esito normale (vinta/persa
--      in Esiti Appuntamenti). I 'presentato=no' (cliente non venuto)
--      restano cosi' per Rilavorazione → Non Presentati.
--   b) Chiamate in rilavorazione aperta (rilavorazione_stato='da_lavorare'
--      OPPURE passaggio_stato='in_attesa') vengono marcate completate
--      e chiuse. Cosi' nelle pagine CC il cliente sparisce dalle liste
--      di lavoro: ha gia' fatto contratto, non serve piu' ricontattarlo.

CREATE OR REPLACE FUNCTION public.vendita_pratica_auto_chiudi_cc()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_app_count integer;
    v_chi_count integer;
    v_motivo text;
BEGIN
    IF NEW.anagrafica_id IS NULL THEN
        RETURN NEW;
    END IF;

    v_motivo := 'Chiuso automaticamente: cliente passato in anticipo, '
             || 'pratica vendita ' || NEW.id::text
             || ' creata il ' || to_char(NEW.created_at AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI');

    -- (a) Annulla appuntamenti futuri/odierni non ancora gestiti
    UPDATE public.appuntamenti
    SET stato = 'annullato',
        motivo_modifica = v_motivo
    WHERE anagrafica_id = NEW.anagrafica_id
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
    WHERE anagrafica_id = NEW.anagrafica_id
      AND (
            rilavorazione_stato = 'da_lavorare'
         OR passaggio_stato = 'in_attesa'
      );
    GET DIAGNOSTICS v_chi_count = ROW_COUNT;

    -- Log diagnostico (visibile in pg logs)
    IF v_app_count > 0 OR v_chi_count > 0 THEN
        RAISE NOTICE 'vendita_pratica_auto_chiudi_cc: pratica % anagrafica % -> % appuntamenti annullati, % chiamate chiuse',
            NEW.id, NEW.anagrafica_id, v_app_count, v_chi_count;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendita_pratica_auto_chiudi_cc ON public.vendita_pratiche;
CREATE TRIGGER trg_vendita_pratica_auto_chiudi_cc
AFTER INSERT ON public.vendita_pratiche
FOR EACH ROW
EXECUTE FUNCTION public.vendita_pratica_auto_chiudi_cc();
