/**
 * stemsApi.js — Cliente del Estudio de pistas (api/stems/*).
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
    throw e;
  }
  return body;
}

/** Crea el job y devuelve { job, upload } */
export async function createJob(file) {
  const res = await fetch('/api/stems/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ filename: file.name, size: file.size, mime: file.type }),
  });
  return jsonOrThrow(res);
}

/** Sube el archivo directo a Storage con el token firmado */
export async function uploadInput(upload, file) {
  const { error } = await supabase.storage
    .from('stems-jobs')
    .uploadToSignedUrl(upload.path, upload.token, file);
  if (error) throw new Error('La subida falló. Revisa tu conexión e intenta de nuevo.');
}

export async function startJob(id) {
  const res = await fetch(`/api/stems/jobs/${id}/start`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return jsonOrThrow(res);
}

export async function getJob(id) {
  const res = await fetch(`/api/stems/jobs/${id}`, { headers: authHeaders() });
  return jsonOrThrow(res);
}

export async function listJobs() {
  const res = await fetch('/api/stems/jobs', { headers: authHeaders() });
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
