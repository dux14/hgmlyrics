/**
 * state.js — Dominio de Partitura vocal: máquina de estados, cuota, validación,
 * gating beta. Sin I/O: puro y testeable sin mocks.
 */
export const DAILY_QUOTA = 2; // beta cerrada: acota el uso operacional de GPU propia (oss y precision corren GPU de Modal, sin USD directo). Revisar contra costo variable para GA.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const RESULT_TTL_MS = 48 * 60 * 60 * 1000;
// Estados que ocupan el índice único "un activo por usuario".
export const ACTIVE_STATUSES = ['created', 'uploaded', 'estimating', 'awaiting_approval', 'running'];

const AUDIO_MIMES = new Set([
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mp4',
  'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/flac', 'audio/ogg',
]);

const NEXT = {
  created: ['uploaded', 'estimating', 'failed', 'cancelled'],
  uploaded: ['estimating', 'failed', 'cancelled'],
  estimating: ['awaiting_approval', 'failed', 'cancelled'],
  awaiting_approval: ['running', 'cancelled', 'failed'],
  running: ['succeeded', 'partial', 'failed', 'cancelled'],
  partial: ['succeeded', 'failed', 'expired'],
  succeeded: ['expired'],
  failed: [],
  cancelled: [],
  expired: [],
};

export function canTransition(from, to) {
  return NEXT[from]?.includes(to) ?? false;
}

export function expiresAt(from = new Date()) {
  return new Date(from.getTime() + RESULT_TTL_MS);
}

/** @param {{is_admin?:boolean, pitch_beta?:boolean}} profile */
export function checkAccess(profile = {}) {
  if (profile?.is_admin) return { ok: true };
  if (profile?.pitch_beta) return { ok: true };
  return { ok: false, reason: 'beta' };
}

// Flag experimental (M5): opt-in explícito, a diferencia de STUDIO_GENDER_FLAG (opt-out).
export function choirEnabled() { return process.env.PITCH_CHOIR === 'on'; }

export function validateUploadMeta({ filename, size, mime } = {}) {
  const fail = (msg) => { const e = new Error(msg); e.status = 400; throw e; };
  if (!filename || typeof filename !== 'string') fail('Falta el nombre del archivo');
  if (!Number.isFinite(size) || size <= 0) fail('Tamaño de archivo inválido');
  if (size > MAX_FILE_BYTES) fail('El archivo supera el máximo de 25 MB');
  if (!mime || !AUDIO_MIMES.has(mime)) fail('Formato no soportado: sube MP3, WAV, M4A, FLAC u OGG');
}

// sha256 hex de 64 chars, opcional (compatibilidad hacia atrás: clientes viejos sin
// Web Crypto o falla de cálculo no deben bloquear la subida).
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
export function validateSha256(sha256) {
  if (sha256 === undefined || sha256 === null) return null;
  if (typeof sha256 !== 'string' || !SHA256_HEX_RE.test(sha256)) {
    const e = new Error('sha256 inválido'); e.status = 400; throw e;
  }
  return sha256;
}

const MAX_TITLE_LEN = 120;
export function sanitizeTitle(raw, fallbackFilename = '') {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed) return trimmed.slice(0, MAX_TITLE_LEN);
  const fromFile = String(fallbackFilename).replace(/\.[^/.]+$/, '').trim();
  return (fromFile || 'Audio').slice(0, MAX_TITLE_LEN);
}
