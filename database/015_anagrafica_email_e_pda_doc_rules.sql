-- Migrazione 015 — anagrafica.email + categorie PDA-restricted
-- Applicata via supabase CLI in produzione.
-- Fa parte del refactor wizard upload-contratti (PDA-first + OCR + email obbligatoria).

-- 1) Colonna email su anagrafica (NULL allowed a livello DB, ma il wizard la richiede)
ALTER TABLE anagrafica ADD COLUMN IF NOT EXISTS email text;

-- 2) Aggiorna RPC cerca_o_crea_anagrafica per accettare p_email
DROP FUNCTION IF EXISTS public.cerca_o_crea_anagrafica(text, text, text, text, text, text, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.cerca_o_crea_anagrafica(
    p_cf_piva text,
    p_cluster text,
    p_ragione_sociale text,
    p_nome_referente text DEFAULT NULL,
    p_cellulare text DEFAULT NULL,
    p_provincia text DEFAULT NULL,
    p_comune text DEFAULT NULL,
    p_via text DEFAULT NULL,
    p_civico text DEFAULT NULL,
    p_creato_da uuid DEFAULT NULL,
    p_email text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cf_piva_norm text;
    v_id uuid;
BEGIN
    v_cf_piva_norm := UPPER(TRIM(COALESCE(p_cf_piva, '')));

    IF v_cf_piva_norm = '' THEN
        RAISE EXCEPTION 'cf_piva obbligatorio';
    END IF;
    IF COALESCE(TRIM(p_cluster), '') = '' THEN
        RAISE EXCEPTION 'cluster obbligatorio';
    END IF;
    IF COALESCE(TRIM(p_ragione_sociale), '') = '' THEN
        RAISE EXCEPTION 'ragione_sociale obbligatorio';
    END IF;

    SELECT id INTO v_id
    FROM public.anagrafica
    WHERE UPPER(TRIM(cf_piva)) = v_cf_piva_norm
    LIMIT 1;

    IF FOUND THEN
        UPDATE public.anagrafica
        SET cluster = COALESCE(NULLIF(TRIM(cluster), ''), p_cluster),
            ragione_sociale = COALESCE(NULLIF(TRIM(ragione_sociale), ''), p_ragione_sociale),
            nome_referente = COALESCE(NULLIF(TRIM(nome_referente), ''), p_nome_referente),
            cellulare = COALESCE(NULLIF(TRIM(cellulare), ''), p_cellulare),
            provincia = COALESCE(NULLIF(TRIM(provincia), ''), p_provincia),
            comune = COALESCE(NULLIF(TRIM(comune), ''), p_comune),
            via = COALESCE(NULLIF(TRIM(via), ''), p_via),
            civico = COALESCE(NULLIF(TRIM(civico), ''), p_civico),
            email = COALESCE(NULLIF(TRIM(email), ''), p_email),
            updated_at = now()
        WHERE id = v_id;
        RETURN v_id;
    END IF;

    INSERT INTO public.anagrafica
        (cf_piva, cluster, ragione_sociale, nome_referente, cellulare, provincia, comune, via, civico, creato_da, email)
    VALUES
        (v_cf_piva_norm, p_cluster, p_ragione_sociale, p_nome_referente, p_cellulare, p_provincia, p_comune, p_via, p_civico, p_creato_da, p_email)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- 3) Disattiva regole 'contratto' per categorie non-PDA (Energia, Allarmi, Assicurazioni).
--    Le categorie PDA-enabled (Mobile, Customer Base, Fisso) mantengono il documento contratto
--    obbligatorio, ma ora caricato a Step 1 (upload PDA prima dell'anagrafica), non a Step 4.
--    Nello stato attuale del DB Energia/Allarmi/Assicurazioni non avevano regole 'contratto' attive,
--    quindi questo UPDATE non tocca righe ma e' incluso per idempotenza/documentazione.
UPDATE vendita_documenti_regole r
SET attiva = false
FROM vendita_categorie c
WHERE r.categoria_id = c.id
  AND c.nome IN ('Energia', 'Allarmi', 'Assicurazioni')
  AND r.tipo_documento = 'contratto'
  AND r.attiva = true;
