/**
 * uploads.js — Validación de firma real (magic bytes) para archivos subidos.
 * `file.mimetype` lo declara el cliente y no es fiable; esto inspecciona los
 * primeros bytes del archivo bufferado por formidable en /tmp.
 */
import { fileTypeFromFile } from 'file-type';

/**
 * Detecta el tipo real del archivo en `filepath` y valida que esté en `allowedMimes`.
 * @param {string} filepath - ruta del archivo bufferado (file.filepath de formidable)
 * @param {Set<string>|string[]} allowedMimes - mimes permitidos
 * @returns {Promise<string>} mime detectado
 * @throws {Error} con `.status = 400` si no se detecta o no está permitido
 */
export async function detectImageType(filepath, allowedMimes) {
  const allowed = allowedMimes instanceof Set ? allowedMimes : new Set(allowedMimes);
  const detected = await fileTypeFromFile(filepath);
  if (!detected || !allowed.has(detected.mime)) {
    const e = new Error('El contenido del archivo no coincide con un tipo de imagen permitido.');
    e.status = 400;
    throw e;
  }
  return detected.mime;
}
