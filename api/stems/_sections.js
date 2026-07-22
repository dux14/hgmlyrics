/**
 * _sections.js — Constantes y helpers de estado por sección del Estudio DAG.
 * ÚNICA fuente de verdad para los 4 bloques de separación y su ciclo de vida.
 * No tiene dependencias externas; es puro JS funcional para facilitar tests.
 */

export const SECTION_KEYS = ['voiceInstrumental', 'structure', 'leadBacking', 'gender', 'duet'];
export const SECTION_STATUS = ['pending', 'running', 'done', 'failed', 'skipped'];
export const JOB_STATUS = [
  'created',
  'uploaded',
  'processing',
  'done',
  'partial',
  'failed',
  'expired',
];

export const SECTION_OUTPUTS = {
  voiceInstrumental: ['vocals', 'instrumental', 'drums', 'bass', 'guitar', 'piano', 'other'],
  leadBacking: ['lead', 'backing'],
  gender: ['male', 'female'],
  duet: ['voice_a', 'voice_b'],
  // `structure` no genera archivos de audio; el orquestador postea segmentos por webhook.
};

/**
 * STEM_KINDS = kinds que cada sección PUBLICA en `song_stems` (a diferencia de
 * SECTION_OUTPUTS, que documenta el estado del Estudio DAG por job). La
 * `vocals` de `voiceInstrumental` (S1) queda afuera a propósito: S1 la sube
 * como copia de trabajo/scratch, pero la fuente canónica de `tracks.vocals`
 * en el pipeline unificado es `leadBacking` (re-extrae el stem vocal antes de
 * separar lead/backing, ver modal/sections/lead_backing.py). `structure` no
 * tiene entrada acá: no publica kinds de audio, solo segments (fase aparte).
 * Único hogar de este mapa (usado por api/songs/[id]/pipeline/_dispatch.js
 * para armar uploads y por api/_lib/pipeline/stemsAdapter.js para filtrar qué
 * kinds de cada sección llegan a publicarse) — evita que la protección de
 * orden temporal S1→S3 sea la única barrera contra que voiceInstrumental
 * pise song_stems.kind='vocals'.
 */
export const STEM_KINDS = {
  voiceInstrumental: ['instrumental', 'drums', 'bass', 'guitar', 'piano', 'other'],
  leadBacking: ['lead', 'backing', 'vocals'],
  gender: ['male', 'female'],
  duet: ['voice_a', 'voice_b'],
};

export function initSections(enabled) {
  const set = new Set(enabled);
  const mk = (key) => {
    // Fix 2: `retries` cuenta los reintentos manuales disparados vía /retry (tope MAX_RETRIES=3).
    const base = { status: set.has(key) ? 'pending' : 'skipped', model: null, error: null, retries: 0 };
    // `structure` no lleva `enabled` ni `outputs`: solo postea segmentos (forma canónica del spec).
    if (key === 'structure') return { ...base, segments: [] };
    const outputs = Object.fromEntries(SECTION_OUTPUTS[key].map((k) => [k, null]));
    return { ...base, enabled: set.has(key), outputs };
  };
  return Object.fromEntries(SECTION_KEYS.map((k) => [k, mk(k)]));
}

export function applySectionResult(sections, key, result) {
  const prev = sections[key];
  if (prev && prev.status === 'done') return sections; // idempotente
  const next = {
    ...prev,
    status: result.status,
    model: result.model ?? prev.model,
    error: result.error ?? null,
  };
  if (key === 'structure') next.segments = result.segments ?? prev.segments ?? [];
  else next.outputs = { ...prev.outputs, ...(result.outputs ?? {}) };
  return { ...sections, [key]: next };
}

export function deriveJobStatus(sections) {
  const active = SECTION_KEYS.map((k) => sections[k]).filter((s) => s.status !== 'skipped');
  if (active.some((s) => s.status === 'running' || s.status === 'pending')) return 'processing';
  const done = active.filter((s) => s.status === 'done').length;
  const failed = active.filter((s) => s.status === 'failed').length;
  if (failed === 0) return 'done';
  if (done === 0) return 'failed';
  return 'partial';
}

/**
 * Sanea el conjunto de secciones pedido por el cliente.
 * Filtra a SECTION_KEYS, deduplica, respeta el orden canónico y aplica el gate de gender.
 * Lanza { status: 400 } si el resultado queda vacío o el input no es un arreglo.
 * @param {unknown} input
 * @param {{ genderEnabled: boolean }} opts
 * @returns {string[]}
 */
export function validateEnabledSections(input, { genderEnabled } = {}) {
  const fail = (msg) => {
    const e = new Error(msg);
    e.status = 400;
    throw e;
  };
  if (!Array.isArray(input)) fail('enabledSections debe ser un arreglo');
  const requested = new Set(input);
  const result = SECTION_KEYS.filter((key) => {
    if (!requested.has(key)) return false;
    if (key === 'gender' && !genderEnabled) return false;
    return true;
  });
  if (result.length === 0) fail('Selecciona al menos una sección para procesar');
  return result;
}
