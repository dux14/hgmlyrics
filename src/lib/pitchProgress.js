/** pitchProgress.js — lógica pura de progreso. Duplica REQUIRED_PHASES de
 * api/pitch/_lib/process.js a propósito: el front no importa código de api/. */
export const PHASE_ORDER = ['separation', 'f0', 'notes', 'lyrics', 'fusion', 'render'];
const LABELS = {
  separation: 'Separando voces',
  f0: 'Detectando el tono',
  notes: 'Extrayendo notas',
  lyrics: 'Transcribiendo la letra',
  fusion: 'Uniendo letra y nota',
  render: 'Generando la partitura',
};
export function phaseLabel(phase) {
  return LABELS[phase] ?? phase;
}

export function phaseProgress(phases) {
  const p = phases ?? {};
  let done = 0,
    failed = 0;
  for (const key of PHASE_ORDER) {
    if (p[key]?.status === 'done') done += 1;
    else if (p[key]?.status === 'failed') failed += 1;
  }
  return { done, failed, total: PHASE_ORDER.length, pct: Math.round((done / PHASE_ORDER.length) * 100) };
}

const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'cancelled', 'expired']);
export function isTerminalStatus(status) {
  return TERMINAL.has(status);
}
