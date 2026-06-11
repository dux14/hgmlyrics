/**
 * stems.js — Dominio del Estudio de pistas: máquina de estados, cuota, validación.
 * Sin I/O: todo puro para poder testearlo sin mocks.
 */

export const DAILY_QUOTA = 1;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const RESULT_TTL_MS = 48 * 60 * 60 * 1000;
export const ACTIVE_STATUSES = ['created', 'uploaded', 'processing'];

const AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'audio/ogg',
]);

/** Transiciones válidas (solo hacia adelante). */
const NEXT = {
  // start.js salta created → processing directamente (sin pasar por uploaded).
  // Se mantiene 'uploaded' para compatibilidad con flujos futuros de dos pasos.
  // separating_stems/separating_voices se conservan como alias del pipeline v1
  // hasta que _process.js migre a 'processing' en Task 0.7.
  created: ['uploaded', 'processing', 'separating_stems', 'failed'],
  uploaded: ['processing', 'separating_stems', 'failed'],
  processing: ['done', 'partial', 'failed'],
  partial: ['done', 'failed'],
  separating_stems: ['separating_voices', 'processing', 'failed'],
  separating_voices: ['done', 'failed'],
  done: ['expired'],
  failed: [],
  expired: [],
};

/**
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  return NEXT[from]?.includes(to) ?? false;
}

/**
 * Fecha de expiración del resultado.
 * @param {Date} [from]
 * @returns {Date}
 */
export function expiresAt(from = new Date()) {
  return new Date(from.getTime() + RESULT_TTL_MS);
}

/**
 * Comprueba si un perfil tiene acceso al Estudio (beta gate).
 * @param {{ is_admin?: boolean, studio_beta?: boolean }} profile
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkStudioAccess(profile = {}) {
  if (profile?.is_admin) return { ok: true };
  if (profile?.studio_beta) return { ok: true };
  return { ok: false, reason: 'beta' };
}

/**
 * Valida los metadatos del archivo a subir. Lanza { status: 400 } si no pasa.
 * @param {{ filename?: string, size?: number, mime?: string }} meta
 */
export function validateUploadMeta({ filename, size, mime } = {}) {
  const fail = (msg) => {
    const e = new Error(msg);
    e.status = 400;
    throw e;
  };
  if (!filename || typeof filename !== 'string') fail('Falta el nombre del archivo');
  if (!Number.isFinite(size) || size <= 0) fail('Tamaño de archivo inválido');
  if (size > MAX_FILE_BYTES) fail('El archivo supera el máximo de 25 MB');
  if (!mime || !AUDIO_MIMES.has(mime)) fail('Formato no soportado: sube MP3, WAV, M4A, FLAC u OGG');
}
