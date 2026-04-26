/**
 * Helper frontend per upload PDF vendita.
 * - Non usa chiavi Supabase sensibili nel browser.
 * - Invia il file alla Netlify Function server-side.
 */
async function uploadVenditaDocumento(params = {}) {
  const {
    file,
    pratica_id,
    contratto_id,
    anagrafica_id,
    tipo_documento,
    storage_base_path,
    file_name,
    uploaded_by,
    nome_cartella_storage
  } = params;

  if (!file) {
    throw new Error('File mancante');
  }

  const formData = new FormData();

  // Il backend usa il campo "file" per leggere il PDF dal multipart/form-data.
  formData.append('file', file, file_name || file.name || 'documento.pdf');

  if (pratica_id) formData.append('pratica_id', pratica_id);
  if (contratto_id) formData.append('contratto_id', contratto_id);
  if (anagrafica_id) formData.append('anagrafica_id', anagrafica_id);
  if (tipo_documento) formData.append('tipo_documento', tipo_documento);
  if (storage_base_path) formData.append('storage_base_path', storage_base_path);
  if (nome_cartella_storage) formData.append('nome_cartella_storage', nome_cartella_storage);
  if (file_name) formData.append('file_name', file_name);
  if (uploaded_by) formData.append('uploaded_by', uploaded_by);

  const response = await fetch('/.netlify/functions/upload-vendita-documento', {
    method: 'POST',
    body: formData
  });

  let result;

  try {
    result = await response.json();
  } catch (error) {
    throw new Error(`Risposta non valida dalla funzione upload-vendita-documento (${response.status})`);
  }

  if (!response.ok || result.success === false) {
    throw new Error(result.error || `Upload non riuscito (${response.status})`);
  }

  return result;
}

// Esposizione globale per pagine HTML classiche (senza bundler).
if (typeof window !== 'undefined') {
  window.uploadVenditaDocumento = uploadVenditaDocumento;
}

// Export opzionale per ambienti CommonJS.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { uploadVenditaDocumento };
}
