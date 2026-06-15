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

/**
 * Arma el cuerpo multipart/related (RFC 2387): parte JSON + parte binaria.
 * @param {object} metadata @param {Blob} fileBlob @param {string} boundary @returns {Blob}
 */
export function buildMultipartBody(metadata, fileBlob, boundary) {
  const metaPart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n`;
  const mediaHeader = `--${boundary}\r\nContent-Type: application/zip\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;
  return new Blob([metaPart, mediaHeader, fileBlob, closing], {
    type: `multipart/related; boundary=${boundary}`,
  });
}

async function driveFetchJson(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = new Error(`Drive respondió ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Encuentra (o crea) una carpeta por nombre bajo parentId. Con scope drive.file
 * solo ve carpetas que la app creó → idempotente entre guardados.
 * @returns {Promise<string>} id de la carpeta
 */
export async function findOrCreateFolder(token, name, parentId) {
  const q = buildSearchQuery(name, parentId);
  const found = await driveFetchJson(
    token,
    `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)`,
  );
  if (found.files && found.files.length > 0) return found.files[0].id;
  const created = await driveFetchJson(token, FILES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  return created.id;
}

/**
 * Sube el cuerpo multipart a Drive vía XHR para exponer progreso de subida.
 * @param {string} token @param {Blob} body @param {string} boundary
 * @param {(percent:number)=>void} [onProgress]
 * @returns {Promise<{id:string}>}
 */
export function uploadMedia(token, body, boundary, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${UPLOAD_URL}&fields=id`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 400) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          const err = new Error('Respuesta inválida de Drive al subir el ZIP.');
          err.status = xhr.status;
          reject(err);
        }
      } else {
        const err = new Error(`Drive respondió ${xhr.status} al subir el ZIP.`);
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => {
      const err = new Error('Error de red al subir el ZIP a Drive.');
      err.status = 0;
      reject(err);
    };
    xhr.send(body);
  });
}

/**
 * Sube el ZIP a Pistas Hakuna/{songBase}/{songBase} - pistas.zip.
 * @param {string} token @param {Blob} blob @param {string} songBase
 * @param {(percent:number)=>void} [onProgress]
 * @returns {Promise<{fileId: string, folderUrl: string}>}
 */
export async function uploadZipToDrive(token, blob, songBase, onProgress) {
  const rootId = await findOrCreateFolder(token, 'Pistas Hakuna', 'root');
  const songFolderId = await findOrCreateFolder(token, songBase, rootId);

  const boundary = `hknDrive${Math.random().toString(16).slice(2)}`;
  const metadata = { name: `${songBase} - pistas.zip`, parents: [songFolderId] };
  const body = buildMultipartBody(metadata, blob, boundary);

  const data = await uploadMedia(token, body, boundary, onProgress);
  const folder = await driveFetchJson(token, `${FILES_URL}/${songFolderId}?fields=webViewLink`);
  return { fileId: data.id, folderUrl: folder.webViewLink };
}
