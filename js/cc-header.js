/**
 * MIROX Vendita - Call Center integrato: header armonizzato con dashboard.
 *
 * Sostituisce la sidebar laterale CC con:
 *   - Topbar (logo + nome utente + bottone "Torna alla dashboard" + logout)
 *   - Barra tab orizzontale con tutte le pagine CC accessibili all'utente
 *
 * Uso nelle pagine /moduli/call-center/*.html:
 *   <div id="ccHeader"></div>
 *   <main class="cc-main"> ... </main>
 *
 *   <script src="../../js/cc-header.js"></script>
 *   <script>
 *     // dopo aver caricato profilo (Auth._profilo)
 *     CcHeader.render('registra_chiamata'); // chiave pagina corrente
 *   </script>
 */
(function (root) {
  'use strict';

  // Ordine pagine CC + metadata. Le chiavi sono identiche a profili.pagine_accessibili
  // per coerenza col CC prod (regola NON negoziabile, vedi CLAUDE.md).
  const CC_PAGES = [
    { perm: 'registra_chiamata',         label: 'Registra Chiamata',  href: 'registra-chiamata.html' },
    { perm: 'elenco_chiamate',           label: 'Elenco Chiamate',    href: 'elenco-chiamate.html' },
    { perm: 'rilavorazione',             label: 'Rilavorazione',      href: 'rilavorazione.html' },
    { perm: 'call_center_lead_outbound', label: 'Lead Outbound',      href: 'call-center-lead-outbound.html' },
    { perm: 'appuntamenti',              label: 'Appuntamenti',       href: 'appuntamenti.html' },
    { perm: 'prenota_interno',           label: 'Nuovo Appuntamento', href: 'prenota-interno.html' },
    { perm: 'appuntamenti_oggi',         label: 'Appuntamenti Oggi',  href: 'appuntamenti-oggi.html' },
    { perm: 'esiti_appuntamenti',        label: 'Esiti Appuntamenti', href: 'esiti-appuntamenti.html' },
    { perm: 'blacklist',                 label: 'Black List',         href: 'blacklist.html' },
    { perm: 'configurazione',            label: 'Configurazione',     href: 'configurazione.html', adminOnly: true }
  ];

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getProfilo(profiloExplicit) {
    // 1) Profilo passato esplicitamente (modo piu' robusto)
    if (profiloExplicit && typeof profiloExplicit === 'object') return profiloExplicit;
    // 2) Auth globale (var Auth o const Auth in script normali) - non e' su window.
    //    typeof check evita ReferenceError se Auth non esiste in scope.
    try {
      if (typeof Auth !== 'undefined' && Auth) {
        if (typeof Auth.getProfilo === 'function') {
          const p = Auth.getProfilo();
          if (p) return p;
        }
        if (Auth._profilo) return Auth._profilo;
      }
    } catch (_) { /* Auth non in scope */ }
    // 3) Fallback su window.Auth (Mirox shared)
    if (root.Auth && typeof root.Auth.getProfilo === 'function') {
      const p = root.Auth.getProfilo();
      if (p) return p;
    }
    if (root.Auth && root.Auth._profilo) return root.Auth._profilo;
    return null;
  }

  function logoutSafe() {
    // Auth globale di scope (CC e Mirox lo dichiarano con const)
    try {
      if (typeof Auth !== 'undefined' && Auth && typeof Auth.logout === 'function') {
        Auth.logout();
        return;
      }
    } catch (_) { /* Auth non in scope */ }
    if (root.Auth && typeof root.Auth.logout === 'function') {
      root.Auth.logout();
      return;
    }
    // Fallback diretto via db globale (analogo: const db)
    try {
      if (typeof db !== 'undefined' && db && db.auth && typeof db.auth.signOut === 'function') {
        db.auth.signOut().finally(() => {
          root.location.href = '../../index.html';
        });
        return;
      }
    } catch (_) { /* db non in scope */ }
    if (root.db && root.db.auth && typeof root.db.auth.signOut === 'function') {
      root.db.auth.signOut().finally(() => {
        root.location.href = '../../index.html';
      });
      return;
    }
    root.location.href = '../../index.html';
  }

  function render(paginaCorrente, profiloExplicit) {
    const container = document.getElementById('ccHeader');
    if (!container) {
      console.warn('CcHeader.render: #ccHeader non trovato nel DOM');
      return;
    }

    const profilo = getProfilo(profiloExplicit);
    if (!profilo) {
      console.warn('CcHeader.render: profilo non disponibile - chiamare CcHeader.render(perm, profilo) o settare Auth._profilo prima');
      return;
    }

    const isAdmin = profilo.ruolo === 'admin';
    const perms = profilo.pagine_accessibili || {};
    const nome = profilo.nome || profilo.username || profilo.email || 'Operatore';
    const inizialeNome = String(nome).trim().charAt(0).toUpperCase();

    // Filtra le tab in base ai permessi
    const tabsAccessibili = CC_PAGES.filter((p) => {
      if (isAdmin) return true;
      if (p.adminOnly) return false;
      return perms[p.perm] === true;
    });

    const tabsHtml = tabsAccessibili.map((p) => {
      const isActive = p.perm === paginaCorrente;
      return `<a class="cc-tab${isActive ? ' active' : ''}" href="${p.href}">${escapeHtml(p.label)}</a>`;
    }).join('');

    container.innerHTML = `
      <div class="cc-topbar">
        <div class="cc-topbar-left">
          <a href="../../dashboard.html" class="cc-back-button" id="ccBackToDashboard" title="Torna alla dashboard Mirox">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
            Dashboard
          </a>
        </div>
        <div class="cc-topbar-center">
          <div class="cc-topbar-logo">
            <img src="../../assets/logo.png" alt="Mirox">
          </div>
        </div>
        <div class="cc-topbar-right">
          <div class="cc-user-chip">
            <div class="cc-user-avatar">${escapeHtml(inizialeNome)}</div>
            <div class="cc-user-name">${escapeHtml(nome)}</div>
          </div>
          <button class="cc-btn-logout" id="ccLogoutBtn" type="button">Esci</button>
        </div>
      </div>
      <nav class="cc-tabs" aria-label="Sezioni Call Center">
        ${tabsHtml}
      </nav>
    `;

    // Wire logout
    const btnLogout = document.getElementById('ccLogoutBtn');
    if (btnLogout) btnLogout.addEventListener('click', logoutSafe);
  }

  root.CcHeader = {
    render: render,
    PAGES: CC_PAGES
  };
})(window);
