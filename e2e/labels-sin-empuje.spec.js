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
      const labels = [...document.querySelectorAll('.float-label.tono-note')];
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
        [...document.querySelectorAll('.float-label.tono-note')].map((el) => {
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
