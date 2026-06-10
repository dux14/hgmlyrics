/**
 * studioZip.js — Naming y empaquetado client-side de las pistas del Estudio.
 * Las funciones de naming son puras y testeables; la parte de IO (fetch+zip)
 * vive en downloadAllZip y no se testea en jsdom.
 */

import { zipSync } from 'fflate';

// Reemplaza caracteres no válidos para nombres de archivo por "_".
function sanitize(part) {
  return String(part).replace(/[/\\:*?"<>|]/g, '_');
}

/**
 * Nombre de archivo de una pista dentro del ZIP.
 * @param {string} originalFilename  ej. "colombia.mp3"
 * @param {string} label             ej. "Batería"
 * @returns {string} ej. "colombia - Batería.mp3"
 */
export function zipFilename(originalFilename, label) {
  const raw = typeof originalFilename === 'string' && originalFilename ? originalFilename : 'audio';
  const stem = raw.replace(/\.[^/.]+$/, '') || 'audio';
  return `${sanitize(stem)} - ${sanitize(label)}.mp3`;
}

const STEM_ORDER = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
const VOICE_ORDER = ['lead', 'backing'];

/**
 * Construye la lista de pistas { url, filename } presentes en el job.
 * @param {object} job  con stems/voices/input_meta
 * @param {Record<string,string>} labels  mapa key→etiqueta (stems + voces)
 * @returns {{url:string, filename:string}[]}
 */
export function buildTrackList(job, labels) {
  const filename = job?.input_meta?.filename ?? '';
  const out = [];
  for (const k of STEM_ORDER) {
    const url = job?.stems?.[k];
    if (url && labels[k]) out.push({ url, filename: zipFilename(filename, labels[k]) });
  }
  for (const k of VOICE_ORDER) {
    const url = job?.voices?.[k];
    if (url && labels[k]) out.push({ url, filename: zipFilename(filename, labels[k]) });
  }
  return out;
}

/**
 * Descarga todas las pistas y las entrega como un único ZIP en el navegador.
 * Si falla el fetch de cualquier pista, lanza y NO descarga un zip parcial.
 * @param {object} job
 * @param {Record<string,string>} labels
 * @returns {Promise<number>} número de pistas empaquetadas
 */
export async function downloadAllZip(job, labels) {
  const tracks = buildTrackList(job, labels);
  if (tracks.length === 0) throw new Error('No hay pistas para descargar.');

  const files = {};
  for (const { url, filename } of tracks) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No pudimos descargar "${filename}".`);
    const buf = new Uint8Array(await res.arrayBuffer());
    files[filename] = buf;
  }

  const zipped = zipSync(files, { level: 0 }); // MP3 ya está comprimido → sin recompresión
  const blob = new Blob([zipped], { type: 'application/zip' });
  const href = URL.createObjectURL(blob);
  const base = (job?.input_meta?.filename ?? 'audio').replace(/\.[^/.]+$/, '') || 'audio';
  const a = document.createElement('a');
  a.href = href;
  a.download = `${base.replace(/[/\\:*?"<>|]/g, '_')} - pistas.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
  return tracks.length;
}
