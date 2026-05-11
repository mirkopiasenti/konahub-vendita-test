/**
 * MIROX Vendita - Autenticazione (Supabase + tabella `profili`)
 */
const Auth = {
  _profilo: null,

  _indexPath() {
    // Risolve correttamente il path verso index.html sia dalla root
    // che dalla cartella /moduli/ (e qualsiasi sotto-cartella di primo livello).
    return window.location.pathname.includes('/moduli/') ? '../index.html' : 'index.html';
  },

  async caricaProfilo(userId) {
    const { data, error } = await db.from('profili').select('*').eq('id', userId).single();
    if (error || !data) return null;
    return data;
  },

  async getSessione() {
    if (this._profilo) return this._profilo;
    const { data: { session } } = await db.auth.getSession();
    if (!session) return null;
    const profilo = await this.caricaProfilo(session.user.id);
    if (!profilo || !profilo.attivo) return null;
    this._profilo = profilo;
    return profilo;
  },

  async richiediAuth() {
    const profilo = await this.getSessione();
    if (!profilo) {
      window.location.href = this._indexPath();
      return null;
    }
    return profilo;
  },

  async logout() {
    this._profilo = null;
    await db.auth.signOut();
    window.location.href = this._indexPath();
  },

  getProfilo() { return this._profilo; },
  getId() { return this._profilo?.id; },
  getNome() { return this._profilo?.nome; }
};
