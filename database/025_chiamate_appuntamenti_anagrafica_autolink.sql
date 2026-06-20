-- ============================================
-- FASE 3: backfill chiamate.anagrafica_id (872 record orfani)
-- + trigger BEFORE INSERT per auto-link in futuro.
-- Additivo: il CC prod continua a funzionare invariato
-- (passa NULL su INSERT, il trigger lo riempie).
-- ============================================

-- 1) Backfill chiamate vecchie senza anagrafica_id
UPDATE public.chiamate c
SET anagrafica_id = a.id
FROM public.anagrafica a
WHERE c.anagrafica_id IS NULL
  AND c.cf_piva IS NOT NULL
  AND UPPER(TRIM(a.cf_piva)) = UPPER(TRIM(c.cf_piva));

-- 2) Backfill anche appuntamenti (potrebbero avere lo stesso problema)
UPDATE public.appuntamenti app
SET anagrafica_id = a.id
FROM public.anagrafica a
WHERE app.anagrafica_id IS NULL
  AND app.codice_fiscale IS NOT NULL
  AND UPPER(TRIM(a.cf_piva)) = UPPER(TRIM(app.codice_fiscale));

-- 3) Trigger BEFORE INSERT: auto-popola chiamate.anagrafica_id se NULL
--    Si attiva SOLO se anagrafica_id NULL e cf_piva NON NULL.
--    Non sovrascrive mai un valore esplicito (idempotente).
CREATE OR REPLACE FUNCTION public.crm_chiamate_auto_link_anagrafica()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.anagrafica_id IS NULL AND NEW.cf_piva IS NOT NULL AND TRIM(NEW.cf_piva) <> '' THEN
        SELECT a.id INTO NEW.anagrafica_id
        FROM public.anagrafica a
        WHERE UPPER(TRIM(a.cf_piva)) = UPPER(TRIM(NEW.cf_piva))
        LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chiamate_auto_link_anagrafica ON public.chiamate;
CREATE TRIGGER trg_chiamate_auto_link_anagrafica
BEFORE INSERT OR UPDATE OF cf_piva ON public.chiamate
FOR EACH ROW
EXECUTE FUNCTION public.crm_chiamate_auto_link_anagrafica();

-- 4) Stesso trigger su appuntamenti (con campo nome diverso: codice_fiscale)
CREATE OR REPLACE FUNCTION public.crm_appuntamenti_auto_link_anagrafica()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.anagrafica_id IS NULL AND NEW.codice_fiscale IS NOT NULL AND TRIM(NEW.codice_fiscale) <> '' THEN
        SELECT a.id INTO NEW.anagrafica_id
        FROM public.anagrafica a
        WHERE UPPER(TRIM(a.cf_piva)) = UPPER(TRIM(NEW.codice_fiscale))
        LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appuntamenti_auto_link_anagrafica ON public.appuntamenti;
CREATE TRIGGER trg_appuntamenti_auto_link_anagrafica
BEFORE INSERT OR UPDATE OF codice_fiscale ON public.appuntamenti
FOR EACH ROW
EXECUTE FUNCTION public.crm_appuntamenti_auto_link_anagrafica();
