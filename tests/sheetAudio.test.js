// @vitest-environment jsdom
// tests/sheetAudio.test.js — SheetAudio.js es una envoltura fina: monta
// createMultiTrackPlayer con la única pista de voz, delega la reproducción y
// renueva la URL firmada una sola vez si el audio interno falla.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let fakePlayer;
let lastPlayer;
const timeCbsByPlayer = new Map();

function makeFakePlayer() {
  const el = document.createElement('div');
  const mixer = document.createElement('div');
  const cbs = [];
  const player = {
    el,
    els: { mixer },
    destroy: vi.fn(),
    onTime: vi.fn((cb) => {
      cbs.push(cb);
      return () => {};
    }),
    seek: vi.fn(),
    pause: vi.fn(),
  };
  timeCbsByPlayer.set(player, cbs);
  player.emitTime = (sec) => {
    for (const cb of cbs) cb(sec);
  };
  return player;
}

const createMultiTrackPlayer = vi.fn(() => {
  const p = makeFakePlayer();
  // `fakePlayer` es el primer player montado en el test (el que se destruye
  // al renovar la URL); `lastPlayer` es siempre el más reciente.
  if (!fakePlayer) fakePlayer = p;
  lastPlayer = p;
  return p;
});
vi.mock('../src/components/pipeline/MultiTrackPlayer.js', () => ({
  createMultiTrackPlayer: (...args) => createMultiTrackPlayer(...args),
}));

const getPipelineRun = vi.fn();
vi.mock('../src/lib/pipelineApi.js', () => ({
  getPipelineRun: (...args) => getPipelineRun(...args),
}));

const { SheetAudio } = await import('../src/components/pipeline/lyrics/SheetAudio.js');

beforeEach(() => {
  createMultiTrackPlayer.mockClear();
  getPipelineRun.mockReset();
  fakePlayer = undefined;
  lastPlayer = undefined;
});

// El `error` de un elemento de audio interno del player NO burbujea por
// default: se simula uno dentro de player.el y se dispara igual (jsdom sí
// burbujea eventos custom si no se pide lo contrario, pero el listener real
// escucha en fase de captura, que también recibe el evento).
function failAudio() {
  const inner = document.createElement('audio');
  fakePlayer.el.appendChild(inner);
  inner.dispatchEvent(new Event('error'));
  return Promise.resolve().then(() => Promise.resolve());
}

describe('SheetAudio', () => {
  it('no monta el transporte hasta open()', () => {
    const a = SheetAudio({ songId: 's1', url: 'https://x/v.mp3' });
    expect(createMultiTrackPlayer).not.toHaveBeenCalled();
    a.open();
    expect(createMultiTrackPlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        tracks: [expect.objectContaining({ kind: 'vocals' })],
        structure: null,
      }),
    );
  });

  it('oculta la fila de mezcla, que con una pista no significa nada', () => {
    const a = SheetAudio({ songId: 's1', url: 'https://x/v.mp3' });
    a.open();
    expect(fakePlayer.els.mixer.hidden).toBe(true);
  });

  it('seek recibe milisegundos y le pasa segundos al player', () => {
    const a = SheetAudio({ songId: 's1', url: 'https://x/v.mp3' });
    a.seek(9000);
    expect(fakePlayer.seek).toHaveBeenCalledWith(9);
  });

  it('el error del audio renueva la URL una sola vez y reanuda en el mismo segundo', async () => {
    getPipelineRun.mockResolvedValue({
      run: { phases: { stems: { tracks: { vocals: 'https://x/v2.mp3' } } } },
    });
    const a = SheetAudio({ songId: 's1', url: 'https://x/v1.mp3' });
    a.open();
    fakePlayer.emitTime(42);
    await failAudio();
    expect(getPipelineRun).toHaveBeenCalledTimes(1);
    expect(fakePlayer.destroy).toHaveBeenCalled();
    expect(lastPlayer.seek).toHaveBeenCalledWith(42);
  });

  it('un segundo fallo avisa y no reintenta de nuevo', async () => {
    getPipelineRun.mockRejectedValue(new Error('502'));
    const onError = vi.fn();
    const a = SheetAudio({ songId: 's1', url: 'https://x/v1.mp3', onError });
    a.open();
    await failAudio();
    await failAudio();
    expect(getPipelineRun).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('No se pudo cargar la voz aislada');
  });

  it('close() y destroy() no dejan el transporte vivo', () => {
    const a = SheetAudio({ songId: 's1', url: 'https://x/v.mp3' });
    a.open();
    a.close();
    expect(fakePlayer.destroy).toHaveBeenCalledTimes(1);
    expect(a.isOpen()).toBe(false);
    a.destroy();
    expect(fakePlayer.destroy).toHaveBeenCalledTimes(1);
  });
});
