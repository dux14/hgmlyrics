// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/lib/pipelineApi.js', () => ({
  createPipelineRun: vi.fn(),
  confirmPipelineUpload: vi.fn(() => Promise.resolve({ success: true })),
  renamePipelineAudio: vi.fn(() => Promise.resolve({ success: true })),
  cancelPipelineRun: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../src/lib/stemsApi.js', () => ({
  readAudioDuration: vi.fn(() => Promise.resolve(180)),
}));

vi.mock('../src/lib/toast.js', () => ({
  showToast: vi.fn(),
}));

vi.mock('../src/components/ConfirmDialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

import { createUploadPhaseCard } from '../src/components/pipeline/UploadPhaseCard.js';
import {
  createPipelineRun,
  confirmPipelineUpload,
  renamePipelineAudio,
  cancelPipelineRun,
} from '../src/lib/pipelineApi.js';
import { readAudioDuration } from '../src/lib/stemsApi.js';
import { confirmDialog } from '../src/components/ConfirmDialog.js';

const SONG_ID = 'song-1';

function makeFile(name = 'cancion.mp3') {
  return new File(['x'.repeat(10)], name, { type: 'audio/mpeg' });
}

function selectFile(el, file) {
  const input = el.querySelector('.upload-card__input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

/** Espera N vueltas de microtask para flushear las promesas de la máquina de estados. */
async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe('UploadPhaseCard — subida del audio (Task D3b)', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
    vi.clearAllMocks();
    readAudioDuration.mockResolvedValue(180);
    confirmPipelineUpload.mockResolvedValue({ success: true });
    renamePipelineAudio.mockResolvedValue({ success: true });
    cancelPipelineRun.mockResolvedValue({ success: true });
    confirmDialog.mockResolvedValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('estado empty: muestra la dropzone con los límites', () => {
    const { el } = createUploadPhaseCard({ songId: SONG_ID });
    expect(el.querySelector('.upload-card__drop-hint').textContent).toContain('MP3');
    expect(el.querySelector('.upload-card__input')).toBeTruthy();
  });

  it('elegir archivo con coincidencia alta: llama createPipelineRun y sube directo', async () => {
    createPipelineRun.mockResolvedValue({
      runId: 'r1',
      uploadUrl: 'https://upload.example/x',
      titleScore: 0.95,
      threshold: 0.6,
    });
    const { el } = createUploadPhaseCard({ songId: SONG_ID });

    selectFile(el, makeFile());
    await flush();

    expect(createPipelineRun).toHaveBeenCalledWith(
      SONG_ID,
      expect.objectContaining({ fileName: 'cancion.mp3' }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://upload.example/x',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(confirmPipelineUpload).toHaveBeenCalledWith(SONG_ID, { durationSec: 180 });
  });

  it('coincidencia baja: muestra estado warning con grid y campo de nombre', async () => {
    createPipelineRun.mockResolvedValue({
      runId: 'r1',
      uploadUrl: 'https://upload.example/x',
      titleScore: 0.2,
      threshold: 0.6,
    });
    const { el } = createUploadPhaseCard({ songId: SONG_ID });

    selectFile(el, makeFile());
    await flush();

    expect(el.querySelector('.upload-card__warning')).toBeTruthy();
    expect(el.querySelector('.upload-card__warning-value').textContent).toBe('cancion.mp3');
    expect(el.querySelector('.upload-card__name-input')).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('warning → Continuar de todas formas: sube el archivo y confirma', async () => {
    createPipelineRun.mockResolvedValue({
      runId: 'r1',
      uploadUrl: 'https://upload.example/x',
      titleScore: 0.2,
      threshold: 0.6,
    });
    const { el } = createUploadPhaseCard({ songId: SONG_ID });

    selectFile(el, makeFile());
    await flush();

    el.querySelector('.upload-card__continue').click();
    await flush();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://upload.example/x',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(confirmPipelineUpload).toHaveBeenCalledWith(SONG_ID, { durationSec: 180 });
  });

  it('run con upload done: estado confirmed muestra el nombre display y Reemplazar', () => {
    const { el, update } = createUploadPhaseCard({ songId: SONG_ID });
    update({
      status: 'processing',
      phases: { upload: { status: 'done' } },
      inputMeta: { filename: 'original.mp3', displayName: 'Mi nombre' },
    });

    expect(el.querySelector('.upload-card__name').textContent).toBe('Mi nombre');
    expect(el.querySelector('.upload-card__original').textContent).toBe('original.mp3');
    expect(el.querySelector('.upload-card__replace')).toBeTruthy();
  });

  it.each(['failed', 'cancelled', 'superseded'])(
    'run %s con upload done: NO muestra "Procesando en segundo plano" (#7)',
    (status) => {
      const { el, update } = createUploadPhaseCard({ songId: SONG_ID });
      update({
        status,
        phases: { upload: { status: 'done' } },
        inputMeta: { filename: 'original.mp3' },
      });

      expect(el.querySelector('.upload-card__status')).toBeFalsy();
    },
  );

  it('run processing con upload done: SÍ muestra "Procesando en segundo plano"', () => {
    const { el, update } = createUploadPhaseCard({ songId: SONG_ID });
    update({
      status: 'processing',
      phases: { upload: { status: 'done' } },
      inputMeta: { filename: 'original.mp3' },
    });

    expect(el.querySelector('.upload-card__status')?.textContent).toContain(
      'Procesando en segundo plano',
    );
  });

  it('confirmed → click en lapiz → Guardar: llama renamePipelineAudio', async () => {
    const { el, update } = createUploadPhaseCard({ songId: SONG_ID });
    update({
      status: 'done',
      phases: { upload: { status: 'done' } },
      inputMeta: { filename: 'original.mp3' },
    });

    el.querySelector('.upload-card__rename-btn').click();
    const input = el.querySelector('.upload-card__rename-input');
    input.value = 'Nuevo nombre';
    el.querySelector('.upload-card__rename-save').click();
    await flush();

    expect(renamePipelineAudio).toHaveBeenCalledWith(SONG_ID, 'Nuevo nombre');
  });

  it('confirmed → Reemplazar: usa el ConfirmDialog del sistema (no window.confirm) y cancela el run', async () => {
    const { el, update } = createUploadPhaseCard({ songId: SONG_ID });
    update({
      status: 'done',
      phases: { upload: { status: 'done' } },
      inputMeta: { filename: 'original.mp3' },
    });

    el.querySelector('.upload-card__replace').click();
    await flush();

    expect(confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('Reemplazar'), danger: true }),
    );
    expect(cancelPipelineRun).toHaveBeenCalledWith(SONG_ID);
    expect(el.querySelector('.upload-card__drop')).toBeTruthy(); // vuelve a empty
  });

  it('confirmed → Reemplazar: si se cancela el dialogo, NO cancela el run ni cambia de estado', async () => {
    confirmDialog.mockResolvedValueOnce(false);
    const { el, update } = createUploadPhaseCard({ songId: SONG_ID });
    update({
      status: 'done',
      phases: { upload: { status: 'done' } },
      inputMeta: { filename: 'original.mp3' },
    });

    el.querySelector('.upload-card__replace').click();
    await flush();

    expect(cancelPipelineRun).not.toHaveBeenCalled();
    expect(el.querySelector('.upload-card__confirmed')).toBeTruthy(); // sigue en confirmed
  });

  it('update(run) no pisa un flujo local en curso (validating/warning/uploading)', async () => {
    createPipelineRun.mockResolvedValue({
      runId: 'r1',
      uploadUrl: 'https://upload.example/x',
      titleScore: 0.2,
      threshold: 0.6,
    });
    const { el, update } = createUploadPhaseCard({ songId: SONG_ID });

    selectFile(el, makeFile());
    await flush();
    expect(el.querySelector('.upload-card__warning')).toBeTruthy();

    // Un evento del watcher llega mientras el card sigue en warning: no debe
    // pisar el flujo local.
    update({ status: 'created', phases: { upload: { status: 'pending' } }, inputMeta: {} });
    expect(el.querySelector('.upload-card__warning')).toBeTruthy();
  });

  it('warning: Revalidar llama renamePipelineAudio (NO crea un run nuevo) y actualiza la coincidencia', async () => {
    createPipelineRun.mockResolvedValue({
      runId: 'r1',
      uploadUrl: 'https://upload.example/x',
      titleScore: 0.2,
      threshold: 0.6,
      songTitle: 'Sion',
    });
    renamePipelineAudio.mockResolvedValue({
      success: true,
      titleScore: 0.9,
      threshold: 0.6,
      songTitle: 'Sion',
    });
    const { el } = createUploadPhaseCard({ songId: SONG_ID });

    selectFile(el, makeFile());
    await flush();
    expect(createPipelineRun).toHaveBeenCalledTimes(1);

    el.querySelector('.upload-card__revalidate').click();
    await flush();

    expect(renamePipelineAudio).toHaveBeenCalledWith(SONG_ID, 'cancion.mp3');
    // Revalidar NO vuelve a llamar createPipelineRun (evita el 409 del run activo).
    expect(createPipelineRun).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.upload-card__warning-value').textContent).toBe('cancion.mp3');
    expect(el.textContent).toContain('90%');
  });

  it('beginUpload: PUT falla → cancela el run huérfano y vuelve a empty', async () => {
    createPipelineRun.mockResolvedValue({
      runId: 'r1',
      uploadUrl: 'https://upload.example/x',
      titleScore: 0.95,
      threshold: 0.6,
    });
    global.fetch = vi.fn(() => Promise.resolve({ ok: false }));
    const { el } = createUploadPhaseCard({ songId: SONG_ID });

    selectFile(el, makeFile());
    await flush();

    expect(cancelPipelineRun).toHaveBeenCalledWith(SONG_ID);
    expect(el.querySelector('.upload-card__input')).toBeTruthy(); // volvió a empty
  });

  it('beginUpload: PUT ok pero confirm falla → estado confirmError con Reintentar (sin cancelar ni re-subir)', async () => {
    createPipelineRun.mockResolvedValue({
      runId: 'r1',
      uploadUrl: 'https://upload.example/x',
      titleScore: 0.95,
      threshold: 0.6,
    });
    confirmPipelineUpload.mockRejectedValueOnce(new Error('502'));
    const { el } = createUploadPhaseCard({ songId: SONG_ID });

    selectFile(el, makeFile());
    await flush();

    expect(cancelPipelineRun).not.toHaveBeenCalled();
    const retryBtn = el.querySelector('.upload-card__retry-confirm');
    expect(retryBtn).toBeTruthy();

    confirmPipelineUpload.mockResolvedValueOnce({ success: true });
    retryBtn.click();
    await flush();

    // El reintento no vuelve a hacer PUT (fetch sigue llamado una sola vez).
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(confirmPipelineUpload).toHaveBeenCalledTimes(2);
    expect(cancelPipelineRun).not.toHaveBeenCalled();
  });

  it('update(run) durante state==="renaming" no reemplaza el formulario en curso', () => {
    const { el, update } = createUploadPhaseCard({ songId: SONG_ID });
    update({
      status: 'processing',
      phases: { upload: { status: 'done' } },
      inputMeta: { filename: 'original.mp3' },
    });

    el.querySelector('.upload-card__rename-btn').click();
    const input = el.querySelector('.upload-card__rename-input');
    input.value = 'A medio escribir';

    update({
      status: 'processing',
      phases: { upload: { status: 'done' } },
      inputMeta: { filename: 'original.mp3' },
    });

    expect(el.querySelector('.upload-card__rename-input').value).toBe('A medio escribir');
  });

  it('grid de warning muestra el songTitle en la celda Canción', async () => {
    createPipelineRun.mockResolvedValue({
      runId: 'r1',
      uploadUrl: 'https://upload.example/x',
      titleScore: 0.2,
      threshold: 0.6,
      songTitle: 'Sion',
    });
    const { el } = createUploadPhaseCard({ songId: SONG_ID });

    selectFile(el, makeFile());
    await flush();

    const values = el.querySelectorAll('.upload-card__warning-value');
    expect(values[1].textContent).toBe('Sion');
  });
});
