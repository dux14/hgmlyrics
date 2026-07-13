import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  computeOverlapAdjustments,
  resolveLabelOverlaps,
  observeLabelOverlaps,
} from '../src/lib/labelOverlap.js';
import { buildTonoLineHTML, buildMixedLineHTML } from '../src/lib/lyricsRender.js';

describe('computeOverlapAdjustments', () => {
  it('sin colisión ni rebase, todos los ajustes son 0', () => {
    const items = [
      { left: 0, right: 20, top: 0 },
      { left: 40, right: 60, top: 0 },
      { left: 80, right: 100, top: 0 },
    ];
    expect(computeOverlapAdjustments(items, 4, Infinity)).toEqual([0, 0, 0]);
  });

  it('dos labels solapados en la misma fila reciben el ajuste mínimo en el primero', () => {
    // El segundo empieza (left=15) antes de que el primero termine (right=20) + gap.
    const items = [
      { left: 0, right: 20, top: 0 },
      { left: 15, right: 35, top: 0 },
    ];
    const gap = 4;
    const adjust = computeOverlapAdjustments(items, gap, Infinity);
    // needed = right[0] + gap - left[1] = 20 + 4 - 15 = 9
    expect(adjust[0]).toBe(9);
    expect(adjust[1]).toBe(0);
  });

  it('labels en filas distintas (top diferente) no colisionan aunque se solapen en X', () => {
    const items = [
      { left: 0, right: 50, top: 0 },
      { left: 10, right: 60, top: 20 }, // fila distinta, top muy separado
    ];
    expect(computeOverlapAdjustments(items, 4, Infinity)).toEqual([0, 0]);
  });

  it('cadena de 3 solapados acumula el empuje en cascada', () => {
    const items = [
      { left: 0, right: 20, top: 0 },
      { left: 15, right: 35, top: 0 },
      { left: 30, right: 50, top: 0 },
    ];
    const gap = 2;
    const adjust = computeOverlapAdjustments(items, gap, Infinity);
    // i=0 vs i=1: needed = 20 + 2 - 15 = 7 → adjust[0] = 7
    // tras empujar i=1..2 en +7: item1 efectivo pasa a left=22,right=42
    // i=1 vs i=2: item2 efectivo (tras heredar +7) left=37,right=57
    //   needed = effectiveRight[1] (42) + 2 - effectiveLeft[2] (37) = 7 → adjust[1] = 7
    expect(adjust[0]).toBe(7);
    expect(adjust[1]).toBe(7);
    expect(adjust[2]).toBe(0);
  });

  it('rebase de boundRight empuja al segmento anterior de la misma fila', () => {
    const items = [
      { left: 0, right: 20, top: 0 },
      { left: 30, right: 55, top: 0 }, // se pasa del borde (boundRight=50)
    ];
    const adjust = computeOverlapAdjustments(items, 2, 50);
    // overshoot = 55 - 50 = 5, va al segmento anterior (índice 0).
    expect(adjust[0]).toBe(5);
    expect(adjust[1]).toBe(0);
  });

  it('rebase de boundRight en el primer label de la fila no tiene a quién empujar (límite documentado)', () => {
    const items = [{ left: 0, right: 60, top: 0 }];
    const adjust = computeOverlapAdjustments(items, 2, 50);
    expect(adjust).toEqual([0]);
  });

  it('boundRight = Infinity nunca dispara el ajuste de borde', () => {
    const items = [{ left: 0, right: 10000, top: 0 }];
    expect(computeOverlapAdjustments(items, 2, Infinity)).toEqual([0]);
  });

  it('lista vacía devuelve arreglo vacío', () => {
    expect(computeOverlapAdjustments([], 4, Infinity)).toEqual([]);
  });
});

