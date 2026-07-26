/**
 * UploadPhaseCard.js — flujo de subida del mp3 dentro de la fila Audio del
 * stepper (pipeline unificado, plan D, Task D3b). Máquina de estados propia
 * (empty → validating → warning? → uploading → confirmed/processing, con
 * 'renaming' y 'confirmError' como desvíos locales) que `update(run)`
 * sincroniza SIN pisar un flujo local en curso: mientras el card está
 * validando, mostrando la advertencia de título, subiendo, renombrando o en
 * confirmError, el watcher del run queda mudo para esta tarjeta (LOCAL_STATES).
 */
import { icon } from '../../lib/icons.js';
import { escapeHtml } from '../../lib/escape.js';
import { showToast } from '../../lib/toast.js';
import { confirmDialog } from '../ConfirmDialog.js';
import { readAudioDuration } from '../../lib/stemsApi.js';
import {
  createPipelineRun,
  confirmPipelineUpload,
  renamePipelineAudio,
  cancelPipelineRun,
} from '../../lib/pipelineApi.js';

// 'renaming' y 'confirmError' también son flujos locales: sin esto, el
// próximo tick del watcher (poll de 3s) pisaría el formulario de rename a
// medio escribir o el botón Reintentar de un confirm fallido.
const LOCAL_STATES = new Set(['validating', 'warning', 'uploading', 'renaming', 'confirmError']);

/**
 * @param {{ songId: string, onAfterConfirm?: () => void }} opts
 * @returns {{ el: HTMLElement, update: (run: object|null) => void, dispose: () => void }}
 */
