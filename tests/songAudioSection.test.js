import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/songAudioApi.js', () => ({
  getSongAudio: vi.fn(),
  createSongAudioUpload: vi.fn(),
  confirmSongAudio: vi.fn(),
  deleteSongAudio: vi.fn(),
  uploadSongAudioFile: vi.fn(),
}));
vi.mock('../src/lib/stemsApi.js', () => ({
  readAudioDuration: vi.fn().mockResolvedValue(125),
}));
vi.mock('../src/components/ConfirmDialog.js', () => ({
  confirmDialog: vi.fn().mockResolvedValue(true),
}));

const songAudioApi = await import('../src/lib/songAudioApi.js');
const { confirmDialog } = await import('../src/components/ConfirmDialog.js');
const { createSongAudioSection } = await import('../src/components/editor/SongAudioSection.js');

function mkFile(name, type, size) {
  const file = new File(['contenido'], name, { type });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('SongAudioSection', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('sin songId: el hint de guardar primero y el control visible pero deshabilitado', () => {
    const section = createSongAudioSection({ songId: null });
    container.appendChild(section.el);

    expect(section.el.textContent).toContain('Guarda la canción para subir el audio');
    const btn = section.el.querySelector('.song-audio__file-btn');
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);

    btn.click();
    expect(songAudioApi.createSongAudioUpload).not.toHaveBeenCalled();

    section.destroy();
  });

  it('estado vacío: hint + botón Subir mp3', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({ audio: null, timings: null });
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);
    await vi.waitFor(() => expect(songAudioApi.getSongAudio).toHaveBeenCalledWith('song-1'));

    expect(section.el.textContent).toContain(
      'Sube el mp3 completo. La letra se sincroniza automáticamente para la vista inmersiva.',
    );
    expect(section.el.querySelector('[data-action="song-audio-file"]')).not.toBeNull();

    section.destroy();
  });

  it('estado uploading: botón deshabilitado con "Subiendo..." durante el flujo', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({ audio: null, timings: null });
    let resolveConfirm;
    songAudioApi.createSongAudioUpload.mockResolvedValue({
      uploadUrl: 'https://put/x',
      key: 'song-1/full.mp3',
    });
    songAudioApi.uploadSongAudioFile.mockResolvedValue(undefined);
    songAudioApi.confirmSongAudio.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConfirm = resolve;
        }),
    );

    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);
    await vi.waitFor(() => expect(songAudioApi.getSongAudio).toHaveBeenCalled());

    const input = section.el.querySelector('[data-action="song-audio-file"]');
    const file = mkFile('audio.mp3', 'audio/mpeg');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(section.el.textContent).toContain('Subiendo...'));
    expect(section.el.querySelector('[data-action="song-audio-file"]')).toBeNull();

    await vi.waitFor(() => expect(songAudioApi.confirmSongAudio).toHaveBeenCalled());
    resolveConfirm();
    section.destroy();
  });

  it('withAudio ready: muestra duración y "Sincronía: lista (N líneas)"', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: { url: 'https://x/full.mp3', durationSec: 185 },
      timings: { status: 'ready', lines: [{}, {}, {}] },
    });
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() => expect(section.el.textContent).toContain('Audio: full.mp3 · 3:05'));
    expect(section.el.textContent).toContain('Sincronía: lista (3 líneas)');
    expect(section.el.querySelector('[data-action="song-audio-retry"]')).toBeNull();

    section.destroy();
  });

  it('withAudio failed: muestra el error y botón Reintentar sincronía que llama confirmSongAudio', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: { url: 'https://x/full.mp3', durationSec: 100 },
      timings: { status: 'failed', error: 'timeout del proveedor' },
    });
    songAudioApi.confirmSongAudio.mockResolvedValue(undefined);
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() =>
      expect(section.el.textContent).toContain('Sincronía: error — timeout del proveedor'),
    );

    section.el.querySelector('[data-action="song-audio-retry"]').click();

    await vi.waitFor(() =>
      expect(songAudioApi.confirmSongAudio).toHaveBeenCalledWith('song-1', 100),
    );

    section.destroy();
  });

  it('rechaza archivos que no son mp3 sin llamar al API', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({ audio: null, timings: null });
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);
    await vi.waitFor(() => expect(songAudioApi.getSongAudio).toHaveBeenCalled());

    const input = section.el.querySelector('[data-action="song-audio-file"]');
    const file = mkFile('audio.wav', 'audio/wav');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() =>
      expect(section.el.querySelector('.song-audio__error')?.textContent).toContain(
        'Solo se admite mp3',
      ),
    );
    expect(songAudioApi.createSongAudioUpload).not.toHaveBeenCalled();

    section.destroy();
  });

  it('rechaza archivos > 25MB sin llamar al API', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({ audio: null, timings: null });
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);
    await vi.waitFor(() => expect(songAudioApi.getSongAudio).toHaveBeenCalled());

    const input = section.el.querySelector('[data-action="song-audio-file"]');
    const file = mkFile('grande.mp3', 'audio/mpeg', 26 * 1024 * 1024);
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() =>
      expect(section.el.querySelector('.song-audio__error')?.textContent).toContain(
        'El archivo supera el límite de 25 MB',
      ),
    );
    expect(songAudioApi.createSongAudioUpload).not.toHaveBeenCalled();

    section.destroy();
  });

  it('elimina tras confirmar y vuelve al estado vacío', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: { url: 'https://x/full.mp3', durationSec: 100 },
      timings: { status: 'ready', lines: [{}] },
    });
    songAudioApi.deleteSongAudio.mockResolvedValue(undefined);
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() =>
      expect(section.el.querySelector('[data-action="song-audio-delete"]')).not.toBeNull(),
    );
    section.el.querySelector('[data-action="song-audio-delete"]').click();

    await vi.waitFor(() =>
      expect(confirmDialog).toHaveBeenCalledWith({
        title: 'Eliminar audio',
        body: 'Se borra el mp3 y su sincronía de letra.',
        confirmLabel: 'Eliminar',
        danger: true,
      }),
    );
    await vi.waitFor(() => expect(songAudioApi.deleteSongAudio).toHaveBeenCalledWith('song-1'));
    await vi.waitFor(() => expect(section.el.textContent).toContain('Sube el mp3 completo'));

    section.destroy();
  });

  it('no elimina si se cancela la confirmación', async () => {
    confirmDialog.mockResolvedValueOnce(false);
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: { url: 'https://x/full.mp3', durationSec: 100 },
      timings: { status: 'ready', lines: [{}] },
    });
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() =>
      expect(section.el.querySelector('[data-action="song-audio-delete"]')).not.toBeNull(),
    );
    section.el.querySelector('[data-action="song-audio-delete"]').click();

    await vi.waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(songAudioApi.deleteSongAudio).not.toHaveBeenCalled();
    expect(section.el.textContent).toContain('Audio: full.mp3');

    section.destroy();
  });

  it('polling: arranca en processing, hace GET cada 5s y se detiene al llegar a ready', async () => {
    vi.useFakeTimers();
    let call = 0;
    songAudioApi.getSongAudio.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({
          audio: { url: 'https://x/full.mp3', durationSec: 100 },
          timings: { status: 'processing' },
        });
      }
      return Promise.resolve({
        audio: { url: 'https://x/full.mp3', durationSec: 100 },
        timings: { status: 'ready', lines: [{}] },
      });
    });

    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() => expect(songAudioApi.getSongAudio).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(5001);
    expect(songAudioApi.getSongAudio).toHaveBeenCalledTimes(2);

    // Ya en ready: el polling debe haberse detenido, sin más llamadas.
    await vi.advanceTimersByTimeAsync(15000);
    expect(songAudioApi.getSongAudio).toHaveBeenCalledTimes(2);

    section.destroy();
  });

  it('destroy() corta el polling aunque siga en processing', async () => {
    vi.useFakeTimers();
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: { url: 'https://x/full.mp3', durationSec: 100 },
      timings: { status: 'processing' },
    });

    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() => expect(songAudioApi.getSongAudio).toHaveBeenCalledTimes(1));

    section.destroy();

    await vi.advanceTimersByTimeAsync(20000);
    expect(songAudioApi.getSongAudio).toHaveBeenCalledTimes(1);
  });
});