describe('resolveLabelOverlaps (smoke jsdom)', () => {
  // Misma línea de tono que usan los tests de lyricsRender.test.js — dos
  // grupos con nota real, para que el HTML generado por el builder traiga
  // labels `.float-label.tono-note` de verdad (no fabricados a mano).
  const tonoLine = {
    text: 'San to canta',
    groups: [
      { voiceId: 'v1', start: 0, end: 3, note: 'B3' },
      { voiceId: 'v1', start: 4, end: 6, note: 'A3' },
    ],
  };

  // Línea mixta equivalente a la de buildMixedLineHTML — carril de acordes +
  // carril de notas ambos con contenido real.
  const mixedLine = {
    text: 'San to, Dioos del',
    chords: [],
    groups: [
      { voiceId: 'v1', start: 0, end: 3, note: 'B3' },
      { voiceId: 'v1', start: 4, end: 6, note: 'A3' },
    ],
  };
  const mixedChords = [
    { pos: 0, ch: 'D' },
    { pos: 14, ch: 'G' },
  ];

  it('corre sin lanzar sobre HTML real de modo Tono (buildTonoLineHTML), aunque getBoundingClientRect dé 0 en jsdom', () => {
    const html = buildTonoLineHTML(tonoLine, 'v1', 'voice-text--soprano');
    const root = document.createElement('div');
    root.innerHTML = `<p class="lyrics__line lyrics__line--tono">${html}</p>`;
    // El builder real sí produce labels de nota — confirma que el smoke no
    // está probando una línea vacía.
    expect(root.querySelectorAll('.float-label.tono-note').length).toBeGreaterThan(0);
    expect(() => resolveLabelOverlaps(root)).not.toThrow();
  });

  it('limpia data-overlap-fix de una pasada previa antes de volver a medir', () => {
    // Un solo grupo (un único label en el carril): sin vecino con quien
    // colisionar. En jsdom `getBoundingClientRect` da 0 en TODOS los rects
    // (incluida la línea, el `boundRight`), así que ni la colisión (a) ni el
    // rebase de borde (b) se disparan aquí — a diferencia del smoke anterior
    // (dos grupos), donde dos labels con rects idénticos en 0 SÍ producen un
    // ajuste porque el hueco mínimo (`gapPx`) exige separación aunque no
    // haya geometría real. Este caso aislado deja ver la limpieza sola.
    const singleGroupLine = {
      text: 'San to canta',
      groups: [{ voiceId: 'v1', start: 0, end: 3, note: 'B3' }],
    };
    const html = buildTonoLineHTML(singleGroupLine, 'v1', 'voice-text--soprano');
    const root = document.createElement('div');
    root.innerHTML = `<p class="lyrics__line lyrics__line--tono">${html}</p>`;
    // Simula el residuo de una pasada anterior sobre el segmento real con label.
    const firstSeg = root.querySelector('.line-seg');
    firstSeg.setAttribute('data-overlap-fix', '1');
    firstSeg.style.marginRight = '12px';

    resolveLabelOverlaps(root);

    // Sin vecino ni rebase de borde (rects a 0, un solo label por fila), la
    // pasada no reaplica ajuste: el residuo previo queda limpio.
    expect(firstSeg.hasAttribute('data-overlap-fix')).toBe(false);
    expect(firstSeg.style.marginRight).toBe('');
  });

  it('modo mixto (buildMixedLineHTML): separa el carril de acordes del de notas sin lanzar', () => {
    const html = buildMixedLineHTML(mixedLine, mixedChords, 'v1', 'voice-text--tenor', {});
    const root = document.createElement('div');
    root.innerHTML = `<p class="lyrics__line lyrics__line--mix">${html}</p>`;
    expect(root.querySelectorAll('.mix-rail--chord i').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.mix-rail--note i').length).toBeGreaterThan(0);
    expect(() => resolveLabelOverlaps(root)).not.toThrow();
  });

  it('rootEl nulo o sin líneas no lanza', () => {
    expect(() => resolveLabelOverlaps(null)).not.toThrow();
    const empty = document.createElement('div');
    expect(() => resolveLabelOverlaps(empty)).not.toThrow();
  });

  it('resuelve cuando rootEl es la propia línea (no un contenedor de varias) — caso ImmersiveView.setActiveIndex', () => {
    // ImmersiveView aplica la clase de modo directamente sobre el nodo
    // `.imm-line` (ver renderRoll/renderLineContent), así que el nodo que se
    // pasa a resolveLabelOverlaps tras repintar una línea individual ES la
    // línea, no un envoltorio con descendientes .lyrics__line--*. Un solo
    // grupo (un único label): sin vecino con quien colisionar en jsdom (ver
    // nota del test de limpieza más arriba sobre rects a 0).
    const singleGroupLine = {
      text: 'San to canta',
      groups: [{ voiceId: 'v1', start: 0, end: 3, note: 'B3' }],
    };
    const html = buildTonoLineHTML(singleGroupLine, 'v1', 'voice-text--soprano');
    const lineEl = document.createElement('div');
    lineEl.className = 'imm-line lyrics__line--tono';
    lineEl.innerHTML = html;
    const firstSeg = lineEl.querySelector('.line-seg');
    firstSeg.setAttribute('data-overlap-fix', '1');
    firstSeg.style.marginRight = '99px';

    // querySelectorAll(LINE_SELECTOR) sobre lineEl NUNCA incluye a lineEl
    // mismo — si resolveLabelOverlaps no contemplara este caso, no limpiaría
    // ni volvería a medir nada y el residuo de 99px quedaría intacto.
    resolveLabelOverlaps(lineEl);

    expect(firstSeg.hasAttribute('data-overlap-fix')).toBe(false);
  });
});

describe('observeLabelOverlaps (stubs, sin layout real)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('disconnect() cancela el rAF pendiente', () => {
    let nextId = 1;
    const rafStub = vi.fn(() => nextId++);
    const cafStub = vi.fn();
    vi.stubGlobal('requestAnimationFrame', rafStub);
    vi.stubGlobal('cancelAnimationFrame', cafStub);

    const root = document.createElement('div');
    const disconnect = observeLabelOverlaps(root);

    // scheduleRun() inicial pide un rAF; como el stub nunca invoca el
    // callback, ese rAF queda "pendiente" cuando llamamos a disconnect().
    expect(rafStub).toHaveBeenCalledTimes(1);
    disconnect();
    expect(cafStub).toHaveBeenCalledTimes(1);
    expect(cafStub).toHaveBeenCalledWith(1);
  });

  it('una resolución de document.fonts.ready que llega DESPUÉS de disconnect() no reprograma nada (guard fontsReadyCancelled)', async () => {
    let resolveFontsReady;
    const fontsReadyPromise = new Promise((resolve) => {
      resolveFontsReady = resolve;
    });
    const originalFonts = document.fonts;
    Object.defineProperty(document, 'fonts', {
      value: { ready: fontsReadyPromise },
      configurable: true,
    });

    const rafStub = vi.fn(() => 1);
    const cafStub = vi.fn();
    vi.stubGlobal('requestAnimationFrame', rafStub);
    vi.stubGlobal('cancelAnimationFrame', cafStub);

    const root = document.createElement('div');
    const disconnect = observeLabelOverlaps(root);
    expect(rafStub).toHaveBeenCalledTimes(1); // scheduleRun() inicial

    disconnect();
    resolveFontsReady();
    await fontsReadyPromise;
    await Promise.resolve(); // deja correr el .then() de fonts.ready

    // Si el guard no cortara, fonts.ready dispararía un scheduleRun extra
    // (un segundo requestAnimationFrame) después de desconectar.
    expect(rafStub).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'fonts', { value: originalFonts, configurable: true });
  });

  it('sin ResizeObserver en el entorno (caso real de jsdom aquí), no lanza al montar ni al desconectar', () => {
    expect(typeof ResizeObserver).toBe('undefined');
    const root = document.createElement('div');
    let disconnect;
    expect(() => {
      disconnect = observeLabelOverlaps(root);
    }).not.toThrow();
    expect(() => disconnect()).not.toThrow();
  });
});
