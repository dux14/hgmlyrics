// Maquina de estados del DAG del pipeline unificado. Dominio PURO: sin sql,
// sin fetch, sin Date.now (los timestamps los pone el llamador). Patron
// hermano de api/pitch/_lib/state.js pero a nivel cancion.

// 'structure' aquí es la fase del DAG de análisis estructural (SongFormer);
// distinta de la subsección homónima de stems (api/stems/_sections.js).
export const PHASES = ['upload','stems','structure','transcription','lyrics_review','sync','pitch','clips'];

export const PHASE_STATUSES = ['pending','running','done','failed','stale'];

export const RUN_STATUSES = ['created','uploading','processing','awaiting_lyrics',
  'running','done','failed','cancelled','superseded'];

const TERMINAL = new Set(['done','failed']);

export function initialPhases() {
  const phases = {};
  for (const ph of PHASES) {
    phases[ph] = { status: 'pending', error: null, tracks: undefined, artifacts: undefined };
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
export function phasesAfterLyricsEdit(phases) {
  const next = structuredClone(phases);
  for (const ph of ['sync','pitch','clips']) {
    if (next[ph].status === 'done' || next[ph].status === 'running') {
      next[ph].status = 'stale';
    }
  }
  return next;
}

export function runStatusFromPhases(phases) {
  const done = (ph) => phases[ph].status === 'done';
  if (done('sync') && done('pitch') && done('clips')) return 'done';
  if (done('transcription') && phases.lyrics_review.status === 'pending') {
    return 'awaiting_lyrics';
  }
  if (phases.lyrics_review.status === 'done') return 'running';
  if (phases.upload.status !== 'done') return 'uploading';
  return 'processing';
}
