import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Verificación de integración del MODO METRÓNOMO dentro del componente real
// `renderTuner` (no del motor puro, que ya cubre metronome.test.js). Cubre lo
// que se pediría en una verificación manual de browser pero de forma
// determinista: render sin micrófono, play/stop, sincronía visual de los
// puntos al reloj de audio, persistencia, y la REGRESIÓN del code-review
// (cambiar de compás mientras suena debe reenganchar el visual a los puntos
// nuevos, no congelarse en nodos detached).

// --- Stubs de imports transitivos de Tuner que necesitan entorno real ---
vi.mock('../src/styles/tuner.css', () => ({}));
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  },
}));
vi.mock('../src/lib/store.js', () => ({ fetchSongDetail: vi.fn() }));
vi.mock('../src/lib/pitch.js', () => ({ createPitchDetector: vi.fn() }));
vi.mock('../src/lib/loopbackTest.js', () => ({ runLoopbackTest: vi.fn() }));
vi.mock('../src/lib/tonePlayer.js', () => ({
  createTonePlayer: vi.fn(() => ({ play: vi.fn(), stop: vi.fn(), close: vi.fn() })),
}));
vi.mock('../src/lib/warmup.js', () => ({ buildWarmup: vi.fn(() => []), DEFAULT_RANGES: {} }));

// idb-keyval: controlable por test (get para restaurar, set para asserts).
const idbGet = vi.fn();
const idbSet = vi.fn(() => Promise.resolve());
vi.mock('idb-keyval', () => ({ get: (...a) => idbGet(...a), set: (...a) => idbSet(...a) }));

const { renderTuner } = await import('../src/components/Tuner.js');

// --- Mock de AudioContext con reloj de audio controlable ---
let audioNow = 0;
function makeAudioContextClass() {
  return class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.destination = {};
    }
    get currentTime() {
      return audioNow;
    }
    createOscillator() {
      return {
        type: '',
        frequency: { value: 0 },
        connect: (n) => n,
        start: () => {},
        stop: () => {},
      };
    }
    createGain() {
      return {
        gain: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
        connect: (n) => n,
      };
    }
    resume() {}
    close() {}
  };
}

// --- Mock de requestAnimationFrame con flush manual ---
let rafCb = null;
function flushRaf() {
  const cb = rafCb;
  rafCb = null;
  if (cb) cb();
}

let container;

beforeEach(() => {
  audioNow = 0;
  rafCb = null;
  idbGet.mockReset().mockResolvedValue(undefined);
  idbSet.mockReset().mockResolvedValue(undefined);
  globalThis.AudioContext = makeAudioContextClass();
  // jsdom no trae Worker → el motor cae a setInterval (lo controlamos con fake timers).
  delete globalThis.Worker;
  // useFakeTimers fakea también rAF; nuestros overrides van DESPUÉS para ganar.
  vi.useFakeTimers();
  globalThis.requestAnimationFrame = (cb) => {
    rafCb = cb;
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {
    rafCb = null;
  };
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  vi.useRealTimers();
  container.remove();
});

// Espera a que resuelva la cadena ensureMetronome().then(paintBody) que dispara
// el primer pintado del modo (no está await-eada dentro de renderTuner).
async function flushMicrotasks() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function mountMetronomo() {
  await renderTuner(container, { query: 'mode=metronomo' });
  await flushMicrotasks();
}

describe('renderTuner — modo metrónomo (integración)', () => {
  it('renderiza el modo SIN micrófono (bypass del gate de permiso)', async () => {
    await mountMetronomo();
    // No aparece el gate de permiso de micrófono.
    expect(container.querySelector('#tuner-grant')).toBeNull();
    // Sí aparece la UI del metrónomo.
    expect(container.querySelector('#metro-play')).not.toBeNull();
    expect(container.querySelector('#metro-tap')).not.toBeNull();
    // 4/4 por defecto → 4 puntos, el primero acentuado.
    const dots = container.querySelectorAll('.metro-dot');
    expect(dots.length).toBe(4);
    expect(dots[0].classList.contains('metro-dot--accent')).toBe(true);
    expect(container.querySelector('#metro-bpm-num').textContent).toBe('120');
  });

  it('restaura BPM y compás persistidos al montar', async () => {
    idbGet.mockResolvedValue({ bpm: 90, signature: '3/4' });
    await mountMetronomo();
    expect(container.querySelector('#metro-bpm-num').textContent).toBe('90');
    expect(container.querySelectorAll('.metro-dot').length).toBe(3);
  });

  it('Play arranca el metrónomo y el visual enciende el primer punto en sincronía', async () => {
    await mountMetronomo();
    const playBtn = container.querySelector('#metro-play');
    expect(playBtn.textContent).toBe('Iniciar');

    audioNow = 0;
    playBtn.click(); // start() agenda el beat 0 en t=0 y arranca el loop visual
    expect(playBtn.textContent).toBe('Detener');

    flushRaf(); // draw(): t=0 descola {beat:0,time:0}
    const dots = container.querySelectorAll('.metro-dot');
    expect(dots[0].classList.contains('metro-dot--on')).toBe(true);
    expect(container.querySelector('#metro-count').textContent).toBe('1');
  });

  it('REGRESIÓN: cambiar de compás mientras suena reengancha el visual a los puntos nuevos', async () => {
    await mountMetronomo();
    const playBtn = container.querySelector('#metro-play');
    audioNow = 0;
    playBtn.click();
    flushRaf();
    const oldDots = container.querySelectorAll('.metro-dot');
    expect(oldDots.length).toBe(4);
    expect(oldDots[0].classList.contains('metro-dot--on')).toBe(true);

    // Cambiar a 6/8 estando en marcha.
    container.querySelector('.metro-sig__btn[data-sig="6/8"]').click();

    const newDots = container.querySelectorAll('.metro-dot');
    expect(newDots.length).toBe(6); // re-render del nuevo compás
    expect(newDots[0]).not.toBe(oldDots[0]); // nodos nuevos (DOM reemplazado)
    expect(playBtn.textContent).toBe('Detener'); // sigue sonando

    // Avanzar el reloj de audio y disparar el scheduler (setInterval) para
    // que se agende el siguiente beat (1) y se encole.
    audioNow = 0.6;
    vi.advanceTimersByTime(30);
    flushRaf();

    // El visual debe encender un punto NUEVO (no congelarse en los detached).
    expect(newDots[1].classList.contains('metro-dot--on')).toBe(true);
    expect(container.querySelector('#metro-count').textContent).toBe('2');
  });

  it('Stop detiene el metrónomo y limpia el contador', async () => {
    await mountMetronomo();
    const playBtn = container.querySelector('#metro-play');
    playBtn.click();
    flushRaf();
    expect(playBtn.textContent).toBe('Detener');
    playBtn.click();
    expect(playBtn.textContent).toBe('Iniciar');
    expect(container.querySelector('#metro-count').textContent).toBe('—');
  });

  it('las flechas ajustan el BPM y persisten', async () => {
    await mountMetronomo();
    const up = container.querySelector('#metro-up');
    up.dispatchEvent(new Event('pointerdown'));
    up.dispatchEvent(new Event('pointerup'));
    expect(container.querySelector('#metro-bpm-num').textContent).toBe('121');
    expect(idbSet).toHaveBeenCalledWith(
      'tuner:metronome',
      expect.objectContaining({ bpm: 121, signature: '4/4' }),
    );
  });
});
