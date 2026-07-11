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
} from '../../lib/songAudioApi.js';
import { readAudioDuration } from '../../lib/stemsApi.js';
import { confirmDialog } from '../ConfirmDialog.js';
import { icon } from '../../lib/icons.js';
import { escapeHtml } from '../../lib/escape.js';

const SONG_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
const POLL_INTERVAL_MS = 5000;

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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
 * @param {{ songId: string|null }} opts
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function createSongAudioSection({ songId }) {
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
    state.error = null;
    try {
      await confirmSongAudio(songId, state.audio?.durationSec ?? null);
      await refresh();
    } catch (err) {
      state.error = err.message || 'No se pudo reintentar la sincronía';
      render();
    }
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
      ${state.error ? `<p class="song-audio__error" role="alert">${escapeHtml(state.error)}</p>` : ''}
    `;
    wireUploadInput();

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
  });

  render();
  if (songId) refresh();

  return {
    el,
    destroy() {
      destroyed = true;
      stopPolling();
    },
  };
}
