/**
 * pitchApi.js — Cliente de la Partitura vocal (api/pitch/*).
 */
import { getSession } from './authStore.js';
import { supabase } from './supabase.js';

function authHeaders() {
  const s = getSession();
  return s ? { Authorization: `Bearer ${s.access_token}` } : {};
}

async function jsonOrThrow(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(body.error ?? `Error ${res.status}`);
    e.status = res.status;
    e.reason = body.reason;
    throw e;
  }
  return body;
}

/** Crea el job y devuelve { job, upload }. `title`/`profile` opcionales → input_meta/profile */
export async function createJob(file, { title, profile } = {}) {
  const res = await fetch('/api/pitch/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ filename: file.name, size: file.size, mime: file.type, title, profile }),
  });
  return jsonOrThrow(res);
}

/** Sube el archivo directo a Storage con el token firmado */
export async function uploadInput(upload, file) {
  const { error } = await supabase.storage
    .from('pitch-jobs')
    .uploadToSignedUrl(upload.path, upload.token, file);
  if (error) throw new Error('La subida falló. Revisa tu conexión e intenta de nuevo.');
}

/** Envía la duración leída en el browser; el server calcula el estimado de costo */
export async function estimateJob(id, durationSec) {
  const res = await fetch(`/api/pitch/jobs/${id}/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ durationSec }),
  });
  return jsonOrThrow(res);
}

/** Aprueba el estimado y arranca el procesamiento */
export async function approveJob(id) {
  const res = await fetch(`/api/pitch/jobs/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  return jsonOrThrow(res);
}

export async function cancelJob(id) {
  const res = await fetch(`/api/pitch/jobs/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  return jsonOrThrow(res);
}

/** Reintenta el pipeline completo de un job failed/partial */
export async function retryJob(id) {
  const res = await fetch(`/api/pitch/jobs/${id}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  return jsonOrThrow(res);
}

export async function getJob(id) {
  const res = await fetch(`/api/pitch/jobs/${id}`, { headers: authHeaders() });
  return jsonOrThrow(res);
}

export async function listJobs() {
  const res = await fetch('/api/pitch/jobs', { headers: authHeaders() });
  return jsonOrThrow(res);
}

/**
 * Lee la duración del audio en el browser (límite ~10 min).
 * @param {File} file
 * @returns {Promise<number>} segundos (0 si no se pudo leer; el server no la valida)
 */
export function readAudioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    audio.src = url;
  });
}
