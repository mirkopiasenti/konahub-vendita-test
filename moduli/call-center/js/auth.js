/**
 * MIROX - Modulo Autenticazione
 * Gestisce login, logout, sessione e permessi.
 */

const Auth = {
    _profilo: null,

    /**
     * Login con email e password
     */
    async login(email, password) {
        const { data, error } = await db.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            return { success: false, error: error.message };
        }

        // Carica il profilo
        const profilo = await this.caricaProfilo(data.user.id);
        if (!profilo) {
            await db.auth.signOut();
            return { success: false, error: 'Profilo non trovato. Contatta l\'amministratore.' };
        }

        if (!profilo.attivo) {
            await db.auth.signOut();
            return { success: false, error: 'Account disabilitato.' };
        }

        this._profilo = profilo;
        return { success: true, profilo: profilo };
    },

    /**
     * Logout
     */
    async logout() {
        // Pulisci flag notifiche per permettere popup al prossimo login
        Object.keys(sessionStorage).forEach(k => {
            if (k.startsWith('mirox_notifiche_popup_')) sessionStorage.removeItem(k);
        });
        this._profilo = null;
        await db.auth.signOut();
        window.location.href = '../../index.html';
    },

    /**
     * Carica profilo dal database
     */
    async caricaProfilo(userId) {
        const { data, error } = await supabase
            .from('profili')
            .select('*')
            .eq('id', userId)
            .single();

        if (error || !data) return null;
        return data;
    },

    /**
     * Recupera la sessione corrente e il profilo.
     * Ritorna il profilo se autenticato, null altrimenti.
     */
    async getSessione() {
        if (this._profilo) return this._profilo;

        const { data: { session } } = await db.auth.getSession();
        if (!session) return null;

        const profilo = await this.caricaProfilo(session.user.id);
        if (!profilo || !profilo.attivo) return null;

        this._profilo = profilo;
        return profilo;
    },

    /**
     * Richiede autenticazione. Se non autenticato, redirect a login.
     * Ritorna il profilo se autenticato.
     */
    async richiediAuth() {
        const profilo = await this.getSessione();
        if (!profilo) {
            window.location.href = '../../index.html';
            return null;
        }
        return profilo;
    },

    /**
     * Verifica se l'utente ha accesso a una pagina specifica
     */
    puoAccedere(pagina) {
        if (!this._profilo) return false;
        if (this._profilo.ruolo === 'admin') return true;
        const permessi = this._profilo.pagine_accessibili || {};
        return permessi[pagina] === true;
    },

    /**
     * Richiede accesso a una pagina. Redirect se non autorizzato.
     */
    async richiediAccesso(pagina) {
        const profilo = await this.richiediAuth();
        if (!profilo) return null;

        if (!this.puoAccedere(pagina)) {
            // Trova la prima pagina accessibile come fallback
            const pagine = APP_CONFIG.PAGINE;
            for (const [key, config] of Object.entries(pagine)) {
                if (this.puoAccedere(key)) {
                    window.location.href = config.href;
                    return null;
                }
            }
            await this.logout();
            return null;
        }

        return profilo;
    },

    /**
     * Getters rapidi
     */
    isAdmin() {
        return this._profilo?.ruolo === 'admin';
    },

    getProfilo() {
        return this._profilo;
    },

    getId() {
        return this._profilo?.id;
    },

    getNome() {
        return this._profilo?.nome;
    }
};
