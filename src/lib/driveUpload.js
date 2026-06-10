/**
 * driveUpload.js — Subida del ZIP del Estudio a Google Drive (client-side).
 * Helpers puros (query, multipart) testeables; el IO (fetch a Drive) no se testea en jsdom.
 */

const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Arma el `q` de files.list para encontrar una carpeta por nombre bajo un parent.
 * @param {string} name @param {string} parentId @returns {string}
 */
export function buildSearchQuery(name, parentId) {
  const escaped = String(name).replace(/'/g, "\\'");
  return `name='${escaped}' and mimeType='${FOLDER_MIME}' and trashed=false and '${parentId}' in parents`;
}
