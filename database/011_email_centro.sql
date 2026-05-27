-- =============================================================================
-- 011 - Centro Email Mirox
--   - tabella email_template: tutti i template centralizzati (slug + subject + html)
--   - tabella email_log: traccia di TUTTE le mail inviate dal sistema
-- =============================================================================

BEGIN;

-- =============================================================================
-- email_template: contiene tutti i template usati dal sistema.
-- I template supportano placeholder con sintassi {{nome_variabile}}.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.email_template (
    slug          text PRIMARY KEY,
    subject       text NOT NULL,
    html_body     text NOT NULL,
    descrizione   text,
    attivo        boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_email_template_touch ON public.email_template;
CREATE TRIGGER trg_email_template_touch
    BEFORE UPDATE ON public.email_template
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.email_template ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_template_authenticated_all ON public.email_template;
CREATE POLICY email_template_authenticated_all ON public.email_template
    FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

-- =============================================================================
-- email_log: storico invii (anche falliti)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.email_log (
    id             bigserial PRIMARY KEY,
    sent_at        timestamptz NOT NULL DEFAULT now(),
    destinatario   text NOT NULL,
    mittente       text,
    subject        text,
    template_slug  text,
    status         text NOT NULL CHECK (status IN ('sent','error')),
    error          text,
    related_table  text,
    related_id     text,
    payload        jsonb
);
CREATE INDEX IF NOT EXISTS idx_email_log_sent_at ON public.email_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_template ON public.email_log(template_slug);
CREATE INDEX IF NOT EXISTS idx_email_log_related ON public.email_log(related_table, related_id);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_log_authenticated_read ON public.email_log;
CREATE POLICY email_log_authenticated_read ON public.email_log
    FOR SELECT TO authenticated
    USING (true);

-- =============================================================================
-- SEED template iniziali — stile uniforme con header arancione Mirox CRM
-- =============================================================================

-- Wrapper HTML (riusato in ogni template)
-- Variabili speciali: {{__title__}}, {{__subtitle__}}, {{__body_rows__}}, {{__cta_label__}}, {{__cta_url__}}, {{__details__}}
-- ma per semplicità ognuno definisce il proprio HTML completo (subset di stili supportati).

INSERT INTO public.email_template (slug, subject, html_body, descrizione, attivo) VALUES

-- =========================================================
-- 1) SEGNALAZIONE ASSEGNATA (replica stile screenshot)
-- =========================================================
('segnalazione_assegnata',
 'Segnalazione #{{id}} assegnata — {{ragione_sociale}}',
$$<!DOCTYPE html>
<html><body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f5f7fa;margin:0;padding:24px;color:#0f172a;">
<div style="max-width:620px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.06);">
  <div style="background:#FF6600;color:#fff;padding:22px 26px;">
    <div style="font-size:18px;font-weight:800;margin-bottom:4px;">🔔 Nuova Segnalazione Assegnata</div>
    <div style="font-size:13px;opacity:.92;">Segnalazione #{{id}} assegnata a {{assegnatario}}</div>
  </div>
  <div style="padding:22px 26px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:10px 12px;font-weight:700;width:200px;background:#f8fafc;border-radius:6px 0 0 6px;">ID</td><td style="padding:10px 12px;color:#FF6600;font-weight:700;">#{{id}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Urgenza</td><td style="padding:10px 12px;"><span style="background:#DCFCE7;color:#047857;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;">{{urgenza}}</span></td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Ragione Sociale</td><td style="padding:10px 12px;">{{ragione_sociale}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Codice Fiscale / P.IVA</td><td style="padding:10px 12px;">{{codice_fiscale_piva}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Numero</td><td style="padding:10px 12px;">{{numero_contatto}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Operatore</td><td style="padding:10px 12px;">{{operatore}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Gestione</td><td style="padding:10px 12px;">{{gestione_pratica}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Data Invio</td><td style="padding:10px 12px;">{{data_invio}}</td></tr>
    </table>
    <div style="background:#fff7ed;border-left:4px solid #FF6600;padding:14px 16px;border-radius:8px;margin-top:18px;">
      <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">Dettagli Segnalazione</div>
      <div style="font-size:14px;line-height:1.5;color:#1e293b;">{{dettagli_segnalazione}}</div>
    </div>
    <div style="text-align:center;margin-top:22px;">
      <a href="{{link_segnalazioni}}" style="background:#FF6600;color:#fff;text-decoration:none;padding:11px 24px;border-radius:10px;font-weight:700;font-size:14px;display:inline-block;">Apri Segnalazioni</a>
    </div>
    <div style="text-align:center;margin-top:18px;font-size:12px;color:#94a3b8;">
      Notifica automatica da <strong style="color:#FF6600;">Mirox</strong> CRM — KONAHUB
    </div>
  </div>
</div>
</body></html>$$,
 'Mail inviata quando una segnalazione viene assegnata a un operatore (es. Mirko/Francesca)',
 true),

