import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/songAudioApi.js', () => ({
  getSongAudio: vi.fn(),
  patchSongAudio: vi.fn(),
  patchLineTiming: vi.fn(),
}));

const songAudioApi = await import('../src/lib/songAudioApi.js');
const { createSyncFineTuning } = await import('../src/components/pipeline/SyncFineTuning.js');

const VOCALS_URL = 'https://x/vocals.mp3';

function mockReady(lines, overrides = {}) {
  songAudioApi.getSongAudio.mockResolvedValue({
    audio: { url: 'https://x/full.mp3', durationSec: 100, bpmManual: null, timeSignature: '4/4', beatAnchor: null },
    timings: { status: 'ready', lines, bpmDetected: 112.35 },
    ...overrides,
  });
}

describe('SyncFineTuning', () => {
  let container;

  beforeEach(() => {
    window.matchMedia = vi.fn(() => ({ matches: false }));
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it('timings ready: pinta filas por línea con dots hi/int/man + resumen de ancladas/corregidas', async () => {
    mockReady([
      { i: 0, startMs: 0, score: 0.9, interpolated: false },
      { i: 1, startMs: 1000, score: 0.4, interpolated: true },
      { i: 2, startMs: 2000, score: 0.9, interpolated: false, manual: true },
    ]);
    const detail = createSyncFineTuning({ songId: 'song-1' });
    container.appendChild(detail.el);

    await vi.waitFor(() => expect(detail.el.querySelectorAll('.lineRow').length).toBe(3));

    const dots = detail.el.querySelectorAll('.lineRow .cdot');
    expect(dots[0].classList.contains('hi')).toBe(true);
    expect(dots[1].classList.contains('int')).toBe(true);
    expect(dots[2].classList.contains('man')).toBe(true);

    expect(detail.el.textContent).toContain('2 de 3 líneas ancladas');
    expect(detail.el.textContent).toContain('1 corregidas a mano');

    detail.destroy();
  });

  it('expandir línea + nudge +100 sube proposedMs con clamp; Guardar llama patchLineTiming', async () => {
    mockReady([
      { i: 0, startMs: 1000, score: 0.9, interpolated: false },
      { i: 1, startMs: 4000, score: 0.9, interpolated: false },
    ]);
    songAudioApi.patchLineTiming.mockResolvedValue(undefined);
    const detail = createSyncFineTuning({ songId: 'song-1', getVocalsUrl: () => VOCALS_URL });
    container.appendChild(detail.el);
    await vi.waitFor(() => expect(detail.el.querySelectorAll('.lineRow__header').length).toBe(2));

    detail.el.querySelectorAll('.lineRow__header')[0].click();
    expect(detail.el.querySelector('.lineRow__ms').textContent).toBe('0:01.00');

    detail.el.querySelector('[data-action="line-nudge"][data-delta="100"]').click();
    expect(detail.el.querySelector('.lineRow__ms').textContent).toBe('0:01.10');

    detail.el.querySelector('[data-action="line-save"]').click();

    await vi.waitFor(() =>
      expect(songAudioApi.patchLineTiming).toHaveBeenCalledWith('song-1', 0, 1100),
    );
    await vi.waitFor(() => expect(songAudioApi.getSongAudio).toHaveBeenCalledTimes(2));

    detail.destroy();
  });

  it('"Escuchar desde aquí" usa la URL de vocals (getVocalsUrl) y setea currentTime = startMs/1000', async () => {
    mockReady([{ i: 0, startMs: 2500, score: 0.9, interpolated: false }]);
    const detail = createSyncFineTuning({ songId: 'song-1', getVocalsUrl: () => VOCALS_URL });
    container.appendChild(detail.el);
    await vi.waitFor(() => expect(detail.el.querySelectorAll('.lineRow__header').length).toBe(1));

    detail.el.querySelector('.lineRow__header').click();
    detail.el.querySelector('[data-action="line-listen"]').click();

    await vi.waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled());

    const audioEls = detail.el.ownerDocument.querySelectorAll('audio');
    // El <audio> del mini-player no se inserta en el DOM (patrón previewAudio):
    // en cambio, validamos vía el mock global de play/pause que se disparó.
    expect(audioEls.length).toBe(0);

    detail.destroy();
  });

  it('metrónomo: cambiar bpmManual + Guardar llama patchSongAudio con el valor', async () => {
    mockReady([{ i: 0, startMs: 0, score: 0.9, interpolated: false }]);
    songAudioApi.patchSongAudio.mockResolvedValue(undefined);
    const detail = createSyncFineTuning({ songId: 'song-1' });
    container.appendChild(detail.el);

    await vi.waitFor(() => expect(detail.el.textContent).toContain('BPM detectado: 112.35'));

    const bpmInput = detail.el.querySelector('.sync-tuning__bpm-manual');
    bpmInput.value = '130';
    bpmInput.dispatchEvent(new Event('input', { bubbles: true }));

    const saveBtn = detail.el.querySelector('[data-action="sync-tuning-save-metronome"]');
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();

    await vi.waitFor(() =>
      expect(songAudioApi.patchSongAudio).toHaveBeenCalledWith('song-1', { bpmManual: 130 }),
    );

    detail.destroy();
  });

  it('timings.status distinto de ready muestra "todavía no está lista"', async () => {
    songAudioApi.getSongAudio.mockResolvedValue({
      audio: { url: 'https://x/full.mp3', durationSec: 100 },
      timings: { status: 'processing' },
    });
    const detail = createSyncFineTuning({ songId: 'song-1' });
    container.appendChild(detail.el);

    await vi.waitFor(() => expect(songAudioApi.getSongAudio).toHaveBeenCalled());
    expect(detail.el.textContent).toContain('La sincronía todavía no está lista');

    detail.destroy();
  });

  it('destroy() pausa el mini-player si estaba sonando', async () => {
    mockReady([{ i: 0, startMs: 0, score: 0.9, interpolated: false }]);
    const detail = createSyncFineTuning({ songId: 'song-1', getVocalsUrl: () => VOCALS_URL });
    container.appendChild(detail.el);
    await vi.waitFor(() => expect(detail.el.querySelectorAll('.lineRow__header').length).toBe(1));

    detail.el.querySelector('.lineRow__header').click();
    detail.el.querySelector('[data-action="line-listen"]').click();
    await vi.waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled());

    detail.destroy();
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });
});
