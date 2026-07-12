import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/songAudioApi.js', () => ({
  getSongAudio: vi.fn(),
  createSongAudioUpload: vi.fn(),
  confirmSongAudio: vi.fn(),
  deleteSongAudio: vi.fn(),
  uploadSongAudioFile: vi.fn(),
  patchSongAudio: vi.fn(),
  patchLineTiming: vi.fn(),
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

  it('confianza por línea: pinta resumen + filas ok/warn según score/interpolated', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: { url: 'https://x/full.mp3', durationSec: 100 },
      timings: {
        status: 'ready',
        lines: [
          { i: 0, startMs: 0, score: 0.9, interpolated: false },
          { i: 1, startMs: 1500, score: 0.5, interpolated: false },
          { i: 2, startMs: 3000, score: 0.95, interpolated: true },
          { i: 3, startMs: 4500, score: null, interpolated: false },
        ],
      },
    });
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() =>
      expect(section.el.querySelector('.song-audio__confidence')).not.toBeNull(),
    );

    expect(section.el.textContent).toContain('3 de 4 líneas ancladas directamente');

    const rows = section.el.querySelectorAll('.audio-line');
    expect(rows.length).toBe(4);
    expect(rows[0].classList.contains('audio-line--ok')).toBe(true);
    expect(rows[1].classList.contains('audio-line--warn')).toBe(true);
    expect(rows[2].classList.contains('audio-line--warn')).toBe(true);
    expect(rows[3].classList.contains('audio-line--warn')).toBe(true);

    expect(rows[2].textContent).toContain('interpolada');

    section.destroy();
  });

  it('confianza por línea: no aparece si status no es ready o no hay líneas', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: { url: 'https://x/full.mp3', durationSec: 100 },
      timings: { status: 'ready', lines: [] },
    });
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() => expect(songAudioApi.getSongAudio).toHaveBeenCalled());
    expect(section.el.querySelector('.song-audio__confidence')).toBeNull();

    section.destroy();
  });

  it('metrónomo: no aparece si la sincronía no está ready', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: { url: 'https://x/full.mp3', durationSec: 100 },
      timings: { status: 'processing' },
    });
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() => expect(songAudioApi.getSongAudio).toHaveBeenCalled());
    expect(section.el.textContent).not.toContain('Metrónomo');

    section.destroy();
  });

  it('metrónomo: ready muestra BPM detectado + overrides precargados', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: {
        url: 'https://x/full.mp3',
        durationSec: 100,
        bpmManual: 118,
        timeSignature: '3/4',
        beatAnchor: 2,
      },
      timings: { status: 'ready', lines: [{}], bpmDetected: 112.35 },
    });
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() => expect(section.el.textContent).toContain('BPM detectado: 112.35'));

    const bpmInput = section.el.querySelector('.song-audio__bpm-manual');
    const compasSelect = section.el.querySelector('.song-audio__time-signature');
    const anchorInput = section.el.querySelector('.song-audio__beat-anchor');
    expect(bpmInput.value).toBe('118');
    expect(compasSelect.value).toBe('3/4');
    expect(anchorInput.value).toBe('2');
    expect(['4/4', '3/4', '6/8', '2/4']).toEqual(
      Array.from(compasSelect.options).map((o) => o.value),
    );

    const saveBtn = section.el.querySelector('[data-action="song-audio-save-metronome"]');
    expect(saveBtn.disabled).toBe(true);

    section.destroy();
  });

  it('metrónomo: sin bpmDetected muestra "sin detección"', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: { url: 'https://x/full.mp3', durationSec: 100 },
      timings: { status: 'ready', lines: [{}], bpmDetected: null },
    });
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() => expect(section.el.textContent).toContain('sin detección'));

    section.destroy();
  });

  it('metrónomo: guardar manda solo lo tocado y refresca', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: {
        url: 'https://x/full.mp3',
        durationSec: 100,
        bpmManual: null,
        timeSignature: null,
        beatAnchor: null,
      },
      timings: { status: 'ready', lines: [{}], bpmDetected: 112.35 },
    });
    songAudioApi.patchSongAudio.mockResolvedValue(undefined);
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() => expect(section.el.textContent).toContain('BPM detectado: 112.35'));

    const saveBtn = section.el.querySelector('[data-action="song-audio-save-metronome"]');
    expect(saveBtn.disabled).toBe(true);

    const bpmInput = section.el.querySelector('.song-audio__bpm-manual');
    bpmInput.value = '130';
    bpmInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();

    await vi.waitFor(() =>
      expect(songAudioApi.patchSongAudio).toHaveBeenCalledWith('song-1', { bpmManual: 130 }),
    );
    await vi.waitFor(() => expect(songAudioApi.getSongAudio).toHaveBeenCalledTimes(2));

    section.destroy();
  });

  it('metrónomo: vaciar el BPM manual manda bpmManual:null', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: {
        url: 'https://x/full.mp3',
        durationSec: 100,
        bpmManual: 118,
        timeSignature: '4/4',
        beatAnchor: 1,
      },
      timings: { status: 'ready', lines: [{}], bpmDetected: 112.35 },
    });
    songAudioApi.patchSongAudio.mockResolvedValue(undefined);
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() => expect(section.el.textContent).toContain('BPM detectado: 112.35'));

    const bpmInput = section.el.querySelector('.song-audio__bpm-manual');
    bpmInput.value = '';
    bpmInput.dispatchEvent(new Event('input', { bubbles: true }));

    const saveBtn = section.el.querySelector('[data-action="song-audio-save-metronome"]');
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();

    await vi.waitFor(() =>
      expect(songAudioApi.patchSongAudio).toHaveBeenCalledWith('song-1', { bpmManual: null }),
    );

    section.destroy();
  });

  it('metrónomo: error al guardar se muestra inline', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: {
        url: 'https://x/full.mp3',
        durationSec: 100,
        bpmManual: null,
        timeSignature: null,
        beatAnchor: null,
      },
      timings: { status: 'ready', lines: [{}], bpmDetected: 112.35 },
    });
    songAudioApi.patchSongAudio.mockRejectedValue(new Error('bpm invalido'));
    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() => expect(section.el.textContent).toContain('BPM detectado: 112.35'));

    const bpmInput = section.el.querySelector('.song-audio__bpm-manual');
    bpmInput.value = '999';
    bpmInput.dispatchEvent(new Event('input', { bubbles: true }));
    section.el.querySelector('[data-action="song-audio-save-metronome"]').click();

    await vi.waitFor(() =>
      expect(section.el.querySelector('.song-audio__error')?.textContent).toContain('bpm invalido'),
    );
    expect(section.el.querySelector('.song-audio__bpm-manual').value).toBe('999');
    expect(section.el.querySelector('[data-action="song-audio-save-metronome"]').disabled).toBe(
      false,
    );

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

  it('polling: un GET que rechaza no deja unhandled rejection, muestra error visible y sigue reintentando', async () => {
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
      if (call === 2) {
        return Promise.reject(new Error('red caída'));
      }
      return Promise.resolve({
        audio: { url: 'https://x/full.mp3', durationSec: 100 },
        timings: { status: 'processing' },
      });
    });

    const section = createSongAudioSection({ songId: 'song-1' });
    container.appendChild(section.el);

    await vi.waitFor(() => expect(songAudioApi.getSongAudio).toHaveBeenCalledTimes(1));

    // Tick 2: el GET rechaza — el catch debe absorberlo (sin unhandled
    // rejection) y mostrar un error inline, sin matar el intervalo.
    await vi.advanceTimersByTimeAsync(5001);
    expect(songAudioApi.getSongAudio).toHaveBeenCalledTimes(2);
    expect(section.el.querySelector('.song-audio__error')?.textContent).toContain(
      'No se pudo consultar el estado del audio',
    );

    // Tick 3: el polling sigue vivo y vuelve a intentar solo.
    await vi.advanceTimersByTimeAsync(5001);
    expect(songAudioApi.getSongAudio).toHaveBeenCalledTimes(3);

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

  describe('corrección manual por línea', () => {
    function mkSong() {
      return {
        id: 'song-1',
        sections: [
          {
            type: 'verse',
            lines: [
              { text: 'Primera línea de la canción que dura bastante mas de cuarenta caracteres' },
              { text: 'Segunda línea' },
              { text: 'Tercera línea' },
            ],
          },
        ],
      };
    }

    function mockReady(lines, durationSec = 100) {
      songAudioApi.getSongAudio.mockResolvedValue({
        audio: { url: 'https://x/full.mp3', durationSec },
        timings: { status: 'ready', lines },
      });
    }

    beforeEach(() => {
      HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
      HTMLMediaElement.prototype.pause = vi.fn();
    });

    it('muestra el texto real de la línea truncado; sin getSong cae a "Línea N"', async () => {
      mockReady([
        { i: 0, startMs: 0 },
        { i: 1, startMs: 1000 },
        { i: 2, startMs: 2000 },
      ]);
      const section = createSongAudioSection({ songId: 'song-1', getSong: () => mkSong() });
      container.appendChild(section.el);

      await vi.waitFor(() =>
        expect(section.el.querySelector('.song-audio__confidence')).not.toBeNull(),
      );

      const labels = section.el.querySelectorAll('.audio-line__label');
      expect(labels[0].textContent).toContain('…');
      expect(labels[0].textContent).not.toContain('Línea 1');
      expect(labels[1].textContent).toContain('Segunda línea');

      section.destroy();

      mockReady([{ i: 0, startMs: 0 }]);
      const section2 = createSongAudioSection({ songId: 'song-1' });
      container.appendChild(section2.el);
      await vi.waitFor(() =>
        expect(section2.el.querySelector('.audio-line__label')?.textContent).toContain('Línea 1'),
      );
      section2.destroy();
    });

    it('click en una fila expande el panel; click en otra fila colapsa la primera', async () => {
      mockReady([
        { i: 0, startMs: 0 },
        { i: 1, startMs: 1000 },
      ]);
      const section = createSongAudioSection({ songId: 'song-1' });
      container.appendChild(section.el);
      await vi.waitFor(() =>
        expect(section.el.querySelectorAll('.audio-line__header').length).toBe(2),
      );

      const headers = () => section.el.querySelectorAll('.audio-line__header');
      headers()[0].click();
      expect(section.el.querySelectorAll('[data-action="line-nudge"]').length).toBe(4);
      expect(section.el.querySelector('[data-action="line-listen"]')).not.toBeNull();
      expect(section.el.querySelector('[data-action="line-save"]')).not.toBeNull();
      expect(section.el.querySelector('[data-action="line-cancel"]')).not.toBeNull();

      headers()[1].click();
      expect(section.el.querySelectorAll('.audio-line__editor').length).toBe(1);
      expect(headers()[1].nextElementSibling?.classList.contains('audio-line__editor')).toBe(true);

      section.destroy();
    });

    it('nudge: clampa contra la vecina previa y deshabilita el botón al llegar al límite', async () => {
      mockReady([
        { i: 0, startMs: 1000 },
        { i: 1, startMs: 4000 },
        { i: 2, startMs: 9000 },
      ]);
      const section = createSongAudioSection({ songId: 'song-1' });
      container.appendChild(section.el);
      await vi.waitFor(() =>
        expect(section.el.querySelectorAll('.audio-line__header').length).toBe(3),
      );

      section.el.querySelectorAll('.audio-line__header')[1].click();
      const minus500 = () => section.el.querySelector('[data-action="line-nudge"][data-delta="-500"]');
      const msDisplay = () => section.el.querySelector('.audio-line__ms');

      expect(msDisplay().textContent).toBe('0:04.00');

      // min = prev.startMs + 1 = 1001. 4000 -> 3500 -> 3000 -> 2500 -> 2000 -> 1500 -> clamp a 1001
      for (let n = 0; n < 6; n += 1) minus500().click();
      expect(msDisplay().textContent).toBe('0:01.00'); // 1001ms redondeado a centésimas
      expect(minus500().disabled).toBe(true);

      // un click más no debe bajar del límite (el botón está deshabilitado)
      minus500().click();
      expect(msDisplay().textContent).toBe('0:01.00');

      section.destroy();
    });

    it('nudge: clampa contra la vecina siguiente; última línea usa duración como techo', async () => {
      mockReady(
        [
          { i: 0, startMs: 1000 },
          { i: 1, startMs: 4000 },
        ],
        4.6,
      );
      const section = createSongAudioSection({ songId: 'song-1' });
      container.appendChild(section.el);
      await vi.waitFor(() =>
        expect(section.el.querySelectorAll('.audio-line__header').length).toBe(2),
      );

      // última línea: sin next, techo = durationSec*1000 = 4600
      section.el.querySelectorAll('.audio-line__header')[1].click();
      const plus500 = () => section.el.querySelector('[data-action="line-nudge"][data-delta="500"]');
      plus500().click(); // 4500
      expect(section.el.querySelector('.audio-line__ms').textContent).toBe('0:04.50');
      plus500().click(); // clamp a 4600
      expect(section.el.querySelector('.audio-line__ms').textContent).toBe('0:04.60');
      expect(plus500().disabled).toBe(true);

      // primera línea: sin prev, piso = 0
      section.el.querySelectorAll('.audio-line__header')[1].click(); // colapsa
      section.el.querySelectorAll('.audio-line__header')[0].click(); // expande la primera
      const minus500First = () =>
        section.el.querySelector('[data-action="line-nudge"][data-delta="-500"]');
      minus500First().click();
      minus500First().click();
      expect(section.el.querySelector('.audio-line__ms').textContent).toBe('0:00.00');
      expect(minus500First().disabled).toBe(true);

      section.destroy();
    });

    it('line-save llama a patchLineTiming y refresca; line-cancel colapsa sin PATCH', async () => {
      mockReady([
        { i: 0, startMs: 1000 },
        { i: 1, startMs: 4000 },
      ]);
      songAudioApi.patchLineTiming.mockResolvedValue(undefined);
      const section = createSongAudioSection({ songId: 'song-1' });
      container.appendChild(section.el);
      await vi.waitFor(() =>
        expect(section.el.querySelectorAll('.audio-line__header').length).toBe(2),
      );

      section.el.querySelectorAll('.audio-line__header')[1].click();
      section.el.querySelector('[data-action="line-nudge"][data-delta="100"]').click();
      section.el.querySelector('[data-action="line-save"]').click();

      await vi.waitFor(() =>
        expect(songAudioApi.patchLineTiming).toHaveBeenCalledWith('song-1', 1, 4100),
      );
      await vi.waitFor(() => expect(songAudioApi.getSongAudio).toHaveBeenCalledTimes(2));
      await vi.waitFor(() =>
        expect(section.el.querySelector('.audio-line__editor')).toBeNull(),
      );

      section.el.querySelectorAll('.audio-line__header')[0].click();
      section.el.querySelector('[data-action="line-nudge"][data-delta="100"]').click();
      section.el.querySelector('[data-action="line-cancel"]').click();
      expect(section.el.querySelector('.audio-line__editor')).toBeNull();
      expect(songAudioApi.patchLineTiming).toHaveBeenCalledTimes(1);

      section.destroy();
    });

    it('línea manual: dot --manual, sr-only "Corregida a mano", contador en el resumen', async () => {
      mockReady([
        { i: 0, startMs: 0, score: 0.9, interpolated: false },
        { i: 1, startMs: 1000, score: 0.9, interpolated: false, manual: true },
        { i: 2, startMs: 2000, score: 0.9, interpolated: false, manual: true },
        { i: 3, startMs: 3000, score: 0.9, interpolated: false },
      ]);
      const section = createSongAudioSection({ songId: 'song-1' });
      container.appendChild(section.el);

      await vi.waitFor(() =>
        expect(section.el.querySelector('.song-audio__confidence')).not.toBeNull(),
      );

      const rows = section.el.querySelectorAll('.audio-line');
      expect(rows[1].classList.contains('audio-line--manual')).toBe(true);
      expect(rows[1].textContent).toContain('Corregida a mano');
      expect(section.el.textContent).toContain('2 corregidas a mano');

      section.destroy();
    });

    it('destroy() pausa el preview si estaba sonando', async () => {
      mockReady([{ i: 0, startMs: 0 }]);
      const section = createSongAudioSection({ songId: 'song-1' });
      container.appendChild(section.el);
      await vi.waitFor(() =>
        expect(section.el.querySelectorAll('.audio-line__header').length).toBe(1),
      );

      section.el.querySelector('.audio-line__header').click();
      section.el.querySelector('[data-action="line-listen"]').click();

      section.destroy();
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    });
  });
});
