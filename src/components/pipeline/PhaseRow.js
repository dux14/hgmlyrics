/**
 * PhaseRow.js — fila de fase del stepper de procesamiento (Task D3a). Un
 * `.dot` de estado + título + subtítulo + slot de detalle (D3b/D3c montan el
 * contenido real de Audio/Pistas/Sincronía dentro de ese slot). Estados del
 * dot: done (check verde), act (ámbar, requiere acción — cubre failed,
 * stale y letra por revisar), run (cyan, procesando, con loader inline por
 * fase), wait (número, en espera o bloqueada por la letra).
 */
import { icon } from '../../lib/icons.js';
import { escapeHtml } from '../../lib/escape.js';

/** Loader inline por fase mientras corre: ecualizador (stems), notas-bob
 * (pitch), shimmer para el resto (upload/transcription). */
function loaderHtml(key) {
  if (key === 'stems') {
    return '<span class="ph-loader ph-loader--eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
  }
  if (key === 'pitch') {
    return '<span class="ph-loader ph-loader--notes" aria-hidden="true"><i></i><i></i><i></i></span>';
  }
  return '<span class="ph-loader ph-loader--shimmer" aria-hidden="true"></span>';
}

// Mapea el estado semántico (calculado en SongPipelineView) a la clase visual
// del dot: failed/stale/act comparten el mismo tratamiento ámbar de
// "requiere acción"; pending/blocked comparten el tratamiento atenuado.
const DOT_CLASS = {
  done: 'done',
  act: 'act',
  failed: 'act',
  stale: 'act',
  running: 'run',
  pending: 'wait',
  blocked: 'wait',
};

function dotContent(dotClass, index) {
  if (dotClass === 'done') return icon('check', { size: 13 });
  if (dotClass === 'act') return '!';
  if (dotClass === 'run') return '<span class="ph-dot-pulse" aria-hidden="true"></span>';
  return String(index);
}

/**
 * @param {{
 *   key: string,
 *   index: number,
 *   title: string,
 *   subtitle: string,
 *   state: string,
 *   error?: string,
 *   detail?: Node|null,
 *   actionLabel?: string,
 *   onRetry?: (key:string)=>void,
 * }} opts
 * @returns {HTMLElement}
 */
export function PhaseRow({
  key,
  index,
  title,
  subtitle,
  state,
  error = '',
  detail = null,
  actionLabel = 'Reintentar fase',
  onRetry,
}) {
  const dotClass = DOT_CLASS[state] || 'wait';
  // failed/stale siempre ofrecen su accion (reintentar/re-procesar); 'done'
  // también puede traer una (ej. lyrics_review: "Editar letra", Task 13) si
  // el llamador pasa un onRetry explicito — el resto de los estados nunca lo
  // hace, asi que esta condicion no les agrega un boton que no pidieron.
  const showsAction = state === 'failed' || state === 'stale' || typeof onRetry === 'function';

  const row = document.createElement('div');
  row.className = `phase${dotClass === 'act' ? ' phase--action' : ''}`;
  row.dataset.phase = key;
  row.dataset.state = state;

  row.innerHTML = `
    <div class="dot ${dotClass}">${dotContent(dotClass, index)}</div>
    <div class="phase__body">
      <h4 class="phase__title">${escapeHtml(title)}</h4>
      <p class="phase__subtitle">${escapeHtml(subtitle)}${state === 'running' ? loaderHtml(key) : ''}</p>
      ${error ? `<p class="phase__error">${escapeHtml(error)}</p>` : ''}
      ${showsAction ? `<button type="button" class="phase__action">${escapeHtml(actionLabel)}</button>` : ''}
      <div class="phase__detail"></div>
    </div>
  `;

  if (showsAction && typeof onRetry === 'function') {
    row.querySelector('.phase__action').addEventListener('click', () => onRetry(key));
  }

  if (detail) {
    row.querySelector('.phase__detail').appendChild(detail);
  }

  return row;
}
