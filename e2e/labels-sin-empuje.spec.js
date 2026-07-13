import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildTonoLineHTML, buildMixedLineHTML } from '../src/lib/lyricsRender.js';

/**
 * Geometria del fix "etiqueta sobre la silaba sin ensancharla" (cd1e3c2) +
 * anti-colision medida (60bc22a/5266603/ab5d669, src/lib/labelOverlap.js).
 * Mismo patron que renglon-foco-geometria.spec.js: sin webServer, HTML de los
 * builders reales via `page.setContent` + `addStyleTag` con el CSS real +
 * medicion con `getBoundingClientRect`.
 *
 * Correr solo este spec (no requiere `pnpm dev` ni `pnpm dev:vercel`):
 *   npx playwright test e2e/labels-sin-empuje.spec.js
 */

const CSS_PATH = 'src/styles/components.css';

const TOKENS_CSS = `
  :root {
    --color-chord: #a5d6a7;
    --color-chord-bg: rgba(165, 214, 167, 0.12);
    --color-text: #ffffff;
    --line-height-lyrics: 1.8;
  }
  body {
    background: #121212;
    font-family: Arial, sans-serif;
    font-size: 20px;
    margin: 0;
  }
`;

// labelOverlap.js no tiene imports (verificado): sus 3 `export function` se
// pueden convertir en declaraciones de funcion normales e inyectar como
// <script> clasico (no module) — las funciones top-level de un <script>
// clasico quedan colgadas de `window` sin wrapper adicional.
const LABEL_OVERLAP_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/lib/labelOverlap.js',
);
const LABEL_OVERLAP_SCRIPT = readFileSync(LABEL_OVERLAP_PATH, 'utf8').replace(
  /^export function/gm,
  'function',
);

async function injectLabelOverlap(page) {
  await page.addScriptTag({ content: LABEL_OVERLAP_SCRIPT });
}

/** Lee `left` de cada `.line-word` de un contenedor, en orden DOM. */
async function wordLefts(page, selector) {
  return page.$eval(selector, (el) =>
    [...el.querySelectorAll('.line-word')].map((w) => w.getBoundingClientRect().left),
  );
}

