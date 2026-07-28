// Clasificador y politica del retry automatico del pipeline (Entrega 2).
// Dominio PURO: sin sql, sin fetch, sin Date.now (igual que state.js). El
// llamador (retryPhase.js, cleanup.js) resuelve el estado real y hace el
// dispatch; este modulo solo decide si corresponde reintentar.
import { retriesLeft } from './state.js';

// Tope de reintentos AUTOMATICOS por fase, independiente del tope MANUAL
// (MAX_RETRIES de state.js). Un reintento automatico consume AMBOS contadores.
export const AUTO_MAX_RETRIES = 2;

// Circuit breaker del run entero: sin este tope, un run con una credencial
// vencida podria disparar hasta PHASES.length * AUTO_MAX_RETRIES jobs de GPU.
export const RUN_AUTO_RETRY_BUDGET = 4;

// Mismo set que RETRYABLE_PHASES de retry.js, menos 'upload' y 'lyrics_review':
// esas dos son intervencion humana, no jobs que se puedan re-despachar solos.
export const AUTO_RETRYABLE_PHASES = new Set([
  'stems',
  'structure',
  'transcription',
  'sync',
  'pitch',
  'clips',
]);

// Patrones de fallo PERMANENTE (case-insensitive): reintentar no cambia el
// resultado. Todo lo demas se trata como transitorio.
// Regla de sesgo (documentada a proposito, la pide el plan): ante la duda,
// preferir 'permanent'. Un falso permanente cuesta un click del admin; un
// falso transitorio quema GPU en loop.
const PERMANENT_PATTERNS = [
  /out of memory/i,
  /\boom\b/i,
  /modal 4\d\d/i,
  /bad inbound secret/i,
  /no configurad/i,
  /falta /i,
];

export function classifyFailure(errorText) {
  const text = errorText ?? '';
  return PERMANENT_PATTERNS.some((re) => re.test(text)) ? 'permanent' : 'transient';
}

// Espejo exacto de retriesLeft (state.js:26), pero sobre el contador
// automatico de la fase.
export function autoRetriesLeft(phase) {
  return AUTO_MAX_RETRIES - (phase?.autoRetries || 0);
}

export function shouldAutoRetry({ phase, phaseState, runAutoRetries, errorText, timeout }) {
  if (!AUTO_RETRYABLE_PHASES.has(phase)) return false;
  // err.timeout === true: el POST de dispatch abortó por timeout de cliente,
  // pero el job puede seguir vivo en Modal (isLateSuccessRescue en state.js o
  // el cron de zombis lo rescatan). Reintentar aca duplicaria el job.
  if (timeout === true) return false;
  if (classifyFailure(errorText) !== 'transient') return false;
  if (autoRetriesLeft(phaseState) <= 0) return false;
  // Un retry automatico consume AMBOS contadores (comentario de arriba en
  // AUTO_MAX_RETRIES): si el presupuesto MANUAL ya esta agotado, tampoco hay
  // margen para uno automatico.
  if (retriesLeft(phaseState) <= 0) return false;
  if (runAutoRetries >= RUN_AUTO_RETRY_BUDGET) return false;
  return true;
}