export function createUploadPhaseCard({ songId, onAfterConfirm }) {
  const el = document.createElement('div');
  el.className = 'upload-card';

  // Estado local del flujo. `derived` es null mientras el card corre un flujo
  // propio (validating/warning/uploading); cuando vuelve a empty/confirmed
  // se re-deriva directo del run recibido por `update`.
  let state = 'empty';
  let lastRun = null;
  let ctx = {}; // file, durationSec, uploadUrl, titleScore, threshold, songTitle, displayName, uploadMessage

  function render() {
    if (state === 'empty') return renderEmpty();
    if (state === 'validating') return renderValidating();
    if (state === 'warning') return renderWarning();
    if (state === 'uploading') return renderUploading();
    if (state === 'confirmError') return renderConfirmError();
    return renderConfirmed();
  }

  function renderEmpty() {
    el.innerHTML = `
      <label class="upload-card__drop" tabindex="0">
        ${icon('upload', { size: 22 })}
        <span class="upload-card__drop-title">Sube el audio de la canción</span>
        <span class="upload-card__drop-hint">MP3, hasta 25MB</span>
        <input type="file" accept="audio/mpeg,.mp3" class="upload-card__input" />
      </label>
    `;
    const input = el.querySelector('.upload-card__input');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) startValidation(file);
    });
  }

  function renderValidating() {
    el.innerHTML = `
      <div class="upload-card__status">
        <span class="ph-loader ph-loader--shimmer" aria-hidden="true"></span>
        <span>Validando archivo...</span>
      </div>
    `;
  }

  function renderWarning() {
    const pct = Math.round((ctx.titleScore ?? 0) * 100);
    el.innerHTML = `
      <div class="upload-card__warning">
        <div class="upload-card__warning-grid">
          <div>
            <span class="upload-card__warning-label">Archivo</span>
            <span class="upload-card__warning-value">${escapeHtml(ctx.file.name)}</span>
          </div>
          <div>
            <span class="upload-card__warning-label">Canción</span>
            <span class="upload-card__warning-value">${escapeHtml(ctx.songTitle ?? '')}</span>
          </div>
          <div>
            <span class="upload-card__warning-label">Coincidencia</span>
            <span class="upload-card__warning-value">${pct}%</span>
          </div>
        </div>
        <label class="upload-card__field">
          <span>Nombre para este audio</span>
          <input type="text" class="upload-card__name-input" value="${escapeHtml(ctx.displayName ?? ctx.file.name)}" />
        </label>
        <div class="upload-card__actions">
          <button type="button" class="btn2 upload-card__change">Cambiar archivo</button>
          <button type="button" class="btn2 upload-card__revalidate">Revalidar</button>
          <button type="button" class="btn upload-card__continue">Continuar de todas formas</button>
        </div>
      </div>
    `;
    const nameInput = el.querySelector('.upload-card__name-input');
    nameInput.addEventListener('input', () => {
      ctx.displayName = nameInput.value;
    });
    el.querySelector('.upload-card__change').addEventListener('click', () => changeFile());
    el.querySelector('.upload-card__revalidate').addEventListener('click', () => revalidate());
    el.querySelector('.upload-card__continue').addEventListener('click', () => continueAnyway());
  }

  function renderUploading() {
    el.innerHTML = `
      <div class="upload-card__status">
        <span class="ph-loader ph-loader--shimmer" aria-hidden="true"></span>
        <span>${escapeHtml(ctx.uploadMessage || 'Subiendo...')}</span>
      </div>
    `;
  }

  function renderConfirmError() {
    el.innerHTML = `
      <div class="upload-card__warning">
        <p class="upload-card__error-msg">El audio se subió pero no se pudo iniciar el procesamiento.</p>
        <div class="upload-card__actions">
          <button type="button" class="btn upload-card__retry-confirm">Reintentar</button>
        </div>
      </div>
    `;
    el.querySelector('.upload-card__retry-confirm').addEventListener('click', () => retryConfirm());
  }

  function renderConfirmed() {
    const run = lastRun;
    const meta = run?.inputMeta || {};
    const displayName = meta.displayName || meta.filename || '';
    const showOriginal = meta.displayName && meta.filename && meta.displayName !== meta.filename;
    const isProcessing = Boolean(run) && run.status !== 'done';

    el.innerHTML = `
      <div class="upload-card__confirmed">
        <div class="upload-card__name-row">
          <span class="upload-card__name">${escapeHtml(displayName)}</span>
          <button type="button" class="upload-card__rename-btn" aria-label="Renombrar audio">${icon('pencil', { size: 14 })}</button>
        </div>
        ${showOriginal ? `<span class="upload-card__original">${escapeHtml(meta.filename)}</span>` : ''}
        ${isProcessing ? '<div class="upload-card__status"><span class="ph-loader ph-loader--shimmer" aria-hidden="true"></span><span>Procesando en segundo plano...</span></div>' : ''}
        <button type="button" class="btn2 upload-card__replace">Reemplazar</button>
      </div>
    `;
    el.querySelector('.upload-card__rename-btn').addEventListener('click', () => startRename());
    el.querySelector('.upload-card__replace').addEventListener('click', () => replaceAudio());
  }

  function renderRenaming(currentName) {
    el.innerHTML = `
      <div class="upload-card__confirmed">
        <div class="upload-card__rename-row">
          <input type="text" class="upload-card__rename-input" value="${escapeHtml(currentName)}" />
          <button type="button" class="btn upload-card__rename-save">Guardar</button>
          <button type="button" class="btn2 upload-card__rename-cancel">Cancelar</button>
        </div>
      </div>
    `;
    const input = el.querySelector('.upload-card__rename-input');
    el.querySelector('.upload-card__rename-save').addEventListener('click', async () => {
      const value = input.value.trim();
      if (!value) return;
      try {
        await renamePipelineAudio(songId, value);
        // Optimista: reflejar el nombre nuevo ANTES del próximo poll, para no
        // esperar hasta 3s a que el watcher lo traiga de vuelta.
        if (lastRun) {
          lastRun = { ...lastRun, inputMeta: { ...lastRun.inputMeta, displayName: value } };
        }
        showToast('Nombre actualizado');
      } catch (err) {
        console.error('UploadPhaseCard: no se pudo renombrar el audio', err);
        showToast(err.message || 'No se pudo renombrar el audio', { type: 'error' });
      }
      state = 'confirmed';
      render();
    });
    el.querySelector('.upload-card__rename-cancel').addEventListener('click', () => {
      state = 'confirmed';
      render();
    });
  }

  function startRename() {
    const meta = lastRun?.inputMeta || {};
    state = 'renaming';
    renderRenaming(meta.displayName || meta.filename || '');
  }

  async function startValidation(file) {
    state = 'validating';
    render();
    try {
      const durationSec = await readAudioDuration(file);
      const created = await createPipelineRun(songId, {
        fileName: file.name,
        size: file.size,
        mime: file.type,
      });
      ctx = {
        file,
        durationSec,
        uploadUrl: created.uploadUrl,
        titleScore: created.titleScore,
        threshold: created.threshold,
        songTitle: created.songTitle,
        displayName: file.name,
      };
      if ((created.titleScore ?? 1) >= (created.threshold ?? 0)) {
        await beginUpload();
      } else {
        state = 'warning';
        render();
      }
    } catch (err) {
      console.error('UploadPhaseCard: no se pudo crear el procesamiento', err);
      showToast(err.message || 'No se pudo subir el archivo', { type: 'error' });
      state = 'empty';
      render();
    }
  }

  async function revalidate() {
    // NO crea un run nuevo (Critical #1 del review): el run 'created' de la
    // validación inicial ya existe, y un segundo createPipelineRun choca con
    // el índice único de run activo (409). Revalidar es renombrar el mismo
    // run y recalcular la coincidencia contra el nombre editado.
    try {
      const r = await renamePipelineAudio(songId, ctx.displayName || ctx.file.name);
      ctx.titleScore = r.titleScore;
      ctx.threshold = r.threshold;
      ctx.songTitle = r.songTitle;
      render();
    } catch (err) {
      console.error('UploadPhaseCard: no se pudo revalidar', err);
      showToast(err.message || 'No se pudo revalidar', { type: 'error' });
    }
  }

  async function changeFile() {
    // Hay un run 'created' vivo de la validación: cancelarlo antes de volver
    // a empty, si no el índice único de run activo bloquea el próximo intento.
    try {
      await cancelPipelineRun(songId);
    } catch (err) {
      console.error('UploadPhaseCard: no se pudo cancelar el procesamiento', err);
      showToast(err.message || 'No se pudo cancelar el procesamiento', { type: 'error' });
    }
    ctx = {};
    lastRun = null;
    state = 'empty';
    render();
  }

  async function continueAnyway() {
    await beginUpload();
  }

  /** Aplica el nombre elegido (si difiere del original) y cierra en confirmed. */
  async function finalizeConfirm() {
    if (ctx.displayName && ctx.file && ctx.displayName !== ctx.file.name) {
      try {
        await renamePipelineAudio(songId, ctx.displayName);
      } catch (err) {
        console.error('UploadPhaseCard: no se pudo aplicar el nombre elegido', err);
      }
    }
    onAfterConfirm?.();
    // El card queda en confirmed a la espera del próximo `update(run)` del
    // watcher; hasta entonces, sin lastRun, cae en confirmed vacío.
    state = 'confirmed';
    render();
  }

  async function beginUpload() {
    state = 'uploading';
    ctx.uploadMessage = 'Subiendo...';
    render();
    // Distingue si el fallo fue en el PUT (nada subido todavía: el run
    // 'created' es huérfano, se cancela) o en el confirm posterior (el
    // archivo YA está en storage: cancelar lo perdería, se ofrece reintentar
    // solo el confirm).
    let putOk = false;
    try {
      const res = await fetch(ctx.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': ctx.file.type || 'audio/mpeg', 'x-upsert': 'true' },
        body: ctx.file,
      });
      if (!res.ok) throw new Error('La subida falló.');
      putOk = true;
      ctx.uploadMessage = 'Procesando en segundo plano...';
      render();
      await confirmPipelineUpload(songId, { durationSec: ctx.durationSec });
      await finalizeConfirm();
    } catch (err) {
      console.error('UploadPhaseCard: no se pudo subir el audio', err);
      if (!putOk) {
        await cancelPipelineRun(songId).catch(() => {});
        showToast('La subida falló. Intentá de nuevo.');
        state = 'empty';
        ctx = {};
        render();
      } else {
        state = 'confirmError';
        render();
      }
    }
  }

  /** Reintento del confirm tras un fallo con el archivo ya subido (no re-sube). */
  async function retryConfirm() {
    try {
      await confirmPipelineUpload(songId, { durationSec: ctx.durationSec });
      await finalizeConfirm();
    } catch (err) {
      console.error('UploadPhaseCard: no se pudo confirmar la subida', err);
      showToast(err.message || 'El audio se subió pero no se pudo iniciar el procesamiento.', {
        type: 'error',
      });
      // Se queda en confirmError: el admin puede reintentar de nuevo.
    }
  }

  async function replaceAudio() {
    const ok = await confirmDialog({
      title: 'Reemplazar audio',
      body: 'Esto inicia un procesamiento nuevo. ¿Reemplazar el audio?',
      confirmLabel: 'Reemplazar',
      danger: true,
    });
    if (!ok) return;
    try {
      await cancelPipelineRun(songId);
    } catch (err) {
      console.error('UploadPhaseCard: no se pudo cancelar el procesamiento', err);
      showToast(err.message || 'No se pudo cancelar el procesamiento', { type: 'error' });
    }
    ctx = {};
    lastRun = null;
    state = 'empty';
    render();
  }

  function update(run) {
    lastRun = run;
    if (LOCAL_STATES.has(state)) return; // flujo local en curso: no pisar
    const uploadDone = run?.phases?.upload?.status === 'done';
    const hasRun = Boolean(run);
    if (uploadDone || (hasRun && run.status !== 'created' && run.status !== 'uploading')) {
      state = 'confirmed';
    } else {
      state = 'empty';
    }
    render();
  }

  /**
   * Teardown best-effort: si el card se desmonta en medio de un flujo local
   * cuyo run todavía no quedó confirmado (upload sin terminar), cancela ese
   * run huérfano para no dejarlo bloqueando el índice único. Si el run ya
   * está confirmado (p.ej. 'renaming' sobre un audio ya procesado), no toca
   * nada: cancelarlo mataría un procesamiento legítimo.
   */
  function dispose() {
    if (!LOCAL_STATES.has(state)) return;
    const uploadConfirmed = lastRun?.phases?.upload?.status === 'done';
    if (uploadConfirmed) return;
    cancelPipelineRun(songId).catch(() => {});
  }

  render();

  return { el, update, dispose };
}
