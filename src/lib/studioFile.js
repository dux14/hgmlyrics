/**
 * studioFile.js — helpers de validación de archivos para el Estudio.
 */

/**
 * Devuelve true si el archivo es un MP3 válido.
 * Comprueba tanto el MIME type como la extensión del nombre porque algunos
 * navegadores móviles (iOS/Files) reportan type vacío al seleccionar archivos.
 *
 * @param {{ type: string, name: string }} file
 * @returns {boolean}
 */
export function isMp3File(file) {
  if (file.type === 'audio/mpeg') return true;
  return /\.mp3$/i.test(file.name);
}

/**
 * Deriva un título por defecto a partir del nombre de archivo: sin extensión, recortado.
 * @param {string} name
 * @returns {string}
 */
export function deriveTitleFromFilename(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/\.[^/.]+$/, '').trim().slice(0, 120);
}
