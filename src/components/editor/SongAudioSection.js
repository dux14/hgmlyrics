/**
 * SongAudioSection.js — sección "Audio y sincronía" del editor (admin).
 * Task D6: pasó de uploader+editor completo a tarjeta-resumen que enlaza al
 * stepper de procesamiento (/song/:id/procesamiento). Los ajustes finos
 * (upload, confianza por línea, offset manual, metrónomo) viven ahora en
 * SyncFineTuning.js y UploadPhaseCard.js, consumidos desde el stepper.
 */
import { getPipelineRun } from '../../lib/pipelineApi.js';
import { navigate } from '../../router.js';
import { icon } from '../../lib/icons.js';
import { escapeHtml } from '../../lib/escape.js';

const STATUS_LABELS = {
  created: 'Procesando audio',
  uploading: 'Procesando audio',
  processing: 'Procesando audio',
  awaiting_lyrics: 'Esperando revisión de letra',
  running: 'Generando sincronía y tono',
  done: 'Procesamiento completo',
  failed: 'Con errores',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || 'Sin procesamiento';
}

/**
 * @param {{ songId: string|null, getSong?: (() => object|null)|null }} opts
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
// getSong ya no se usa acá (la tarjeta no proyecta líneas) — se conserva en
// la firma porque SongEditor.js sigue pasándolo; D6 no toca esa integración.
export function createSongAudioSection({ songId, getSong: _getSong = null }) {
  const el = document.createElement('div');
  el.className = 'editor__section song-audio-section';

  const state = { run: null, loading: !!songId };

  let destroyed = false;

  function audioName(run) {
    const meta = run?.inputMeta || {};
    return meta.displayName || meta.filename || null;
  }

  function render() {
    if (destroyed) return;

    if (!songId) {
      el.innerHTML = `
        <h2 class="editor__section-title">Audio y sincronía</h2>
        <p class="song-audio__hint">Guarda la canción para procesar el audio</p>
      `;
      return;
    }

    const run = state.run;
    const name = audioName(run);
    el.innerHTML = `
      <h2 class="editor__section-title">Audio y sincronía</h2>
      <div class="song-audio__summary">
        <p class="song-audio__status">${escapeHtml(statusLabel(run?.status ?? null))}</p>
        ${name ? `<p class="song-audio__file">${escapeHtml(name)}</p>` : ''}
      </div>
      <button class="btn btn--secondary" data-action="song-audio-open" type="button">
        Abrir procesamiento ${icon('chevron-right', { size: 14 })}
      </button>
    `;
  }

  async function refresh() {
    if (destroyed || !songId) return;
    try {
      const data = await getPipelineRun(songId);
      if (destroyed) return;
      state.run = data?.run ?? null;
    } catch {
      if (destroyed) return;
      state.run = null;
    } finally {
      if (!destroyed) {
        state.loading = false;
        render();
      }
    }
  }

  el.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action="song-audio-open"]');
    if (!target || !songId) return;
    navigate('/song/' + songId + '/procesamiento');
  });

  render();
  if (songId) refresh();

  return {
    el,
    destroy() {
      destroyed = true;
    },
  };
}
