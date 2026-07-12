/**
 * SongAudioSection.js — sección "Audio y sincronía" del editor (admin).
 * Estados: disabled (sin songId) | empty | uploading | withAudio (status
 * timings: pending|processing|ready|failed). Polling: GET cada 5s SOLO
 * mientras status es pending/processing y document.visibilityState ===
 * 'visible'; se detiene en ready/failed y en destroy().
 */
import {
  getSongAudio,
  createSongAudioUpload,
  confirmSongAudio,
  deleteSongAudio,
  uploadSongAudioFile,
  patchSongAudio,
  patchLineTiming,
} from '../../lib/songAudioApi.js';
import { readAudioDuration } from '../../lib/stemsApi.js';
import { confirmDialog } from '../ConfirmDialog.js';
import { icon } from '../../lib/icons.js';
import { escapeHtml } from '../../lib/escape.js';
import { projectLines } from '../../lib/projectLines.js';

const SONG_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
const POLL_INTERVAL_MS = 5000;
const TIME_SIGNATURES = ['4/4', '3/4', '6/8', '2/4'];

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Formato fino m:ss.cc (centésimas) para el editor de corrección por línea.
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

function syncStatusMarkup(timings) {
  const status = timings?.status;
  if (status === 'ready') {
    const n = Array.isArray(timings.lines) ? timings.lines.length : 0;
    return `<p class="song-audio__sync song-audio__sync--ready">Sincronía: lista (${n} líneas)</p>`;
  }
  if (status === 'failed') {
    return `
      <p class="song-audio__sync song-audio__sync--failed">Sincronía: error — ${escapeHtml(timings.error || 'desconocido')}</p>
      <button class="btn btn--secondary" data-action="song-audio-retry" type="button">${icon('rotate-ccw', { size: 14 })} Reintentar sincronía</button>
    `;
  }
  // pending | processing | ausente (recién confirmado, aún sin fila de timings)
  return '<p class="song-audio__sync song-audio__sync--pending">Sincronía: procesando…</p>';
}

/**
 * Sub-bloque "Metrónomo": solo con sincronía lista. Muestra el BPM detectado
 * (referencia de solo lectura) y los 3 controles de override, precargados
 * de audio.bpmManual/timeSignature/beatAnchor. El botón de guardar arranca
 * deshabilitado; wireMetronome() lo habilita al detectar cambios.
 */