-- =========================================================
-- 2) RIENTRO SWITCH SIM (cron giornaliero)
-- =========================================================
('rientro_sim',
 '[Switch SIM] Rientro oggi: {{cliente}} (MNP {{mnp}})',
$$<!DOCTYPE html>
<html><body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f5f7fa;margin:0;padding:24px;color:#0f172a;">
<div style="max-width:620px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.06);">
  <div style="background:#FF6600;color:#fff;padding:22px 26px;">
    <div style="font-size:18px;font-weight:800;margin-bottom:4px;">📲 Rientro Switch SIM previsto OGGI</div>
    <div style="font-size:13px;opacity:.92;">Verifica e gestisci il rientro del cliente</div>
  </div>
  <div style="padding:22px 26px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:10px 12px;font-weight:700;width:200px;background:#f8fafc;border-radius:6px 0 0 6px;">Cliente</td><td style="padding:10px 12px;">{{cliente}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">CF / P.IVA</td><td style="padding:10px 12px;">{{cf}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Numero MNP</td><td style="padding:10px 12px;color:#FF6600;font-weight:700;">{{mnp}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Gestore</td><td style="padding:10px 12px;">{{gestore}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Operatore</td><td style="padding:10px 12px;">{{operatore}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Data inserimento</td><td style="padding:10px 12px;">{{data_inserimento}}</td></tr>
    </table>
    <div style="text-align:center;margin-top:22px;">
      <a href="{{link_switch}}" style="background:#FF6600;color:#fff;text-decoration:none;padding:11px 24px;border-radius:10px;font-weight:700;font-size:14px;display:inline-block;">Apri Switch SIM</a>
    </div>
    <div style="text-align:center;margin-top:18px;font-size:12px;color:#94a3b8;">
      Notifica automatica da <strong style="color:#FF6600;">Mirox</strong> CRM — KONAHUB · ID pratica: {{id}}
    </div>
  </div>
</div>
</body></html>$$,
 'Cron giornaliero: avvisa quando un cliente ha giorno_rientro = oggi',
 true),

-- =========================================================
-- 3) NUOVO ORDINE SMARTPHONE
-- =========================================================
('ordine_smartphone_nuovo',
 '[Ordine Smartphone] {{cliente}} — {{marca}} {{modello}}',
$$<!DOCTYPE html>
<html><body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f5f7fa;margin:0;padding:24px;color:#0f172a;">
<div style="max-width:620px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.06);">
  <div style="background:#FF6600;color:#fff;padding:22px 26px;">
    <div style="font-size:18px;font-weight:800;margin-bottom:4px;">📱 Nuovo Ordine Smartphone</div>
    <div style="font-size:13px;opacity:.92;">Ordine inserito da {{operatore}}</div>
  </div>
  <div style="padding:22px 26px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:10px 12px;font-weight:700;width:200px;background:#f8fafc;border-radius:6px 0 0 6px;">Codice Ordine</td><td style="padding:10px 12px;color:#FF6600;font-weight:700;">{{codice_ordine}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Cliente</td><td style="padding:10px 12px;">{{cliente}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">CF / P.IVA</td><td style="padding:10px 12px;">{{cf}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Cellulare</td><td style="padding:10px 12px;">{{cellulare}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Marca</td><td style="padding:10px 12px;">{{marca}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Modello</td><td style="padding:10px 12px;">{{modello}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Memoria</td><td style="padding:10px 12px;">{{memoria}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Colorazione</td><td style="padding:10px 12px;">{{colorazione}}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;background:#f8fafc;border-radius:6px 0 0 6px;">Operatore</td><td style="padding:10px 12px;">{{operatore}}</td></tr>
    </table>
    {{note_block}}
    <div style="text-align:center;margin-top:22px;">
      <a href="{{link_ordini}}" style="background:#FF6600;color:#fff;text-decoration:none;padding:11px 24px;border-radius:10px;font-weight:700;font-size:14px;display:inline-block;">Apri Ordini</a>
    </div>
    <div style="text-align:center;margin-top:18px;font-size:12px;color:#94a3b8;">
      Notifica automatica da <strong style="color:#FF6600;">Mirox</strong> CRM — KONAHUB
    </div>
  </div>
</div>
</body></html>$$,
 'Mail inviata ad ogni nuova richiesta di ordine smartphone',
 true)

ON CONFLICT (slug) DO UPDATE SET
    subject = EXCLUDED.subject,
    html_body = EXCLUDED.html_body,
    descrizione = EXCLUDED.descrizione,
    attivo = EXCLUDED.attivo,
    updated_at = now();

COMMIT;
