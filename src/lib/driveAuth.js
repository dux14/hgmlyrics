/**
 * driveAuth.js — Obtiene un access_token de Google con scope drive.file vía
 * Google Identity Services (token model, popup). Independiente de Supabase Auth.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
let gisPromise = null;

/** Carga el script GIS una sola vez. */
function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (globalThis.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No pudimos cargar Google Identity Services.'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

/**
 * Pide al usuario autorización de Drive (popup) y resuelve con el access_token.
 * Debe llamarse dentro del gesto de clic.
 * @returns {Promise<string>}
 */
export async function getDriveToken() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('Falta configurar VITE_GOOGLE_CLIENT_ID.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp && resp.access_token) resolve(resp.access_token);
        else reject(new Error('No se obtuvo autorización de Drive.'));
      },
      error_callback: (err) => {
        const closed = err?.type === 'popup_closed';
        reject(
          new Error(closed ? 'Cerraste la ventana de Google.' : 'No se pudo autorizar Drive.'),
        );
      },
    });
    client.requestAccessToken();
  });
}
