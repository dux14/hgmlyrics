// Maquina de estados del DAG del pipeline unificado. Dominio PURO: sin sql,
// sin fetch, sin Date.now (los timestamps los pone el llamador). Patron
// hermano de api/pitch/_lib/state.js pero a nivel cancion.

// 'structure' aquí es la fase del DAG de análisis estructural (SongFormer);
// distinta de la subsección homónima de stems (api/stems/_sections.js).
export const PHASES = ['upload','stems','structure','transcription','lyrics_review','sync','pitch','clips'];

// Fases criticas del DAG (Task 11, robustez): un fallo terminal con
// reintentos agotados en cualquiera de estas SI tumba el run entero. 'structure'
// queda afuera a propósito (best-effort, igual que gender/duet fuera del DAG):
// su fallo nunca bloquea la canción.
export const CRITICAL_PHASES = ['upload','stems','transcription','lyrics_review','sync','pitch','clips'];

export const PHASE_STATUSES = ['pending','running','done','failed','stale'];

export const RUN_STATUSES = ['created','uploading','processing','awaiting_lyrics',
  'running','done','failed','cancelled','superseded'];

const TERMINAL = new Set(['done','failed']);

// Tope de reintentos por fase (spec robustez): el 1.o, 2.o y 3.er retry se
// permiten, el 4.o se rechaza. `retries` cuenta reintentos ya hechos.
export const MAX_RETRIES = 3;

export function retriesLeft(phase) {
  return MAX_RETRIES - (phase?.retries || 0);
}

export function initialPhases() {
  const phases = {};
  for (const ph of PHASES) {
    phases[ph] = { status: 'pending', error: null, tracks: undefined, artifacts: undefined, retries: 0 };
  }
  phases.upload.status = 'running';
  return phases;
}

// Dependencias del DAG (spec, tabla de fases).
const DEPS = {
  upload: () => true,
  stems: (p) => p.upload.status === 'done',
  structure: (p) => p.upload.status === 'done',
  transcription: (p) => p.upload.status === 'done' && Boolean(p.stems.tracks?.vocals),
  lyrics_review: (p) => p.transcription.status === 'done',
  sync: (p) => p.lyrics_review.status === 'done' && Boolean(p.stems.tracks?.vocals),
  pitch: (p) => p.lyrics_review.status === 'done'
    && Boolean(p.stems.tracks?.lead) && Boolean(p.stems.tracks?.backing),
  clips: (p) => p.sync.status === 'done',
};

export function canStartPhase(phases, phase) {
  if (!DEPS[phase]) return false;
  if (phases[phase].status !== 'pending' && phases[phase].status !== 'stale') return false;
  return DEPS[phase](phases);
}

// Evento de webhook de fase. Devuelve el objeto phases NUEVO, o null si el
// evento debe ignorarse (CAS: fase ya terminal => zombie/llegada tardia).
export function applyPhaseEvent(phases, event) {
  const { phase, ok, partial = false, tracks, artifacts, error } = event;
  const cur = phases[phase];
  if (!cur) return null;
  if (TERMINAL.has(cur.status)) {
    // Merge tardío: pistas/artefactos que Modal reporta después de cerrar la
    // fase (ej. drums/bass tras lead) no deben perderse. Solo mergea, el
    // status de la fase terminal queda intacto; eventos no-parciales o
    // fallidos sobre fase terminal se siguen ignorando (zombie). Gatea en
    // 'done' ESTRICTO (no 'failed'): mergear tracks sobre una fase fallida
    // dejaría stems.tracks.vocals presente pese a stems.status='failed', y
    // DEPS.transcription solo chequea el track (no el status) -> avanzaría
    // el run en silencio con una fase crítica fallida.
    if (cur.status === 'done' && ok && partial && (tracks || artifacts)) {
      const next = structuredClone(phases);
      const target = next[phase];
      if (tracks) target.tracks = { ...(target.tracks ?? {}), ...tracks };
      if (artifacts) target.artifacts = { ...(target.artifacts ?? {}), ...artifacts };
      return next;
    }
    return null;
  }
  const next = structuredClone(phases);
  const target = next[phase];
  if (tracks) target.tracks = { ...(target.tracks ?? {}), ...tracks };
  if (artifacts) target.artifacts = { ...(target.artifacts ?? {}), ...artifacts };
  if (!ok) {
    target.status = 'failed';
    target.error = error ?? 'error desconocido';
  } else if (partial) {
    target.status = 'running';
  } else {
    target.status = 'done';
    target.error = null;
  }
  return next;
}

// Cascada al editar la letra aprobada: lo derivado de la letra queda stale.
// `retries` se resetea a 0 (fix Important code review): estas fases se van a
// RE-EJECUTAR en un ciclo nuevo tras el proximo approve, y MAX_RETRIES cuenta
// por ciclo, no acumulado sobre toda la vida del run -- sin el reset, varios
// ciclos reopen->approve con algun fallo transitorio podian agotar el
// presupuesto de un ciclo anterior y tumbar el run a 'failed' terminal en lo
// que el admin percibe como su primer intento del nuevo ciclo.
export function phasesAfterLyricsEdit(phases) {
  const next = structuredClone(phases);
  for (const ph of ['sync','pitch','clips']) {
    if (next[ph].status === 'done' || next[ph].status === 'running') {
      next[ph].status = 'stale';
      next[ph].retries = 0;
    }
  }
  return next;
}

export function runStatusFromPhases(phases) {
  const done = (ph) => phases[ph].status === 'done';
  // Terminal 'failed': alguna fase CRITICA (no best-effort) fallo y ya agoto
  // sus reintentos (retriesLeft<=0). Gana sobre running/awaiting_lyrics — un
  // run con una fase critica muerta no puede seguir bloqueando la cancion
  // como "activo" (regla de 1 run activo por cancion). No puede colisionar
  // con el caso 'done' de abajo: una fase no puede estar 'done' y 'failed' a
  // la vez.
  const anyCriticalExhausted = CRITICAL_PHASES.some(
    (ph) => phases[ph].status === 'failed' && retriesLeft(phases[ph]) <= 0,
  );
  if (anyCriticalExhausted) return 'failed';
  if (done('sync') && done('pitch') && done('clips')) return 'done';
  if (done('transcription') && phases.lyrics_review.status === 'pending') {
    return 'awaiting_lyrics';
  }
  if (phases.lyrics_review.status === 'done') return 'running';
  if (phases.upload.status !== 'done') return 'uploading';
  return 'processing';
}
