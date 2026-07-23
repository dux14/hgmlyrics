/**
 * StructureDetail.js — detalle de la fila "Secciones" del stepper de
 * procesamiento (pipeline unificado, Task 16). Timeline horizontal de los
 * segmentos detectados por SongFormer (`run.structure.segments`, ver Task 8
 * y el adjunto en api/songs/[id]/pipeline.js#getRun) + editor admin-only
 * (label + nudge de bordes ±1s) que llama al PATCH de
 * api/songs/[id]/structure.js (Task 15d). 'structure' es best-effort (ver
 * CRITICAL_PHASES en api/_lib/pipeline/state.js): su fallo nunca bloquea el
 * run, así que acá solo mostramos un estado vacío, sin acción de reintento.
 */
import { escapeHtml } from '../../lib/escape.js';
import { isAdmin } from '../../lib/authStore.js';
import { patchStructure } from '../../lib/pipelineApi.js';
import { showToast } from '../../lib/toast.js';

// 8-class EXACTO de SongFormer (ver SONGFORMER_LABELS en
// api/songs/[id]/structure.js): el PATCH rechaza cualquier label fuera de
// esta lista con 400, así que el <select> no debe ofrecer otras.
const SONGFORMER_LABELS = [
  'intro',
  'verso',
  'coro',
  'puente',
  'instrumental',
  'outro',
  'silencio',
  'pre-coro',
];

// Label de SongFormer -> slug de color de sección. Mapeo EXPLÍCITO (no
// normalizeSectionType/sectionTypes.js): ese normalizador cae en 'verse'
// para cualquier tipo que no reconoce (fallback pensado para datos de letra,
// no para SongFormer), y 'instrumental'/'silencio' terminarían con el color
// de verso por COINCIDENCIA (hoy ambos son neutros) en vez de por intención.
// Acá 'instrumental'/'silencio' (y cualquier label inesperado) van directo a
// 'neutral' (--color-section-neutral, review Task 16 Minor 1).
const LABEL_TO_SECTION_SLUG = {
  intro: 'intro',
  verso: 'verse',
  coro: 'chorus',
  puente: 'bridge',
  instrumental: 'neutral',
  outro: 'outro',
  silencio: 'neutral',
  'pre-coro': 'prechorus',
};

function sectionColorSlug(label) {
  return LABEL_TO_SECTION_SLUG[String(label || '').toLowerCase()] || 'neutral';
}

const NUDGE_MS = 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** mm:ss desde ms. No cappea minutos: un segmento de >60min mostraría "75:00"
 * en vez de romper (Task 16, nota de correctness). */
function formatMmSs(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(totalSec / 60))}:${pad2(totalSec % 60)}`;
}

function displayLabel(label) {
  const s = String(label || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * @param {{ songId: string, onChanged?: () => void }} opts onChanged se
 *   invoca tras un PATCH exitoso, para que el llamador pueda refrescar el
 *   run completo (mismo patrón que UploadPhaseCard#onAfterConfirm).
 * @returns {{ el: HTMLElement, update: (run: object|null) => void, destroy: () => void }}
 */
export function createStructureDetail({ songId, onChanged }) {
  const el = document.createElement('div');
  el.className = 'structure-detail';

  let segments = [];
  let destroyed = false;

  async function applyPatch(segmentIndex, patch) {
    try {
      const res = await patchStructure(songId, { segmentIndex, ...patch });
      if (destroyed) return;
      segments = Array.isArray(res?.segments) ? res.segments : segments;
      render();
      onChanged?.();
    } catch (err) {
      console.error('StructureDetail: no se pudo actualizar la sección', err);
      showToast(err.message || 'No se pudo actualizar la sección', { type: 'error' });
    }
  }

  // Delegación de eventos sobre `el` en vez de un listener por fila: el
  // timeline se reconstruye entero en cada render(), así que atarlos acá
  // (nodo estable) evita re-atar/perder listeners en cada re-pintado.
  el.addEventListener('change', (ev) => {
    const select = ev.target.closest('.struct-edit__label');
    if (!select) return;
    const index = Number(select.closest('[data-seg-index]').dataset.segIndex);
    applyPatch(index, { label: select.value });
  });

  el.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-nudge]');
    if (!btn) return;
    const index = Number(btn.closest('[data-seg-index]').dataset.segIndex);
    const seg = segments[index];
    if (!seg) return;
    const [edge, dir] = btn.dataset.nudge.split(':');
    const delta = dir === 'inc' ? NUDGE_MS : -NUDGE_MS;
    if (edge === 'start') applyPatch(index, { startMs: Math.max(0, seg.startMs + delta) });
    else applyPatch(index, { endMs: Math.max(seg.startMs + 1, seg.endMs + delta) });
  });

  function segmentOptions(current) {
    return SONGFORMER_LABELS.map(
      (l) =>
        `<option value="${l}" ${l === current ? 'selected' : ''}>${escapeHtml(displayLabel(l))}</option>`,
    ).join('');
  }

  function render() {
    if (segments.length === 0) {
      el.innerHTML = '<p class="structure-detail__empty">Aún no hay secciones detectadas</p>';
      return;
    }

    const timeline = segments
      .map((seg) => {
        const slug = sectionColorSlug(seg.label);
        const grow = Math.max(seg.endMs - seg.startMs, 1);
        return `
          <div class="struct-seg" style="flex-grow:${grow}; --seg-color: var(--color-section-${slug})">
            <span class="struct-seg__label">${escapeHtml(displayLabel(seg.label))}</span>
            <span class="struct-seg__range">${formatMmSs(seg.startMs)}–${formatMmSs(seg.endMs)}</span>
          </div>
        `;
      })
      .join('');

    const editor = isAdmin()
      ? segments
          .map(
            (seg, i) => `
          <div class="struct-edit" data-seg-index="${i}">
            <select class="struct-edit__label" aria-label="Tipo de sección">${segmentOptions(seg.label)}</select>
            <div class="struct-edit__nudge">
              <span class="struct-edit__nudge-label">Inicio</span>
              <button type="button" class="struct-edit__btn" data-nudge="start:dec" aria-label="Adelantar inicio 1 segundo">−1s</button>
              <button type="button" class="struct-edit__btn" data-nudge="start:inc" aria-label="Atrasar inicio 1 segundo">+1s</button>
              <span class="struct-edit__nudge-label">Fin</span>
              <button type="button" class="struct-edit__btn" data-nudge="end:dec" aria-label="Adelantar fin 1 segundo">−1s</button>
              <button type="button" class="struct-edit__btn" data-nudge="end:inc" aria-label="Atrasar fin 1 segundo">+1s</button>
            </div>
          </div>
        `,
          )
          .join('')
      : '';

    el.innerHTML = `
      <div class="structure-detail__timeline">${timeline}</div>
      ${editor ? `<div class="structure-detail__editor">${editor}</div>` : ''}
    `;
  }

  function update(run) {
    if (destroyed) return;
    const next = run?.structure?.segments;
    segments = Array.isArray(next) ? next : [];
    render();
  }

  function destroy() {
    destroyed = true;
    el.innerHTML = '';
  }

  return { el, update, destroy };
}
