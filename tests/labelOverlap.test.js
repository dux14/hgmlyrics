import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  computeOverlapAdjustments,
  decideNotePromotions,
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

describe('decideNotePromotions', () => {
  it('lista vacía no promueve nada', () => {
    expect(decideNotePromotions([], 4)).toEqual(new Set());
  });

  it('un solo item nunca se promueve (no tiene vecino a su izquierda)', () => {
    const items = [{ left: 0, right: 20, top: 0 }];
    expect(decideNotePromotions(items, 4)).toEqual(new Set());
  });

  it('sin colisión, ningún item se promueve', () => {
    const items = [
      { left: 0, right: 20, top: 0 },
      { left: 40, right: 60, top: 0 },
      { left: 80, right: 100, top: 0 },
    ];
    expect(decideNotePromotions(items, 4)).toEqual(new Set());
  });

  it('dos items colisionados: se promueve el de la DERECHA del par', () => {
    const items = [
      { left: 0, right: 20, top: 0 },
      { left: 15, right: 35, top: 0 }, // choca con el primero (gap=4: 20+4>15)
    ];
    expect(decideNotePromotions(items, 4)).toEqual(new Set([1]));
  });

  it('items en filas distintas (top diferente) nunca compiten, aunque se solapen en X', () => {
    const items = [
      { left: 0, right: 50, top: 0 },
      { left: 10, right: 60, top: 20 },
    ];
    expect(decideNotePromotions(items, 4)).toEqual(new Set());
  });

  it('cadena de 3+ colisionados: el ancla no cambia tras promover, así que el 3ro se compara contra el 1ro (no contra el promovido)', () => {
    // A[0,20] y B[15,35] chocan (gap=2 → 20+2>15) → B se promueve, el ancla
    // SIGUE siendo A. C[36,56] no choca con A (20+2=22 <= 36) → C se queda
    // abajo. Si el ancla hubiera pasado a B (bug), C sí competiría con B
    // ([15,35]) y probablemente también se promovería — este test fija el
    // comportamiento correcto: la nota promovida deja de "ocupar" el carril
    // de abajo, así que no arrastra promociones en cascada innecesarias.
    const items = [
      { left: 0, right: 20, top: 0 },
      { left: 15, right: 35, top: 0 },
      { left: 36, right: 56, top: 0 },
    ];
    expect(decideNotePromotions(items, 2)).toEqual(new Set([1]));
  });

  it('3 sílabas de 1 carácter consecutivas que TODAS chocan entre sí: se promueven la 2da y la 3ra', () => {
    // A[0,10], B[8,18] choca con A (gap=1: 10+1>8) → B promovido, ancla sigue en A.
    // C[16,26]: contra el ancla A (right=10+1=11 <= 16) NO choca... pero si
    // C también choca con B habría que evaluarlo en el carril de arriba (eso
    // lo resuelve el margin-right residual de runPass sobre el sub-carril
    // promovido, no esta función). Aquí armamos un caso donde C SÍ choca
    // contra el ancla (A se mueve más a la derecha) para forzar su propia
    // promoción.
    const items = [
      { left: 0, right: 10, top: 0 },
      { left: 8, right: 18, top: 0 },
      { left: 9, right: 19, top: 0 },
    ];
    expect(decideNotePromotions(items, 1)).toEqual(new Set([1, 2]));
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

  it('acumula el margin-right entre pasadas en vez de sobrescribirlo (regresión: etiquetas pegadas en la misma palabra)', () => {
    // Fixture en modo ACORDES (no Tono/Mix): desde la promoción vertical
    // (`decideNotePromotions`), dos NOTAS colisionadas en Tono/Mix se
    // resuelven promoviendo la de la derecha, no con `margin-right` — este
    // test de regresión sigue probando el mecanismo de empuje puro, así que
    // usa `.lyrics__line--chords`/`.float-label.chord-label`: los ACORDES
    // NUNCA promueven (ver JSDoc de cabecera del módulo), conservan el
    // empuje medido de siempre y son el fixture correcto para esta
    // regresión. El bug y el fix documentados abajo no cambiaron.
    //
    // jsdom no calcula layout real (getBoundingClientRect da 0 siempre), así
    // que para reproducir el bug de acumulación entre pasadas hay que
    // stubear `getBoundingClientRect` de los dos labels para simular lo que
    // pasa en un navegador real (repro completo en
    // e2e/labels-sin-empuje.spec.js "sílabas de 1 carácter adyacentes..."):
    //
    //   Pasada 1: label A [0,20] y label B [15,35] colisionan (gap=4) →
    //     needed = 20+4-15 = 9 → el segmento de A recibe margin-right=9px.
    //   Pasada 2: el margin-right propio de A no mueve la posición de SU
    //     PROPIO label (solo empuja lo que viene después), así que A se
    //     vuelve a medir en [0,20]. B, ya empujado por el navegador, se mide
    //     casi en su sitio correcto pero con un residuo de medición
    //     (subpíxel/redondeo) de 0.01px → needed = 20+4-23.99 = 0.01 → el
    //     segmento de A recibe un ajuste ADICIONAL de 0.01px.
    //
    // Antes del fix, la fase de escritura hacía `segEl.style.marginRight =
    // adjustPx + 'px'` (asignación absoluta): el 0.01px de la pasada 2
    // SOBRESCRIBÍA el 9px de la pasada 1, dejando el segmento casi sin
    // empuje y los labels vueltos a solapar. El fix acumula (`previousPx +
    // adjustPx`), así que el resultado final debe ser 9 + 0.01 = 9.01px.
    const root = document.createElement('div');
    root.innerHTML =
      '<p class="lyrics__line lyrics__line--chords">' +
      '<span class="line-seg"><span class="float-label chord-label"><i>A</i></span></span>' +
      '<span class="line-seg"><span class="float-label chord-label"><i>B</i></span></span>' +
      '</p>';
    const [segA, segB] = root.querySelectorAll('.line-seg');
    const [labelA, labelB] = root.querySelectorAll('.float-label.chord-label i');

    let readCount = 0;
    Object.defineProperty(labelA, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 20, top: 0 }),
    });
    Object.defineProperty(labelB, 'getBoundingClientRect', {
      value: () => {
        readCount += 1;
        // 1ra lectura (pasada 1): posición original, colisiona con A.
        // 2da lectura (pasada 2): B ya fue empujado por el margin-right de
        // A (9px), con un residuo de 0.01px de "redondeo" simulado.
        return readCount === 1
          ? { left: 15, right: 35, top: 0 }
          : { left: 23.99, right: 43.99, top: 0 };
      },
    });
    // La línea y el `<i>` necesitan getBoundingClientRect/getComputedStyle
    // utilizables; jsdom ya da font-size por defecto vía getComputedStyle.
    Object.defineProperty(root.querySelector('.lyrics__line--chords'), 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 1000, top: 0 }),
    });

    resolveLabelOverlaps(root);

    // gapPx real = fontSize (16px jsdom default) * 0.35 = 5.6, no 4 como en
    // el comentario de arriba (simplificado); el valor exacto no importa
    // para esta aserción: lo que importa es que el ajuste de la pasada 2 se
    // SUMÓ al de la pasada 1 en vez de reemplazarlo.
    const finalMarginPx = parseFloat(segA.style.marginRight);
    expect(segA.hasAttribute('data-overlap-fix')).toBe(true);
    // Con `=` (bug) el resultado final habría sido ~0.01-0.6px (solo el
    // residuo de la 2da pasada). Con `+=` (fix) debe ser >= al ajuste ya
    // grande de la 1ra pasada.
    expect(finalMarginPx).toBeGreaterThan(5);
    expect(segB.style.marginRight).toBe('');
  });

  it('Tono-solo: dos notas colisionadas promueven la de la derecha (clase de flip aplicada, sin margin-right)', () => {
    // Mismo par A/B del test de arriba, pero en `.lyrics__line--tono` (carril
    // de NOTAS, sí promueve) en vez de `.lyrics__line--chords`: la colisión
    // se resuelve subiendo B, no empujando A con margin-right.
    const root = document.createElement('div');
    root.innerHTML =
      '<p class="lyrics__line lyrics__line--tono">' +
      '<span class="line-seg"><span class="float-label tono-note"><i>A</i></span></span>' +
      '<span class="line-seg"><span class="float-label tono-note"><i>B</i></span></span>' +
      '</p>';
    const [segA, segB] = root.querySelectorAll('.line-seg');
    const [labelA, labelB] = root.querySelectorAll('.float-label.tono-note i');
    Object.defineProperty(labelA, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 20, top: 0 }),
    });
    Object.defineProperty(labelB, 'getBoundingClientRect', {
      value: () => ({ left: 15, right: 35, top: 0 }),
    });
    Object.defineProperty(root.querySelector('.lyrics__line--tono'), 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 1000, top: 0 }),
    });

    resolveLabelOverlaps(root);

    expect(segB.classList.contains('line-seg--note-flip')).toBe(true);
    expect(segB.hasAttribute('data-overlap-flip')).toBe(true);
    expect(segA.classList.contains('line-seg--note-flip')).toBe(false);
    expect(
      root.querySelector('.lyrics__line--tono').classList.contains('lyrics__line--has-flip'),
    ).toBe(true);
    // La promoción resolvió la colisión: ninguno de los dos necesitó
    // margin-right (carriles distintos, ver collectRails).
    expect(segA.style.marginRight).toBe('');
    expect(segB.style.marginRight).toBe('');
  });

  it('limpia la promoción de una pasada previa cuando la nueva geometría ya no colisiona', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p class="lyrics__line lyrics__line--tono">' +
      '<span class="line-seg"><span class="float-label tono-note"><i>A</i></span></span>' +
      '<span class="line-seg"><span class="float-label tono-note"><i>B</i></span></span>' +
      '</p>';
    const [, segB] = root.querySelectorAll('.line-seg');
    const [labelA, labelB] = root.querySelectorAll('.float-label.tono-note i');
    Object.defineProperty(root.querySelector('.lyrics__line--tono'), 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 1000, top: 0 }),
    });

    // Simula el residuo de una pasada previa que sí había promovido B.
    segB.classList.add('line-seg--note-flip');
    segB.setAttribute('data-overlap-flip', '1');
    root.querySelector('.lyrics__line--tono').classList.add('lyrics__line--has-flip');

    // Nueva geometría: A y B ya no colisionan (muy separados).
    Object.defineProperty(labelA, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 20, top: 0 }),
    });
    Object.defineProperty(labelB, 'getBoundingClientRect', {
      value: () => ({ left: 500, right: 520, top: 0 }),
    });

    resolveLabelOverlaps(root);

    expect(segB.classList.contains('line-seg--note-flip')).toBe(false);
    expect(segB.hasAttribute('data-overlap-flip')).toBe(false);
    expect(
      root.querySelector('.lyrics__line--tono').classList.contains('lyrics__line--has-flip'),
    ).toBe(false);
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
