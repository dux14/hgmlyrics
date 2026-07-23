/**
 * SyncFineTuning.js — detalle de la fila Sincronía del stepper de
 * procesamiento (pipeline unificado, plan D, Task D3d). Ajustes finos por
 * línea (confianza + nudges ±100/±500 ms + guardado) con mini-player propio
 * que reproduce el stem de voz (no el mix) seekeado al inicio de cada línea,
 * más el sub-bloque de metrónomo (BPM/compás/ancla). Adaptado de
 * SongAudioSection.js (editor admin) — duplicación temporal intencional,
 * D6 la reemplaza. NO modificar SongAudioSection.js desde acá.
 */
import { getSongAudio, patchSongAudio, patchLineTiming } from '../../lib/songAudioApi.js';
import { icon } from '../../lib/icons.js';
import { escapeHtml } from '../../lib/escape.js';
import { projectLines } from '../../lib/projectLines.js';
import { showToast } from '../../lib/toast.js';

const TIME_SIGNATURES = ['4/4', '3/4', '6/8', '2/4'];
const FLASH_MS = 500;

// Formato fino m:ss.cc (centésimas) — mismo criterio que el editor de
// corrección por línea del admin.
function formatMsFine(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0:00.00';
  const totalCentiseconds = Math.round(ms / 10);
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const cs = totalCentiseconds % 100;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function truncateLineText(text, max = 40) {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * @param {{ songId: string, getSong?: (() => object|null), getVocalsUrl?: (() => string|null) }} opts
 * @returns {{ el: HTMLElement, refresh: () => Promise<void>, update: (run: object|null) => void, syncSongText: () => void, destroy: () => void }}
 */
export function createSyncFineTuning({ songId, getSong = () => null, getVocalsUrl = () => null }) {
  const el = document.createElement('div');
  el.className = 'sync-tuning';

  const state = { audio: null, timings: null, error: null, loading: true };

  let destroyed = false;
  let lastSyncStatus = null;

  // Corrección manual por línea — mismo patrón que SongAudioSection: índice
  // canónico expandido, startMs propuesto y línea sonando (para resaltar).
  let expandedI = null;
  let proposedMs = null;
  let playingI = null;
  let flashI = null;
  let flashTimer = null;

  // Mini-player: un solo <audio> lazy para el stem de voz, recreado solo si
  // la URL firmada cambió.
  let previewAudio = null;
  let previewUrl = null;

  let metronomeBaseline = null;
  // Cierra el guard de update(): mientras haya un valor de metrónomo
  // tecleado sin guardar, un refresh() automático (sync que vuelve a
  // "done" via retry + watcher) no debe reescribir el sub-bloque y
  // descartarlo.
  let metronomeDirty = false;

  function sortedTimingLines() {
    return [...(state.timings?.lines || [])].sort((a, b) => (a.i ?? 0) - (b.i ?? 0));
  }

  function lineBounds(i) {
    const sorted = sortedTimingLines();
    const idx = sorted.findIndex((l) => l.i === i);
    const prev = idx > 0 ? sorted[idx - 1] : null;
    const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;
    const durationSec = state.audio?.durationSec;
    const min = prev ? prev.startMs + 1 : 0;
    const max = next
      ? next.startMs - 1
      : Number.isFinite(durationSec)
        ? durationSec * 1000
        : Infinity;
    return { min, max };
  }

  function clampProposedMs(i, ms) {
    const { min, max } = lineBounds(i);
    return Math.min(max, Math.max(min, ms));
  }

  function projectedTextMap() {
    const song = getSong?.();
    if (!song) return new Map();
    try {
      return new Map(projectLines(song, {}).map((l) => [l.i, l.text]));
    } catch {
      return new Map();
    }
  }

  function dotClass(l) {
    if (l.manual === true) return 'man';
    if (l.interpolated === true) return 'int';
    return 'hi';
  }

  function lineEditorMarkup(l, i) {
    const originalMs = l.startMs ?? 0;
    const { min, max } = lineBounds(i);
    const current = proposedMs ?? originalMs;
    const minusDisabled = current <= min;
    const plusDisabled = Number.isFinite(max) && current >= max;
    const hasVocals = !!getVocalsUrl?.();
    const isPlaying = playingI === i && previewAudio && !previewAudio.paused;
    return `
      <div class="lineRow__editor">
        <button class="btn btn--secondary" data-action="line-listen" type="button" ${hasVocals ? '' : 'disabled'}>${icon(isPlaying ? 'pause' : 'play', { size: 14 })} Escuchar desde aquí</button>
        <div class="lineRow__nudge" role="group" aria-label="Ajustar inicio de la línea">
          <button data-action="line-nudge" data-delta="-500" type="button" ${minusDisabled ? 'disabled' : ''}>−500</button>
          <button data-action="line-nudge" data-delta="-100" type="button" ${minusDisabled ? 'disabled' : ''}>−100</button>
          <span class="lineRow__ms">${escapeHtml(formatMsFine(current))}</span>
          <button data-action="line-nudge" data-delta="100" type="button" ${plusDisabled ? 'disabled' : ''}>+100</button>
          <button data-action="line-nudge" data-delta="500" type="button" ${plusDisabled ? 'disabled' : ''}>+500</button>
        </div>
        <div class="lineRow__editor-actions">
          <button class="btn btn--primary" data-action="line-save" type="button" ${current === originalMs ? 'disabled' : ''}>Guardar</button>
          <button class="btn btn--secondary" data-action="line-cancel" type="button">Descartar</button>
        </div>
      </div>
    `;
  }

  function linesMarkup(timings) {
    const lines = timings.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      return '<p class="sync-tuning__hint">Todavía no hay líneas ancladas</p>';
    }
    const anchored = lines.filter((l) => l.interpolated !== true).length;
    const manualCount = lines.filter((l) => l.manual === true).length;
    const textByI = projectedTextMap();
    const rows = [...lines]
      .sort((a, b) => (a.i ?? 0) - (b.i ?? 0))
      .map((l) => {
        const i = l.i ?? 0;
        const cls = dotClass(l);
        const labelText = truncateLineText(l.text ?? textByI.get(i) ?? null) ?? `Línea ${i + 1}`;
        const rowClasses = ['lineRow'];
        if (playingI === i) rowClasses.push('lineRow--playing');
        if (flashI === i) rowClasses.push('lineRow--flash');
        const editorHtml = expandedI === i ? lineEditorMarkup(l, i) : '';
        return `
          <li class="${rowClasses.join(' ')}">
            <div class="lineRow__header" data-action="line-expand" data-i="${i}" role="button" tabindex="0" aria-expanded="${expandedI === i}">
              <span class="cdot ${cls}" aria-hidden="true"></span>
              <span class="lineRow__label">${escapeHtml(labelText)}</span>
              <span class="lineRow__time">${escapeHtml(formatMsFine(l.startMs ?? 0))}</span>
            </div>
            ${editorHtml}
          </li>
        `;
      })
      .join('');
    return `
      <ul class="sync-tuning__legend">
        <li><span class="cdot hi" aria-hidden="true"></span>Alineada</li>
        <li><span class="cdot int" aria-hidden="true"></span>Interpolada</li>
        <li><span class="cdot man" aria-hidden="true"></span>Ajuste manual</li>
      </ul>
      <p class="sync-tuning__summary">${anchored} de ${lines.length} líneas ancladas · ${manualCount} corregidas a mano</p>
      <ul class="sync-tuning__lines">${rows}</ul>
    `;
  }

  function metronomeMarkup(audio, timings) {
    const bpmDetected = timings.bpmDetected;
    const bpmDetectedText = Number.isFinite(bpmDetected) ? String(bpmDetected) : 'sin detección';
    const bpmManualValue = escapeHtml(String(audio?.bpmManual ?? ''));
    const timeSignature = audio?.timeSignature ?? '4/4';
    const beatAnchorValue = escapeHtml(String(audio?.beatAnchor ?? ''));
    const options = TIME_SIGNATURES.map(
      (ts) =>
        `<option value="${escapeHtml(ts)}"${ts === timeSignature ? ' selected' : ''}>${escapeHtml(ts)}</option>`,
    ).join('');
    return `
      <div class="sync-tuning__metronome">
        <h4 class="sync-tuning__metronome-title">Editar BPM y compás</h4>
        <p class="sync-tuning__bpm-detected">BPM detectado: ${escapeHtml(bpmDetectedText)}</p>
        <label class="sync-tuning__field">
          BPM manual
          <input type="number" class="sync-tuning__bpm-manual" value="${bpmManualValue}" />
        </label>
        <label class="sync-tuning__field">
          Compás
          <select class="sync-tuning__time-signature">${options}</select>
        </label>
        <label class="sync-tuning__field">
          Ancla del compás
          <input type="number" min="1" max="12" class="sync-tuning__beat-anchor" value="${beatAnchorValue}" />
        </label>
        <button class="btn btn--secondary" data-action="sync-tuning-save-metronome" type="button" disabled>Guardar ajustes</button>
      </div>
    `;
  }

  function clearFlashSoon(i) {
    if (flashTimer) clearTimeout(flashTimer);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduceMotion) {
      flashI = null;
      return;
    }
    flashTimer = setTimeout(() => {
      if (destroyed) return;
      if (flashI === i) flashI = null;
      render();
    }, FLASH_MS);
  }

  function render() {
    if (destroyed) return;

    if (state.loading && !state.timings) {
      el.innerHTML = '<p class="sync-tuning__hint">Cargando sincronía...</p>';
      return;
    }

    if (state.timings?.status !== 'ready') {
      el.innerHTML = `
        <p class="sync-tuning__hint">La sincronía todavía no está lista</p>
        ${state.error ? `<p class="sync-tuning__error" role="alert">${escapeHtml(state.error)}</p>` : ''}
      `;
      return;
    }

    el.innerHTML = `
      ${linesMarkup(state.timings)}
      ${metronomeMarkup(state.audio, state.timings)}
      ${state.error ? `<p class="sync-tuning__error" role="alert">${escapeHtml(state.error)}</p>` : ''}
    `;
    wireMetronome();
  }

  function wireMetronome() {
    const wrap = el.querySelector('.sync-tuning__metronome');
    if (!wrap) return;
    const bpmInput = wrap.querySelector('.sync-tuning__bpm-manual');
    const tsSelect = wrap.querySelector('.sync-tuning__time-signature');
    const anchorInput = wrap.querySelector('.sync-tuning__beat-anchor');
    const saveBtn = wrap.querySelector('[data-action="sync-tuning-save-metronome"]');

    metronomeBaseline = {
      bpmManual: state.audio?.bpmManual ?? null,
      timeSignature: state.audio?.timeSignature ?? '4/4',
      beatAnchor: state.audio?.beatAnchor ?? null,
    };
    metronomeDirty = false;

    function currentValues() {
      return {
        bpmManual: bpmInput.value === '' ? null : Number(bpmInput.value),
        timeSignature: tsSelect.value,
        beatAnchor: anchorInput.value === '' ? null : Number(anchorInput.value),
      };
    }

    function updateDirty() {
      const cur = currentValues();
      const dirty =
        cur.bpmManual !== metronomeBaseline.bpmManual ||
        cur.timeSignature !== metronomeBaseline.timeSignature ||
        cur.beatAnchor !== metronomeBaseline.beatAnchor;
      saveBtn.disabled = !dirty;
      metronomeDirty = dirty;
    }

    [bpmInput, tsSelect, anchorInput].forEach((input) => {
      input.addEventListener('input', updateDirty);
      input.addEventListener('change', updateDirty);
    });

    saveBtn.addEventListener('click', () => {
      const cur = currentValues();
      const changes = {};
      if (cur.bpmManual !== metronomeBaseline.bpmManual) changes.bpmManual = cur.bpmManual;
      if (cur.timeSignature !== metronomeBaseline.timeSignature) {
        changes.timeSignature = cur.timeSignature;
      }
      if (cur.beatAnchor !== metronomeBaseline.beatAnchor) changes.beatAnchor = cur.beatAnchor;
      if (Object.keys(changes).length === 0) return;
      saveBtn.disabled = true;
      saveMetronome(changes);
    });
  }

  async function saveMetronome(changes) {
    state.error = null;
    try {
      await patchSongAudio(songId, changes);
      await refresh();
    } catch (err) {
      state.error = err.message || 'No se pudo guardar el ajuste';
      showToast(state.error, { type: 'error' });
      render();
    }
  }

  async function refresh() {
    if (destroyed || !songId) return;
    try {
      const result = await getSongAudio(songId);
      if (destroyed) return;
      state.audio = result?.audio ?? null;
      state.timings = result?.timings ?? null;
      state.error = null;
      state.loading = false;
      render();
    } catch {
      if (destroyed) return;
      state.error = 'No se pudo consultar el estado de la sincronía';
      state.loading = false;
      render();
    }
  }

  function collapseLine() {
    expandedI = null;
    proposedMs = null;
    previewAudio?.pause();
  }

  function expandLine(i) {
    if (expandedI === i) {
      collapseLine();
      return;
    }
    const line = sortedTimingLines().find((l) => l.i === i);
    previewAudio?.pause();
    expandedI = i;
    proposedMs = line ? clampProposedMs(i, line.startMs ?? 0) : 0;
  }

  function nudgeLine(deltaStr) {
    if (expandedI === null || proposedMs === null) return;
    proposedMs = clampProposedMs(expandedI, proposedMs + Number(deltaStr));
  }

  function onPreviewPause() {
    if (playingI !== null) {
      playingI = null;
      render();
    }
  }

  function listenFromLine() {
    if (expandedI === null || proposedMs === null) return;
    const url = getVocalsUrl?.();
    if (!url) {
      showToast('Todavía no hay pista de voz disponible', { type: 'error' });
      return;
    }
    if (!previewAudio || previewUrl !== url) {
      previewAudio?.removeEventListener('pause', onPreviewPause);
      previewAudio?.removeEventListener('ended', onPreviewPause);
      previewAudio = new Audio();
      // crossOrigin antes del src: sin esto la respuesta cors del SW llega
      // opaca al <audio> y falla con MEDIA_ELEMENT_ERROR (4).
      previewAudio.crossOrigin = 'anonymous';
      previewAudio.src = url;
      previewUrl = url;
      previewAudio.addEventListener('pause', onPreviewPause);
      previewAudio.addEventListener('ended', onPreviewPause);
    }
    if (!previewAudio.paused) {
      previewAudio.pause();
      return;
    }
    playingI = expandedI;
    previewAudio.currentTime = proposedMs / 1000;
    previewAudio.play().catch(() => {});
    render();
  }

  async function saveLineTiming() {
    if (expandedI === null || proposedMs === null) return;
    const savedI = expandedI;
    const savedMs = proposedMs;
    state.error = null;
    previewAudio?.pause();
    try {
      await patchLineTiming(songId, savedI, savedMs);
      expandedI = null;
      proposedMs = null;
      flashI = savedI;
      await refresh();
      clearFlashSoon(savedI);
    } catch (err) {
      state.error = err.message || 'No se pudo guardar la corrección';
      showToast(state.error, { type: 'error' });
      render();
    }
  }

  el.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'line-expand') {
      expandLine(Number(target.dataset.i));
      render();
    } else if (target.dataset.action === 'line-nudge') {
      nudgeLine(target.dataset.delta);
      render();
    } else if (target.dataset.action === 'line-listen') {
      listenFromLine();
    } else if (target.dataset.action === 'line-cancel') {
      collapseLine();
      render();
    } else if (target.dataset.action === 'line-save') {
      saveLineTiming();
    }
  });

  // La cabecera de cada línea es un <div role="button"> (no un <button> real,
  // para no anidar el botón "Escuchar desde aquí" dentro): Enter/Espacio
  // disparan la misma acción line-expand que el click.
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('[data-action="line-expand"]');
    if (!target) return;
    e.preventDefault();
    expandLine(Number(target.dataset.i));
    render();
  });

  render();
  if (songId) refresh();

  return {
    el,
    refresh,
    update(run) {
      const status = run?.phases?.sync?.status ?? null;
      const becameDone = status === 'done' && lastSyncStatus !== 'done';
      lastSyncStatus = status;
      // Evita pisar el estado local mientras el admin está editando una
      // línea o tiene un valor de metrónomo sin guardar: el próximo
      // refresh() disparado por un evento real (guardar, descartar) ya
      // trae la sincronía al día.
      if (becameDone && expandedI === null && !metronomeDirty) refresh();
    },
    // A7 fix: la carrera SongPipelineView vs. este componente — el watcher
    // del run puede consumir la transición pending→done de `update()` ANTES
    // de que `getSong()` tenga la canción (fetch async más lento), dejando
    // `lastSyncStatus` en 'done' para siempre y sin otro disparador que
    // vuelva a leer `getSong()`. syncSongText() es el camino adicional: lo
    // llama SongPipelineView cuando su fetch de la canción resuelve, para
    // forzar un repintado incondicional (sin depender de una transición de
    // status) que sí re-lee getSong()/projectedTextMap(). Mismo guard que
    // update() para no pisar una edición local en curso.
    syncSongText() {
      if (destroyed) return;
      if (expandedI === null && !metronomeDirty) render();
    },
    destroy() {
      destroyed = true;
      if (flashTimer) clearTimeout(flashTimer);
      previewAudio?.pause();
      previewAudio?.removeEventListener('pause', onPreviewPause);
      previewAudio?.removeEventListener('ended', onPreviewPause);
      previewAudio = null;
    },
  };
}
