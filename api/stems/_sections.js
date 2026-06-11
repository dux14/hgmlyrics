/**
 * _sections.js — Constantes y helpers de estado por sección del Estudio DAG.
 * ÚNICA fuente de verdad para los 4 bloques de separación y su ciclo de vida.
 * No tiene dependencias externas; es puro JS funcional para facilitar tests.
 */

export const SECTION_KEYS = ['voiceInstrumental', 'structure', 'leadBacking', 'gender'];
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
  // `structure` no genera archivos de audio; el orquestador postea segmentos por webhook.
};

export function initSections(enabled) {
  const set = new Set(enabled);
  const mk = (key) => {
    const base = { status: set.has(key) ? 'pending' : 'skipped', model: null, error: null };
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
