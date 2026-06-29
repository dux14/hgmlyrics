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
 * Nombre base (carpeta/archivo) de la canción: sin extensión y saneado.
 * @param {object} job @returns {string}
 */
export function songBaseName(job) {
  const meta = job?.input_meta ?? {};
  const fromTitle = typeof meta.title === 'string' ? meta.title.trim() : '';
  const raw = fromTitle || (meta.filename ?? 'audio').replace(/\.[^/.]+$/, '');
  return sanitize(raw || 'audio');
}

// Nombre base de cada pista del ZIP: title si existe (sin extensión propia),
// si no el filename tal cual (zipFilename quita la extensión).
function trackBaseName(job) {
  const meta = job?.input_meta ?? {};
  const fromTitle = typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim() : '';
  return fromTitle || meta.filename || '';
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

// Etiquetas internas para la sección 4 (voces por género).
// Orden canónico: chorus primero, aufr33 segundo; male antes que female.
const GENDER_MODEL_ORDER = ['chorus', 'aufr33'];
const GENDER_MODEL_LABELS = { chorus: 'Opción A', aufr33: 'Opción B' };
const GENDER_TRACK_ORDER = ['male', 'female'];
const GENDER_TRACK_LABELS = { male: 'Voz masculina', female: 'Voz femenina' };

/**
 * Construye la lista de pistas { url, filename } presentes en el job.
 * @param {object} job  con stems/voices/genderVoices/input_meta
 * @param {Record<string,string>} labels  mapa key→etiqueta (stems + voces; las de género son internas)
 * @returns {{url:string, filename:string}[]}
 */
export function buildTrackList(job, labels) {
  const filename = trackBaseName(job);
  const out = [];
  for (const k of STEM_ORDER) {
    const url = job?.stems?.[k];
    if (url && labels[k]) out.push({ url, filename: zipFilename(filename, labels[k]) });
  }
  for (const k of VOICE_ORDER) {
    const url = job?.voices?.[k];
    if (url && labels[k]) out.push({ url, filename: zipFilename(filename, labels[k]) });
  }
  for (const model of GENDER_MODEL_ORDER) {
    const modelVoices = job?.genderVoices?.[model];
    if (!modelVoices) continue;
    for (const track of GENDER_TRACK_ORDER) {
      const url = modelVoices[track];
      if (url) {
        const label = `${GENDER_TRACK_LABELS[track]} (${GENDER_MODEL_LABELS[model]})`;
        out.push({ url, filename: zipFilename(filename, label) });
      }
    }
  }
  return out;
}

/**
 * Lista de pistas { url, filename } de UNA sola sección, para el ZIP por sección.
 * @param {object} job
 * @param {Record<string,string>} labels
 * @param {'voiceInstrumental'|'leadBacking'|'gender'|'structure'} sectionKey
 * @returns {{url:string, filename:string}[]}
 */
export function buildSectionTrackList(job, labels, sectionKey) {
  const filename = trackBaseName(job);
  const out = [];
  if (sectionKey === 'voiceInstrumental') {
    for (const k of STEM_ORDER) {
      const url = job?.stems?.[k];
      if (url && labels[k]) out.push({ url, filename: zipFilename(filename, labels[k]) });
    }
  } else if (sectionKey === 'leadBacking') {
    for (const k of VOICE_ORDER) {
      const url = job?.voices?.[k];
      if (url && labels[k]) out.push({ url, filename: zipFilename(filename, labels[k]) });
    }
  } else if (sectionKey === 'gender') {
    for (const model of GENDER_MODEL_ORDER) {
      const modelVoices = job?.genderVoices?.[model];
      if (!modelVoices) continue;
      for (const track of GENDER_TRACK_ORDER) {
        const url = modelVoices[track];
        if (url) {
          const label = `${GENDER_TRACK_LABELS[track]} (${GENDER_MODEL_LABELS[model]})`;
          out.push({ url, filename: zipFilename(filename, label) });
        }
      }
    }
  }
  // structure no genera audio → []
  return out;
}

/**
 * Descarga el ZIP de una sola sección en el navegador.
 * @param {object} job
 * @param {Record<string,string>} labels  Mapa key→etiqueta. La clave reservada `__section` puede contener
 *   el nombre legible de la sección (p. ej. 'Voces e Instrumental') usado en el nombre del ZIP; si falta, se usa el sectionKey literal.
 * @param {'voiceInstrumental'|'leadBacking'|'gender'|'structure'} sectionKey
 * @param {function} [onProgress]
 * @returns {Promise<number>} pistas empaquetadas
 */
export async function downloadSectionZip(job, labels, sectionKey, onProgress) {
  const tracks = buildSectionTrackList(job, labels, sectionKey);
  if (tracks.length === 0) throw new Error('No hay pistas para descargar en esta sección.');
  const files = {};
  let done = 0;
  for (const { url, filename } of tracks) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No pudimos descargar "${filename}".`);
    files[filename] = new Uint8Array(await res.arrayBuffer());
    onProgress?.(++done, tracks.length);
  }
  const blob = new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
  const base = songBaseName(job);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${base} - ${sanitize(labels.__section ?? sectionKey)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return tracks.length;
}

/**
 * Descarga las pistas del job, las zippea y devuelve el Blob + metadatos.
 * @param {object} job @param {Record<string,string>} labels
 * @returns {Promise<{blob: Blob, count: number, base: string}>}
 */
export async function buildZipBlob(job, labels, onProgress) {
  const tracks = buildTrackList(job, labels);
  if (tracks.length === 0) throw new Error('No hay pistas para descargar.');

  const files = {};
  let done = 0;
  for (const { url, filename } of tracks) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No pudimos descargar "${filename}".`);
    files[filename] = new Uint8Array(await res.arrayBuffer());
    onProgress?.(++done, tracks.length);
  }

  const zipped = zipSync(files, { level: 0 }); // MP3 ya está comprimido → sin recompresión
  const blob = new Blob([zipped], { type: 'application/zip' });
  const base = songBaseName(job);
  return { blob, count: tracks.length, base };
}

/**
 * Descarga todas las pistas y las entrega como un único ZIP en el navegador.
 * Si falla el fetch de cualquier pista, lanza y NO descarga un zip parcial.
 * @param {object} job @param {Record<string,string>} labels
 * @returns {Promise<number>} número de pistas empaquetadas
 */
export async function downloadAllZip(job, labels, onProgress) {
  const { blob, count, base } = await buildZipBlob(job, labels, onProgress);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${base} - pistas.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revocar de inmediato puede cancelar la descarga en Safari/Firefox (la
  // descarga arranca de forma asíncrona tras el click); diferimos la limpieza.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return count;
}
