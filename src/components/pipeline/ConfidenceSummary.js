/**
 * ConfidenceSummary.js — resumen transversal de baja confianza del stepper de
 * procesamiento (pipeline unificado, Task 17). Agrega, bajo el header, el
 * aviso de la única fase que hoy produce un resultado que el admin debería
 * revisar: líneas de sincronía con timing `interpolated` o `score` bajo
 * (persistidos por el webhook de align, api/align/webhook.js). Post-F3 el
 * gate de letra es un editor puro (la hoja de revisión), sin conflictos ni
 * discrepancia de estructura que reportar. Cero items -> NO se renderiza
 * nada (ni contenedor vacío): el bloque ámbar solo existe cuando hay algo que
 * revisar. Click en el item hace scroll a la fila del stepper de esa fase
 * (PhaseRow ya expone `data-phase`, Task D3a).
 *
 * Fuente de la sincronía: fetch propio (mismo `getSongAudio` que consume
 * SyncFineTuning) — self-contained, sin wiring compartido entre componentes
 * hermanos del stepper.
 */
import { escapeHtml } from '../../lib/escape.js';
import { icon } from '../../lib/icons.js';
import { getSongAudio } from '../../lib/songAudioApi.js';

// Exportado: SheetStatusStrip.js (hoja viva, Task 7) lo reusa para el
// conteo de renglones «dudosos» — un solo umbral de confianza para todo el
// pipeline, no uno por componente.
export const SCORE_THRESHOLD = 0.6;

/** score puede llegar como string (NUMERIC de Postgres, ver nota de
 * CLAUDE.md) aunque el webhook de align ya lo persiste como number 0-1. */
function parseScore(score) {
  const n = typeof score === 'string' ? Number(score) : score;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function lowConfidenceLineCount(lines) {
  if (!Array.isArray(lines)) return 0;
  return lines.filter((l) => {
    if (l.interpolated === true) return true;
    const score = parseScore(l.score);
    return score !== null && score < SCORE_THRESHOLD;
  }).length;
}

/**
 * @param {{ songId: string, scrollToPhase: (phase: string) => void }} opts
 * @returns {{
 *   el: HTMLElement,
 *   update: (run: object|null) => void,
 *   destroy: () => void,
 * }}
 */
export function createConfidenceSummary({ songId, scrollToPhase }) {
  const el = document.createElement('div');
  el.className = 'confidence-summary';
  el.hidden = true;

  let destroyed = false;
  let timings = null;
  let timingsLoading = false;
  let lastSyncStatus = null;

  // Delegación sobre `el` (nodo estable, no se recrea): un solo listener para
  // toda la vida del componente, sin importar cuántas veces render() rearma
  // el innerHTML.
  el.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-target-phase]');
    if (!btn) return;
    scrollToPhase?.(btn.dataset.targetPhase);
  });

  async function ensureTimings() {
    if (timingsLoading) return;
    timingsLoading = true;
    try {
      const data = await getSongAudio(songId);
      timings = data?.timings ?? null;
    } finally {
      timingsLoading = false;
    }
    if (destroyed) return;
    render();
  }

  function computeItems() {
    const items = [];

    const lowConfidence = lowConfidenceLineCount(timings?.lines);
    if (lowConfidence > 0) {
      items.push({
        phase: 'sync',
        label:
          lowConfidence === 1
            ? '1 línea con sincronía de baja confianza'
            : `${lowConfidence} líneas con sincronía de baja confianza`,
      });
    }

    return items;
  }

  function render() {
    if (destroyed) return;
    const items = computeItems();
    if (items.length === 0) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML = `
      ${icon('triangle-alert', { size: 16, className: 'confidence-summary__icon' })}
      <ul class="confidence-summary__list">
        ${items
          .map(
            (it) => `
          <li>
            <button type="button" class="confidence-summary__item" data-target-phase="${it.phase}">${escapeHtml(it.label)}</button>
          </li>`,
          )
          .join('')}
      </ul>
    `;
  }

  /**
   * @param {object|null} run
   */
  function update(run) {
    if (destroyed) return;

    // Fetch de timings solo cuando sync recién termina (pending/running/stale
    // -> done): evita refetch en cada tick del polling de 3s mientras sync ya
    // está done y nada cambió.
    const syncStatus = run?.phases?.sync?.status ?? null;
    if (syncStatus === 'done' && syncStatus !== lastSyncStatus) {
      ensureTimings();
    } else if (syncStatus !== 'done' && timings !== null) {
      // Un run nuevo dejó sync fuera de 'done': descarta el alignment viejo para
      // no reportar baja confianza de un run superado (mismo criterio que el
      // gate de SyncFineTuning).
      timings = null;
    }
    lastSyncStatus = syncStatus;

    render();
  }

  function destroy() {
    destroyed = true;
    el.innerHTML = '';
  }

  return { el, update, destroy };
}