test.describe('etiquetas de acorde/nota: sin empuje + anti-colision (geometria)', () => {
  // Fixture del bug original: "a"→Ab3, "do" (de "do")→G3, "do" (de
  // "doooo")→Ab3 — misma linea/groups que el repro ya verificado en
  // renglon-foco-geometria.spec.js ("silaba SIN nota alinea con la fila de
  // letra"), reutilizada aqui para medir el eje horizontal.
  const DENSE_TEXT = 'a do doooo to la';
  const DENSE_GROUPS = [
    { voiceId: 'sop1', start: 0, end: 1, note: 'Ab3' },
    { voiceId: 'sop1', start: 2, end: 4, note: 'G3' },
    { voiceId: 'sop1', start: 5, end: 10, note: 'Ab3' },
  ];
  // Misma cobertura de grupos (mismo font-weight 600 "sung"/"pending" en las
  // tres silabas), pero SIN nota asignada (note:'' → hasNote() false) — asi
  // el unico delta entre las dos versiones es la presencia del label
  // flotante, no un cambio de peso de fuente por quitar el grupo entero.
  const DENSE_GROUPS_NO_NOTE = DENSE_GROUPS.map((g) => ({ ...g, note: '' }));

  test('modo Mixto: las notas no desplazan ninguna palabra (misma linea con y sin notas)', async ({
    page,
  }) => {
    const withNotes = { text: DENSE_TEXT, groups: DENSE_GROUPS };
    const withoutNotes = { text: DENSE_TEXT, groups: DENSE_GROUPS_NO_NOTE };
    const htmlWith = buildMixedLineHTML(withNotes, [], 'sop1', 'voice-text--soprano', {});
    const htmlWithout = buildMixedLineHTML(withoutNotes, [], 'sop1', 'voice-text--soprano', {});

    expect(htmlWith).toContain('<i>Ab3</i>');
    expect(htmlWithout).not.toContain('<i>Ab3</i>');

    await page.setViewportSize({ width: 900, height: 500 });
    await page.setContent(
      `<div id="with" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--mix">${htmlWith}</div></div>` +
        `<div id="without" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--mix">${htmlWithout}</div></div>`,
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });

    const leftsWith = await wordLefts(page, '#with');
    const leftsWithout = await wordLefts(page, '#without');

    expect(leftsWith.length).toBe(leftsWithout.length);
    expect(leftsWith.length).toBeGreaterThan(0);
    for (let i = 0; i < leftsWith.length; i++) {
      expect(Math.abs(leftsWith[i] - leftsWithout[i])).toBeLessThan(1.5);
    }
  });

  test('modo Tono-solo: las notas no desplazan ninguna palabra (misma linea con y sin notas)', async ({
    page,
  }) => {
    const withNotes = { text: DENSE_TEXT, groups: DENSE_GROUPS };
    const withoutNotes = { text: DENSE_TEXT, groups: DENSE_GROUPS_NO_NOTE };
    const htmlWith = buildTonoLineHTML(withNotes, 'sop1', 'voice-text--soprano', {});
    const htmlWithout = buildTonoLineHTML(withoutNotes, 'sop1', 'voice-text--soprano', {});

    expect(htmlWith).toContain('tono-note');
    expect(htmlWithout).not.toContain('tono-note');

    await page.setViewportSize({ width: 900, height: 500 });
    await page.setContent(
      `<div id="with" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--tono">${htmlWith}</div></div>` +
        `<div id="without" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--tono">${htmlWithout}</div></div>`,
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });

    const leftsWith = await wordLefts(page, '#with');
    const leftsWithout = await wordLefts(page, '#without');

    expect(leftsWith.length).toBe(leftsWithout.length);
    expect(leftsWith.length).toBeGreaterThan(0);
    for (let i = 0; i < leftsWith.length; i++) {
      expect(Math.abs(leftsWith[i] - leftsWithout[i])).toBeLessThan(1.5);
    }
  });

  test('modo Mixto: acorde anclado sobre el espacio no ensancha el hueco entre palabras', async ({
    page,
  }) => {
    const line = { text: 'Alaba Al Senor', groups: [] };
    // pos 5 cae exactamente sobre el espacio entre "Alaba" y "Al".
    const chordsOnSpace = [{ pos: 5, ch: 'G' }];
    const htmlAnchored = buildMixedLineHTML(line, chordsOnSpace, 'sop1', 'voice-text--soprano', {});
    const htmlBaseline = buildMixedLineHTML(line, [], 'sop1', 'voice-text--soprano', {});

    // El ancla sobre el espacio no debe fusionar "Alaba" y "Al" en un solo
    // .line-word (ver comentario "no fusiona las dos palabras vecinas").
    const wordCount = (htmlAnchored.match(/<span class="line-word">/g) || []).length;
    expect(wordCount).toBe(3);

    await page.setViewportSize({ width: 900, height: 500 });
    await page.setContent(
      `<div id="anchored" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--mix">${htmlAnchored}</div></div>` +
        `<div id="baseline" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--mix">${htmlBaseline}</div></div>`,
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });

    const gapOf = async (selector) =>
      page.$eval(selector, (el) => {
        const words = [...el.querySelectorAll('.line-word')];
        const a = words[0].getBoundingClientRect();
        const b = words[1].getBoundingClientRect();
        return b.left - a.right;
      });

    const gapAnchored = await gapOf('#anchored');
    const gapBaseline = await gapOf('#baseline');

    expect(Math.abs(gapAnchored - gapBaseline)).toBeLessThan(1.5);
  });

  test('modo Tono-solo: linea densa (una nota ancha por silaba corta) sin solape tras resolver', async ({
    page,
  }) => {
    // "ba jo tu re": 4 silabas cortas (2 letras cada una) con notas de 3
    // caracteres — el label es mas ancho que la silaba, forzando colision
    // horizontal en el carril de notas sin el ajuste de labelOverlap.js.
    const line = {
      text: 'ba jo tu re',
      groups: [
        { voiceId: 'sop1', start: 0, end: 2, note: 'Eb3' },
        { voiceId: 'sop1', start: 3, end: 5, note: 'F#3' },
        { voiceId: 'sop1', start: 6, end: 8, note: 'Ab3' },
        { voiceId: 'sop1', start: 9, end: 11, note: 'Bb3' },
      ],
    };
    const html = buildTonoLineHTML(line, 'sop1', 'voice-text--soprano', {});
    expect(html).toContain('tono-note');

    // Columna angosta: fuerza a las 4 notas a competir por espacio en la
    // misma fila visual.
    await page.setViewportSize({ width: 260, height: 400 });
    await page.setContent(
      `<div style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--tono">${html}</div></div>`,
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });
    await injectLabelOverlap(page);

    await page.evaluate(() => {
      window.resolveLabelOverlaps(document.querySelector('.lyrics__line--tono'));
    });

    const { rects, fixedCount } = await page.evaluate(() => {
      // Medir el `<i>` interno, NO el `.float-label` que lo envuelve: el
      // envoltorio va a `width: 0` a propósito (ver "Etiqueta sobre la
      // sílaba sin ensancharla" en components.css) para no aportar ancho a
      // la columna — el `<i>` es quien tiene el ancho real y sobresale. Medir
      // el envoltorio da rects de ancho 0 siempre, lo que vuelve vacua
      // cualquier comprobación de solape (bug de cobertura detectado junto
      // con la causa raíz real en labelOverlap.js: con el envoltorio, este
      // mismo caso "pasaba" aunque las etiquetas SÍ se solapaban).
      const labels = [...document.querySelectorAll('.float-label.tono-note i')];
      const rects = labels.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right };
      });
      const fixedCount = document.querySelectorAll('[data-overlap-fix]').length;
      return { rects, fixedCount };
    });

    expect(rects.length).toBe(4);
    // El caso realmente colisionaba: labelOverlap.js tuvo que aplicar al
    // menos un ajuste de margin-right.
    expect(fixedCount).toBeGreaterThan(0);

    // Sin solape entre etiquetas vecinas de la misma fila visual (mismo
    // `top`, tolerancia 4px como en labelOverlap.js ROW_TOLERANCE_PX).
    for (let i = 0; i < rects.length - 1; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const sameRow = Math.abs(a.top - b.top) < 4;
        if (!sameRow) continue;
        const [left, right] = a.left <= b.left ? [a, b] : [b, a];
        expect(right.left).toBeGreaterThanOrEqual(left.right - 0.5);
      }
    }
  });

  // Regresión del bug reportado: "dormir tranquiiilo" con Ab3/G3/Bb3, donde
  // el par final Ab3+G3 (silabas de 1 caracter dentro de la MISMA palabra,
  // "l"+"o" al final de "tranquiiilo") se pintaba casi montado. Causa raiz
  // real (labelOverlap.js runPass, fase de escritura): `resolveLabelOverlaps`
  // corre 2 pasadas SIN limpiar entre ellas a proposito (el margin-right de
  // la pasada 1 puede cambiar el wrap, la pasada 2 corrige sobre eso), pero
  // la escritura hacia un `=` absoluto en vez de acumular con `+=`. El label
  // propio de un segmento no se mueve por su propio margin-right (solo
  // empuja lo que viene despues), asi que en la pasada 2 se remedia en el
  // mismo sitio y `computeOverlapAdjustments` devuelve el ajuste RESIDUAL que
  // falta (chico, pero > 0) — al escribirlo con `=` en vez de `+=` borraba
  // casi todo el empuje grande de la pasada 1, dejando un remanente de pocos
  // px de solape (el desplazamiento chico que se ve en la captura).
  test('modo Tono-solo: sílabas de 1 carácter adyacentes en la MISMA palabra no quedan montadas', async ({
    page,
  }) => {
    // "dormir tranquiiilo": tranquiii(9)="tranquiii" Ab3, l(1)="l" G3, o(1)="o" Bb3.
    const line = {
      text: 'dormir tranquiiilo',
      groups: [
        { voiceId: 'sop1', start: 7, end: 16, note: 'Ab3' },
        { voiceId: 'sop1', start: 16, end: 17, note: 'G3' },
        { voiceId: 'sop1', start: 17, end: 19, note: 'Bb3' },
      ],
    };
    const html = buildTonoLineHTML(line, 'sop1', 'voice-text--soprano', {});
    expect(html).toContain('tono-note');

    await page.setViewportSize({ width: 900, height: 400 });
    await page.setContent(
      `<div style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--tono">${html}</div></div>`,
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });
    await injectLabelOverlap(page);

    await page.evaluate(() => {
      window.resolveLabelOverlaps(document.querySelector('.lyrics__line--tono'));
    });

    const { rects, fixedCount } = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.float-label.tono-note i')];
      const rects = labels.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right, text: el.textContent };
      });
      const fixedCount = document.querySelectorAll('[data-overlap-fix]').length;
      return { rects, fixedCount };
    });

    expect(rects.length).toBe(3);
    expect(fixedCount).toBeGreaterThan(0);
    for (let i = 0; i < rects.length - 1; i++) {
      const a = rects[i];
      const b = rects[i + 1];
      if (Math.abs(a.top - b.top) >= 4) continue;
      expect(b.left).toBeGreaterThanOrEqual(a.right - 0.5);
    }
  });

  // Mismo fixture que el test de Tono-solo de arriba, pero disparado por el
  // carril de nota del modo Mixto (combinación no cubierta por el test
  // anterior — carriles/segmentos `.mix-seg`/`.mix-rail--note` en vez de
  // `.line-seg`/`.float-label`).
  test('modo Mixto: sílabas de 1 carácter adyacentes en la MISMA palabra no quedan montadas (carril de nota)', async ({
    page,
  }) => {
    const line = {
      text: 'dormir tranquiiilo',
      groups: [
        { voiceId: 'sop1', start: 7, end: 16, note: 'Ab3' },
        { voiceId: 'sop1', start: 16, end: 17, note: 'G3' },
        { voiceId: 'sop1', start: 17, end: 19, note: 'Bb3' },
      ],
    };
    const html = buildMixedLineHTML(line, [], 'sop1', 'voice-text--soprano', {});
    expect(html).toContain('mix-rail--note');

    await page.setViewportSize({ width: 900, height: 400 });
    await page.setContent(
      `<div style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--mix">${html}</div></div>`,
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });
    await injectLabelOverlap(page);

    await page.evaluate(() => {
      window.resolveLabelOverlaps(document.querySelector('.lyrics__line--mix'));
    });

    const { rects, fixedCount } = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.mix-rail--note i')];
      const rects = labels.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right, text: el.textContent };
      });
      const fixedCount = document.querySelectorAll('[data-overlap-fix]').length;
      return { rects, fixedCount };
    });

    expect(rects.length).toBe(3);
    expect(fixedCount).toBeGreaterThan(0);
    for (let i = 0; i < rects.length - 1; i++) {
      const a = rects[i];
      const b = rects[i + 1];
      if (Math.abs(a.top - b.top) >= 4) continue;
      expect(b.left).toBeGreaterThanOrEqual(a.right - 0.5);
    }
  });

  // No-regresion del modelo linea-palabra: una nota (no un acorde) anclada a
  // mitad de "contigooo" tampoco debe partir la palabra en dos renglones a
  // ancho de columna mobile. Mismo texto/split que el repro de chords/tono en
  // renglon-foco-geometria.spec.js, pero disparado por el carril de nota del
  // modo Mixto (combinacion no cubierta ahi).
  test('modo Mixto: ancla de nota a mitad de "contigooo" no parte la palabra en dos lineas', async ({
    page,
  }) => {
    const text = 'Llevame contigooo caminaremos siempre juntos';
    const line = { text, groups: [{ voiceId: 'v1', start: 0, end: 13, note: 'B3' }] };
    const html = buildMixedLineHTML(line, [], 'v1', 'voice-text--tenor', {});

    expect(html).toContain('conti');
    expect(html).toContain('gooo');

    await page.setViewportSize({ width: 375, height: 400 });
    await page.setContent(
      `<div style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--mix">${html}</div></div>`,
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });

    const { firstTop, secondTop } = await page.evaluate(() => {
      const container = document.querySelector('.lyrics__line');
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let firstHalfNode = null;
      let secondHalfNode = null;
      let node;

      while ((node = walker.nextNode())) {
        if (!firstHalfNode && node.textContent.endsWith('conti')) firstHalfNode = node;
        if (!secondHalfNode && node.textContent.startsWith('gooo')) secondHalfNode = node;
      }
      const rangeEnd = document.createRange();
      rangeEnd.setStart(firstHalfNode, firstHalfNode.textContent.length - 1);
      rangeEnd.setEnd(firstHalfNode, firstHalfNode.textContent.length);
      const rangeStart = document.createRange();
      rangeStart.setStart(secondHalfNode, 0);
      rangeStart.setEnd(secondHalfNode, 1);
      return {
        firstTop: rangeEnd.getBoundingClientRect().top,
        secondTop: rangeStart.getBoundingClientRect().top,
      };
    });

    expect(Math.abs(firstTop - secondTop)).toBeLessThan(3);
  });

  test('resolveLabelOverlaps es idempotente: una segunda pasada no mueve ninguna etiqueta', async ({
    page,
  }) => {
    const line = {
      text: 'ba jo tu re',
      groups: [
        { voiceId: 'sop1', start: 0, end: 2, note: 'Eb3' },
        { voiceId: 'sop1', start: 3, end: 5, note: 'F#3' },
        { voiceId: 'sop1', start: 6, end: 8, note: 'Ab3' },
        { voiceId: 'sop1', start: 9, end: 11, note: 'Bb3' },
      ],
    };
    const html = buildTonoLineHTML(line, 'sop1', 'voice-text--soprano', {});

    await page.setViewportSize({ width: 260, height: 400 });
    await page.setContent(
      `<div style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--tono">${html}</div></div>`,
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });
    await injectLabelOverlap(page);

    const measure = () =>
      page.evaluate(() =>
        // El `<i>` interno es el que tiene ancho real (ver comentario en el
        // test denso más arriba); medirlo aquí también valida que el fix de
        // acumulación de `margin-right` entre pasadas (labelOverlap.js
        // runPass) no introduzca oscilación entre la 1ra y la 2da pasada.
        [...document.querySelectorAll('.float-label.tono-note i')].map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, left: r.left, right: r.right };
        }),
      );

    await page.evaluate(() => {
      window.resolveLabelOverlaps(document.querySelector('.lyrics__line--tono'));
    });
    const firstPass = await measure();

    await page.evaluate(() => {
      window.resolveLabelOverlaps(document.querySelector('.lyrics__line--tono'));
    });
    const secondPass = await measure();

    expect(secondPass.length).toBe(firstPass.length);
    for (let i = 0; i < firstPass.length; i++) {
      expect(Math.abs(firstPass[i].top - secondPass[i].top)).toBeLessThan(0.5);
      expect(Math.abs(firstPass[i].left - secondPass[i].left)).toBeLessThan(0.5);
      expect(Math.abs(firstPass[i].right - secondPass[i].right)).toBeLessThan(0.5);
    }
  });
});