function metronomeMarkup(audio, timings) {
  if (timings?.status !== 'ready') return '';
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
    <div class="song-audio__metronome">
      <h3 class="song-audio__metronome-title">Metrónomo</h3>
      <p class="song-audio__bpm-detected">BPM detectado: ${escapeHtml(bpmDetectedText)}</p>
      <label class="song-audio__field">
        BPM manual
        <input type="number" class="song-audio__bpm-manual" value="${bpmManualValue}" />
      </label>
      <label class="song-audio__field">
        Compás
        <select class="song-audio__time-signature">${options}</select>
      </label>
      <label class="song-audio__field">
        Ancla del compás
        <input type="number" min="1" max="12" class="song-audio__beat-anchor" value="${beatAnchorValue}" />
      </label>
      <button class="btn btn--secondary" data-action="song-audio-save-metronome" type="button" disabled>Guardar ajustes</button>
    </div>
  `;
}

/**
 * @param {{ songId: string|null, getSong?: (() => object|null)|null }} opts
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function createSongAudioSection({ songId, getSong = null }) {
  const el = document.createElement('div');
  el.className = 'editor__section song-audio-section';

  const state = {
    audio: null,
    timings: null,
    uploading: false,
    error: null,
  };

  let pollTimer = null;
  let destroyed = false;
  // Snapshot de los valores cargados en los inputs del metrónomo — se
  // recalcula en cada render() del sub-bloque (que solo ocurre en ready, sin
  // polling espontáneo) para saber qué tocó el usuario.
  let metronomeBaseline = null;

  // Corrección manual (spec offset-manual-linea): indice canonico de la fila
  // expandida (null = ninguna), startMs propuesto de esa fila y el <audio> de
  // preview UNICO del componente (lazy, src = state.audio.url firmada).
  let expandedI = null;
  let proposedMs = null;
  let previewAudio = null;

  // Líneas de state.timings ordenadas por índice canónico (para hallar
  // vecinas al clampear el startMs propuesto).
  function sortedTimingLines() {
    return [...(state.timings?.lines || [])].sort((a, b) => (a.i ?? 0) - (b.i ?? 0));
  }

  // Límites [min, max] en ms para la línea `i`: pisa contra la vecina previa
  // (+1ms) y la siguiente (-1ms); en los extremos, 0 y la duración del audio
  // (sin techo si la duración no se conoce aún).
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

  // Proyecta la canción actual (si hay getSong) a un mapa índice→texto para
  // mostrar la línea real en vez de "Línea N" en el bloque de confianza.
  function projectedTextMap() {
    if (typeof getSong !== 'function') return new Map();
    const song = getSong();
    if (!song) return new Map();
    try {
      return new Map(projectLines(song, {}).map((l) => [l.i, l.text]));
    } catch {
      return new Map();
    }
  }

  function lineEditorMarkup(l, i) {
    const originalMs = l.startMs ?? 0;
    const { min, max } = lineBounds(i);
    const current = proposedMs ?? originalMs;
    const minusDisabled = current <= min;
    const plusDisabled = Number.isFinite(max) && current >= max;
    return `
      <div class="audio-line__editor">
        <button class="btn btn--secondary" data-action="line-listen" type="button">${icon('play', { size: 14 })} Escuchar desde aquí</button>
        <div class="audio-line__nudge" role="group" aria-label="Ajustar inicio de la línea">
          <button data-action="line-nudge" data-delta="-500" type="button" ${minusDisabled ? 'disabled' : ''}>−500</button>
          <button data-action="line-nudge" data-delta="-100" type="button" ${minusDisabled ? 'disabled' : ''}>−100</button>
          <span class="audio-line__ms">${escapeHtml(formatMsFine(current))}</span>
          <button data-action="line-nudge" data-delta="100" type="button" ${plusDisabled ? 'disabled' : ''}>+100</button>
          <button data-action="line-nudge" data-delta="500" type="button" ${plusDisabled ? 'disabled' : ''}>+500</button>
        </div>
        <div class="audio-line__editor-actions">
          <button class="btn btn--primary" data-action="line-save" type="button" ${current === originalMs ? 'disabled' : ''}>Guardar</button>
          <button class="btn btn--secondary" data-action="line-cancel" type="button">Descartar</button>
        </div>
      </div>
    `;
  }

  /**
   * Sub-bloque "Confianza por línea": solo con sincronía lista y al menos
   * una línea. Resumen de cuántas líneas ancló WhisperX directamente (no
   * interpoladas) + cuántas fueron corregidas a mano + una fila por línea
   * con su score, texto real (si hay getSong) y un panel de corrección
   * expandible.
   */
  function confidenceMarkup(timings) {
    if (timings?.status !== 'ready') return '';
    const lines = timings.lines;
    if (!Array.isArray(lines) || lines.length === 0) return '';
    const anchored = lines.filter((l) => l.interpolated !== true).length;
    const manualCount = lines.filter((l) => l.manual === true).length;
    const textByI = projectedTextMap();
    const rows = lines
      .map((l) => {
        const i = l.i ?? 0;
        const isManual = l.manual === true;
        const isOk = typeof l.score === 'number' && l.score >= 0.75 && l.interpolated !== true;
        const statusClass = isManual
          ? 'audio-line--manual'
          : isOk
            ? 'audio-line--ok'
            : 'audio-line--warn';
        const time = formatDuration((l.startMs ?? 0) / 1000);
        const labelText = truncateLineText(textByI.get(i) ?? null) ?? `Línea ${i + 1}`;
        const warnText = isManual
          ? 'Corregida a mano'
          : l.interpolated === true
            ? 'Línea interpolada — revisar'
            : 'Confianza baja — revisar';
        const showSr = isManual || !isOk;
        const editorHtml = expandedI === i ? lineEditorMarkup(l, i) : '';
        return `
          <li class="audio-line ${statusClass}">
            <div class="audio-line__header" data-action="line-expand" data-i="${i}" role="button" tabindex="0">
              <span class="audio-line__dot" aria-hidden="true"></span>
              <span class="audio-line__label">${escapeHtml(labelText)} · ${escapeHtml(time)}</span>
              ${showSr ? `<span class="sr-only">${escapeHtml(warnText)}</span>` : ''}
            </div>
            ${editorHtml}
          </li>
        `;
      })
      .join('');
    return `
      <div class="song-audio__confidence">
        <h3 class="song-audio__confidence-title">Confianza por línea</h3>
        <p class="song-audio__confidence-summary">${anchored} de ${lines.length} líneas ancladas directamente${manualCount > 0 ? ` · ${manualCount} corregidas a mano` : ''}</p>
        <ul class="song-audio__confidence-list">${rows}</ul>
      </div>
    `;
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function syncPolling() {
    const status = state.timings?.status;
    const shouldPoll = status === 'pending' || status === 'processing';
    if (shouldPoll && !pollTimer) {
      pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') refresh();
      }, POLL_INTERVAL_MS);
    } else if (!shouldPoll) {
      stopPolling();
    }
  }

  /**
   * GET del estado del audio. getSongAudio() documenta que nunca lanza (null
   * silencioso ante cualquier fallo), pero el polling igual se defiende con
   * try/catch: así, si algún día deja de cumplir ese contrato (o en tests que
   * la mockean para rechazar), nunca queda un unhandled rejection ni un
   * intervalo "zombie" reintentando en silencio sin nunca re-renderizar.
   * Política elegida: el polling SIGUE vivo tras un error (no se detiene) —
   * el error se muestra inline y el siguiente tick vuelve a intentar solo.
   */
  async function refresh() {
    if (destroyed || !songId) return;
    try {
      const result = await getSongAudio(songId);
      if (destroyed) return;
      state.audio = result?.audio ?? null;
      state.timings = result?.timings ?? null;
      state.error = null;
      render();
    } catch {
      if (destroyed) return;
      state.error = 'No se pudo consultar el estado del audio';
      render();
    }
  }

  /**
   * Si hay correcciones manuales vivas, pide confirmación antes de un flujo
   * que relanza el alignment (re-subida o retry): el webhook pisa lines
   * completo y las correcciones se pierden (semántica elegida en el spec).
   * @returns {Promise<boolean>} true si se puede continuar.
   */
  async function confirmLosingManualLines() {
    const manualCount = Array.isArray(state.timings?.lines)
      ? state.timings.lines.filter((l) => l.manual === true).length
      : 0;
    if (manualCount === 0) return true;
    return confirmDialog({
      title: 'Se perderán correcciones manuales',
      body: `La nueva sincronía descarta ${manualCount} ${manualCount === 1 ? 'corrección manual' : 'correcciones manuales'} de línea.`,
      confirmLabel: 'Continuar',
      danger: true,
    });
  }

  async function uploadFlow(file) {
    if (!songId) return;
    if (file.type !== 'audio/mpeg') {
      state.error = 'Solo se admite mp3';
      render();
      return;
    }
    if (file.size > SONG_AUDIO_MAX_BYTES) {
      state.error = 'El archivo supera el límite de 25 MB';
      render();
      return;
    }
    if (!(await confirmLosingManualLines())) return;
    state.error = null;
    state.uploading = true;
    render();
    try {
      const durationSec = await readAudioDuration(file);
      const { uploadUrl } = await createSongAudioUpload(songId);
      await uploadSongAudioFile(uploadUrl, file);
      await confirmSongAudio(songId, durationSec);
      await refresh();
    } catch (err) {
      state.error = err.message || 'No se pudo subir el audio';
    } finally {
      state.uploading = false;
      render();
    }
  }

  async function retrySync() {
    if (!songId) return;
    if (!(await confirmLosingManualLines())) return;
    state.error = null;
    try {
      await confirmSongAudio(songId, state.audio?.durationSec ?? null);
      await refresh();
    } catch (err) {
      state.error = err.message || 'No se pudo reintentar la sincronía';
      render();
    }
  }

  /**
   * @param {Record<string, unknown>} changes payload PATCH (valores parseados)
   * @param {{bpmManual: string, timeSignature: string, beatAnchor: string}} typedRaw
   *   valores tal cual estaban escritos en los inputs al momento del click —
   *   si el PATCH falla, render() reconstruye el sub-bloque desde state.audio
   *   (sin cambios) y borraría lo que el admin tecleó; los reinyectamos.
   */
  async function saveMetronome(changes, typedRaw) {
    if (Object.keys(changes).length === 0) return;
    state.error = null;
    try {
      await patchSongAudio(songId, changes);
      await refresh();
    } catch (err) {
      state.error = err.message || 'No se pudo guardar el ajuste';
      render();
      restoreMetronomeInputs(typedRaw);
    }
  }

  function restoreMetronomeInputs(typedRaw) {
    const wrap = el.querySelector('.song-audio__metronome');
    if (!wrap) return;
    const bpmInput = wrap.querySelector('.song-audio__bpm-manual');
    const tsSelect = wrap.querySelector('.song-audio__time-signature');
    const anchorInput = wrap.querySelector('.song-audio__beat-anchor');
    if (bpmInput) bpmInput.value = typedRaw.bpmManual;
    if (tsSelect) tsSelect.value = typedRaw.timeSignature;
    if (anchorInput) anchorInput.value = typedRaw.beatAnchor;
    // updateDirty() vive dentro de wireMetronome (recreada por el render() de
    // arriba); un evento 'input' la dispara por el listener ya cableado y
    // reactiva el botón Guardar contra la baseline sin tocar (no cambió).
    bpmInput?.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function wireMetronome() {
    const wrap = el.querySelector('.song-audio__metronome');
    if (!wrap) return;
    const bpmInput = wrap.querySelector('.song-audio__bpm-manual');
    const tsSelect = wrap.querySelector('.song-audio__time-signature');
    const anchorInput = wrap.querySelector('.song-audio__beat-anchor');
    const saveBtn = wrap.querySelector('[data-action="song-audio-save-metronome"]');

    metronomeBaseline = {
      bpmManual: state.audio?.bpmManual ?? null,
      timeSignature: state.audio?.timeSignature ?? '4/4',
      beatAnchor: state.audio?.beatAnchor ?? null,
    };

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
    }

    [bpmInput, tsSelect, anchorInput].forEach((input) => {
      input.addEventListener('input', updateDirty);
      input.addEventListener('change', updateDirty);
    });

    saveBtn.addEventListener('click', () => {
      const cur = currentValues();
      const changes = {};
      if (cur.bpmManual !== metronomeBaseline.bpmManual) {
        changes.bpmManual = cur.bpmManual;
      }
      if (cur.timeSignature !== metronomeBaseline.timeSignature) {
        changes.timeSignature = cur.timeSignature;
      }
      if (cur.beatAnchor !== metronomeBaseline.beatAnchor) {
        changes.beatAnchor = cur.beatAnchor;
      }
      if (Object.keys(changes).length === 0) return;
      const typedRaw = {
        bpmManual: bpmInput.value,
        timeSignature: tsSelect.value,
        beatAnchor: anchorInput.value,
      };
      // Evita doble submit mientras el PATCH+refresh está en vuelo. Se
      // reactiva solo: el render() posterior (éxito) reconstruye el botón
      // deshabilitado por defecto, y el error path lo reactiva vía
      // restoreMetronomeInputs() si el ajuste sigue siendo distinto.
      saveBtn.disabled = true;
      saveMetronome(changes, typedRaw);
    });
  }

  async function deleteFlow() {
    if (!songId) return;
    const ok = await confirmDialog({
      title: 'Eliminar audio',
      body: 'Se borra el mp3 y su sincronía de letra.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteSongAudio(songId);
      state.audio = null;
      state.timings = null;
      state.error = null;
      stopPolling();
    } catch (err) {
      state.error = err.message || 'No se pudo eliminar el audio';
    }
    render();
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

  function listenFromLine() {
    if (expandedI === null || proposedMs === null || !state.audio?.url) return;
    // Recrea el preview si aun no existe o si la URL firmada rotó (refresh /
    // sesión larga) — evita apuntar a una URL vencida.
    if (!previewAudio || previewAudio.src !== state.audio.url) {
      previewAudio = new Audio(state.audio.url);
    }
    if (!previewAudio.paused) {
      previewAudio.pause();
      return;
    }
    previewAudio.currentTime = proposedMs / 1000;
    previewAudio.play().catch(() => {});
  }

  async function saveLineTiming() {
    if (expandedI === null || proposedMs === null) return;
    state.error = null;
    previewAudio?.pause();
    try {
      await patchLineTiming(songId, expandedI, proposedMs);
      expandedI = null;
      proposedMs = null;
      await refresh();
    } catch (err) {
      state.error = err.message || 'No se pudo guardar la corrección';
      render();
    }
  }

  function uploadControlMarkup(label) {
    if (state.uploading) {
      return `<span class="btn btn--secondary song-audio__file-btn" aria-disabled="true">Subiendo...</span>`;
    }
    return `
      <label class="btn btn--secondary song-audio__file-btn">
        ${icon('upload', { size: 16 })} ${label}
        <input type="file" accept="audio/mpeg,.mp3" hidden data-action="song-audio-file" />
      </label>
    `;
  }

  function render() {
    if (destroyed) return;

    if (!songId) {
      el.innerHTML = `
        <h2 class="editor__section-title">Audio y sincronía</h2>
        <p class="song-audio__hint">Guarda la canción para subir el audio</p>
        <button class="btn btn--secondary song-audio__file-btn" type="button" disabled>${icon('upload', { size: 16 })} Subir mp3</button>
      `;
      return;
    }

    if (!state.audio) {
      el.innerHTML = `
        <h2 class="editor__section-title">Audio y sincronía</h2>
        <p class="song-audio__hint">Sube el mp3 completo. La letra se sincroniza automáticamente para la vista inmersiva.</p>
        ${uploadControlMarkup('Subir mp3')}
        ${state.error ? `<p class="song-audio__error" role="alert">${escapeHtml(state.error)}</p>` : ''}
      `;
      wireUploadInput();
      return;
    }

    el.innerHTML = `
      <h2 class="editor__section-title">Audio y sincronía</h2>
      <p class="song-audio__file">Audio: full.mp3 · ${formatDuration(state.audio.durationSec)}</p>
      ${syncStatusMarkup(state.timings)}
      <div class="song-audio__actions">
        ${uploadControlMarkup('Reemplazar mp3')}
        <button class="btn btn--secondary btn--danger" data-action="song-audio-delete" type="button">Eliminar</button>
      </div>
      ${metronomeMarkup(state.audio, state.timings)}
      ${confidenceMarkup(state.timings)}
      ${state.error ? `<p class="song-audio__error" role="alert">${escapeHtml(state.error)}</p>` : ''}
    `;
    wireUploadInput();
    wireMetronome();

    syncPolling();
  }

  function wireUploadInput() {
    const input = el.querySelector('[data-action="song-audio-file"]');
    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) uploadFlow(file);
    });
  }

  el.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'song-audio-retry') retrySync();
    else if (target.dataset.action === 'song-audio-delete') deleteFlow();
    else if (target.dataset.action === 'line-expand') {
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

  // La cabecera de la fila expandible es un <div role="button"> (no un
  // <button> real, para no anidar botones dentro): Enter/Espacio disparan la
  // misma acción line-expand que el click.
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
    destroy() {
      destroyed = true;
      stopPolling();
      previewAudio?.pause();
      previewAudio = null;
    },
  };
}
