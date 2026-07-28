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
    //
    // CAMBIO DE MECANISMO (esta feature): la colisión ahora se resuelve
    // promoviendo las notas de la derecha de cada par colisionado
    // (`decideNotePromotions`), no empujando con margin-right — por eso la
    // aserción ya no exige `fixedCount > 0` sino `flippedCount > 0` (al
    // menos una promoción real), conservando la garantía que le importa al
    // usuario: sin solape entre etiquetas.
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

    const { rects, flippedCount } = await page.evaluate(() => {
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
      const flippedCount = document.querySelectorAll('[data-overlap-flip]').length;
      return { rects, flippedCount };
    });

    expect(rects.length).toBe(4);
    // El caso realmente colisionaba: al menos una nota fue promovida.
    expect(flippedCount).toBeGreaterThan(0);

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
  //
  // CAMBIO DE MECANISMO (esta feature): con `decideNotePromotions`, el par
  // que colisiona ("l" G3 + "o" Bb3, sílabas de 1 carácter) ya no se resuelve
  // empujando con margin-right — Bb3 (la nota de la DERECHA del par) se
  // PROMUEVE arriba de su sílaba. La aserción original ("fixedCount > 0",
  // asumía que el mecanismo SIEMPRE era margin) ya no aplica tal cual: aquí
  // se reemplaza por (a) sin solape entre notas de la misma fila visual (se
  // mantiene, es la garantía real que le importa al usuario), (b) la letra
  // no se movió ni un píxel respecto a la versión sin notas, y (c) al menos
  // una nota fue promovida (confirma que el caso realmente disparó el
  // mecanismo, no que "no había nada que resolver").
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
    const lineNoNotes = { ...line, groups: line.groups.map((g) => ({ ...g, note: '' })) };
    const html = buildTonoLineHTML(line, 'sop1', 'voice-text--soprano', {});
    const htmlNoNotes = buildTonoLineHTML(lineNoNotes, 'sop1', 'voice-text--soprano', {});
    expect(html).toContain('tono-note');

    await page.setViewportSize({ width: 900, height: 400 });
    await page.setContent(
      `<div id="with" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--tono">${html}</div></div>` +
        `<div id="without" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--tono">${htmlNoNotes}</div></div>`,
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });
    await injectLabelOverlap(page);

    await page.evaluate(() => {
      window.resolveLabelOverlaps(document.querySelector('#with .lyrics__line--tono'));
    });

    const { rects, flippedCount } = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('#with .float-label.tono-note i')];
      const rects = labels.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right, text: el.textContent };
      });
      const flippedCount = document.querySelectorAll('#with [data-overlap-flip]').length;
      return { rects, flippedCount };
    });

    expect(rects.length).toBe(3);
    // El caso realmente disparó el mecanismo: al menos una nota promovida.
    expect(flippedCount).toBeGreaterThan(0);
    for (let i = 0; i < rects.length - 1; i++) {
      const a = rects[i];
      const b = rects[i + 1];
      if (Math.abs(a.top - b.top) >= 4) continue;
      expect(b.left).toBeGreaterThanOrEqual(a.right - 0.5);
    }

    const leftsWith = await wordLefts(page, '#with');
    const leftsWithout = await wordLefts(page, '#without');
    expect(leftsWith.length).toBe(leftsWithout.length);
    for (let i = 0; i < leftsWith.length; i++) {
      expect(Math.abs(leftsWith[i] - leftsWithout[i])).toBeLessThan(1.5);
    }
  });

  // Mismo fixture que el test de Tono-solo de arriba, pero disparado por el
  // carril de nota del modo Mixto (combinación no cubierta por el test
  // anterior — carriles/segmentos `.mix-seg`/`.mix-rail--note` en vez de
  // `.line-seg`/`.float-label`). Mismo cambio de mecanismo: ver comentario
  // del test de Tono-solo de arriba.
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
    const lineNoNotes = { ...line, groups: line.groups.map((g) => ({ ...g, note: '' })) };
    const html = buildMixedLineHTML(line, [], 'sop1', 'voice-text--soprano', {});
    const htmlNoNotes = buildMixedLineHTML(lineNoNotes, [], 'sop1', 'voice-text--soprano', {});
    expect(html).toContain('mix-rail--note');

    await page.setViewportSize({ width: 900, height: 400 });
    await page.setContent(
      `<div id="with" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--mix">${html}</div></div>` +
        `<div id="without" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--mix">${htmlNoNotes}</div></div>`,
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });
    await injectLabelOverlap(page);

    await page.evaluate(() => {
      window.resolveLabelOverlaps(document.querySelector('#with .lyrics__line--mix'));
    });

    const { rects, flippedCount } = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('#with .mix-rail--note i')];
      const rects = labels.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right, text: el.textContent };
      });
      const flippedCount = document.querySelectorAll('#with [data-overlap-flip]').length;
      return { rects, flippedCount };
    });

    expect(rects.length).toBe(3);
    expect(flippedCount).toBeGreaterThan(0);
    for (let i = 0; i < rects.length - 1; i++) {
      const a = rects[i];
      const b = rects[i + 1];
      if (Math.abs(a.top - b.top) >= 4) continue;
      expect(b.left).toBeGreaterThanOrEqual(a.right - 0.5);
    }

    const leftsWith = await wordLefts(page, '#with');
    const leftsWithout = await wordLefts(page, '#without');
    expect(leftsWith.length).toBe(leftsWithout.length);
    for (let i = 0; i < leftsWith.length; i++) {
      expect(Math.abs(leftsWith[i] - leftsWithout[i])).toBeLessThan(1.5);
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

  // ─── Promoción vertical (decideNotePromotions): la nota que colisiona con
  // su vecina sube arriba en vez de empujar la letra ───
  test.describe('promoción vertical de notas (nota colisionada sube en vez de empujar la letra)', () => {
    // Mismo fixture que la regresión de arriba: "dormir tranquiiilo", donde
    // el par final "l" G3 + "o" Bb3 (sílabas de 1 carácter) colisiona.
    const PROMO_LINE = {
      text: 'dormir tranquiiilo',
      groups: [
        { voiceId: 'sop1', start: 7, end: 16, note: 'Ab3' },
        { voiceId: 'sop1', start: 16, end: 17, note: 'G3' },
        { voiceId: 'sop1', start: 17, end: 19, note: 'Bb3' },
      ],
    };
    const PROMO_LINE_NO_NOTES = {
      ...PROMO_LINE,
      groups: PROMO_LINE.groups.map((g) => ({ ...g, note: '' })),
    };

    test('Tono-solo: la nota promovida queda arriba de su sílaba, la letra no se mueve y ninguna nota se solapa', async ({
      page,
    }) => {
      const html = buildTonoLineHTML(PROMO_LINE, 'sop1', 'voice-text--soprano', {});
      const htmlNoNotes = buildTonoLineHTML(PROMO_LINE_NO_NOTES, 'sop1', 'voice-text--soprano', {});

      await page.setViewportSize({ width: 900, height: 400 });
      await page.setContent(
        `<div id="with" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--tono">${html}</div></div>` +
          `<div id="without" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--tono">${htmlNoNotes}</div></div>`,
      );
      await page.addStyleTag({ content: TOKENS_CSS });
      await page.addStyleTag({ path: CSS_PATH });
      await injectLabelOverlap(page);

      await page.evaluate(() => {
        window.resolveLabelOverlaps(document.querySelector('#with .lyrics__line--tono'));
      });

      const { notes, syllTops } = await page.evaluate(() => {
        const segs = [...document.querySelectorAll('#with .line-seg')];
        const notes = segs
          .map((seg) => {
            const i = seg.querySelector('.float-label i');
            if (!i) return null;
            const r = i.getBoundingClientRect();
            return { flipped: seg.classList.contains('line-seg--note-flip'), rect: r };
          })
          .filter(Boolean);
        // top de la fila de letra: el <span> de sílaba pintado por cada
        // .line-seg (nodo de texto directo, medido con un Range).
        const syllTops = segs.map((seg) => {
          const range = document.createRange();
          const textNode = [...seg.childNodes].find((n) => n.nodeType === 3); // 3 = TEXT_NODE
          if (!textNode) return null;
          range.selectNodeContents(textNode);
          return range.getBoundingClientRect().top;
        });
        return { notes, syllTops };
      });

      expect(notes.length).toBe(3);
      const promoted = notes.filter((n) => n.flipped);
      const notPromoted = notes.filter((n) => !n.flipped);
      expect(promoted.length).toBeGreaterThan(0);
      expect(notPromoted.length).toBeGreaterThan(0);

      // La fila de letra es la misma para todas las sílabas (mismo top,
      // tolerancia 1px) — la promoción no la movió.
      const rowTops = syllTops.filter((t) => t !== null);
      for (const t of rowTops) expect(Math.abs(t - rowTops[0])).toBeLessThan(1);

      // La nota promovida queda ARRIBA de la fila de letra; las no
      // promovidas quedan ABAJO (debajo de la sílaba, como siempre).
      for (const n of promoted) expect(n.rect.top).toBeLessThan(rowTops[0]);
      for (const n of notPromoted) expect(n.rect.top).toBeGreaterThan(rowTops[0]);

      // Ninguna nota se solapa con otra de la misma fila visual.
      for (let i = 0; i < notes.length; i++) {
        for (let j = i + 1; j < notes.length; j++) {
          const a = notes[i].rect;
          const b = notes[j].rect;
          if (Math.abs(a.top - b.top) >= 4) continue;
          const [left, right] = a.left <= b.left ? [a, b] : [b, a];
          expect(right.left).toBeGreaterThanOrEqual(left.right - 0.5);
        }
      }

      // La letra no se movió ni un píxel horizontalmente vs. la versión sin notas.
      const leftsWith = await wordLefts(page, '#with');
      const leftsWithout = await wordLefts(page, '#without');
      expect(leftsWith.length).toBe(leftsWithout.length);
      for (let i = 0; i < leftsWith.length; i++) {
        expect(Math.abs(leftsWith[i] - leftsWithout[i])).toBeLessThan(1.5);
      }
    });

    test('Mixto CON acorde en la posición de la nota promovida: orden vertical acorde < nota < letra', async ({
      page,
    }) => {
      // Ancla el acorde en pos 17 ("o", inicio del grupo Bb3 — la nota que
      // se promueve en este fixture): así el acorde y la nota promovida
      // comparten el MISMO .mix-seg, el caso de apilamiento del spec.
      const chords = [{ pos: 17, ch: 'G' }];
      const html = buildMixedLineHTML(PROMO_LINE, chords, 'sop1', 'voice-text--soprano', {});
      const htmlNoNotes = buildMixedLineHTML(
        PROMO_LINE_NO_NOTES,
        chords,
        'sop1',
        'voice-text--soprano',
        {},
      );

      await page.setViewportSize({ width: 900, height: 400 });
      await page.setContent(
        `<div id="with" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--mix">${html}</div></div>` +
          `<div id="without" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--mix">${htmlNoNotes}</div></div>`,
      );
      await page.addStyleTag({ content: TOKENS_CSS });
      await page.addStyleTag({ path: CSS_PATH });
      await injectLabelOverlap(page);

      await page.evaluate(() => {
        window.resolveLabelOverlaps(document.querySelector('#with .lyrics__line--mix'));
      });

      const { chordRect, noteRect, lyricRect } = await page.evaluate(() => {
        const flippedSeg = document.querySelector('#with .mix-seg--note-flip');
        const chordI = flippedSeg.querySelector('.mix-rail--chord i');
        const noteI = flippedSeg.querySelector('.mix-rail--note i');
        const lyricEl = flippedSeg.querySelector('.mix-rail--lyric');
        return {
          chordRect: chordI ? chordI.getBoundingClientRect() : null,
          noteRect: noteI.getBoundingClientRect(),
          lyricRect: lyricEl.getBoundingClientRect(),
        };
      });

      expect(chordRect).not.toBeNull();
      // Orden vertical estricto: acorde arriba, nota en medio, letra abajo.
      expect(chordRect.top).toBeLessThan(noteRect.top);
      expect(noteRect.top).toBeLessThan(lyricRect.top);
      // Sin solape vertical entre acorde y nota, ni entre nota y letra.
      expect(noteRect.top).toBeGreaterThanOrEqual(chordRect.bottom - 0.5);
      expect(lyricRect.top).toBeGreaterThanOrEqual(noteRect.bottom - 0.5);

      // La letra no se movió horizontalmente vs. la versión sin notas
      // (mismo acorde en ambas, así que el único delta es la nota).
      const leftsWith = await wordLefts(page, '#with');
      const leftsWithout = await wordLefts(page, '#without');
      expect(leftsWith.length).toBe(leftsWithout.length);
      for (let i = 0; i < leftsWith.length; i++) {
        expect(Math.abs(leftsWith[i] - leftsWithout[i])).toBeLessThan(1.5);
      }
    });

    test('Mixto SIN acorde en la posición de la nota promovida: la nota sube igual, la letra no se mueve', async ({
      page,
    }) => {
      // Acorde en pos 16 (grupo G3, NO el que se promueve) — el segmento de
      // la nota promovida (Bb3, pos 17) queda sin acorde propio.
      const chords = [{ pos: 16, ch: 'G' }];
      const html = buildMixedLineHTML(PROMO_LINE, chords, 'sop1', 'voice-text--soprano', {});
      const htmlNoNotes = buildMixedLineHTML(
        PROMO_LINE_NO_NOTES,
        chords,
        'sop1',
        'voice-text--soprano',
        {},
      );

      await page.setViewportSize({ width: 900, height: 400 });
      await page.setContent(
        `<div id="with" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--mix">${html}</div></div>` +
          `<div id="without" style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--mix">${htmlNoNotes}</div></div>`,
      );
      await page.addStyleTag({ content: TOKENS_CSS });
      await page.addStyleTag({ path: CSS_PATH });
      await injectLabelOverlap(page);

      await page.evaluate(() => {
        window.resolveLabelOverlaps(document.querySelector('#with .lyrics__line--mix'));
      });

      const { chordI, noteRect, lyricRect } = await page.evaluate(() => {
        const flippedSeg = document.querySelector('#with .mix-seg--note-flip');
        const chordI = flippedSeg.querySelector('.mix-rail--chord i');
        const noteI = flippedSeg.querySelector('.mix-rail--note i');
        const lyricEl = flippedSeg.querySelector('.mix-rail--lyric');
        return {
          chordI: !!chordI,
          noteRect: noteI.getBoundingClientRect(),
          lyricRect: lyricEl.getBoundingClientRect(),
        };
      });

      // Confirma el caso: este segmento NO tiene acorde propio.
      expect(chordI).toBe(false);
      // La nota promovida sigue arriba de la letra aunque no haya acorde.
      expect(noteRect.top).toBeLessThan(lyricRect.top);
      expect(lyricRect.top).toBeGreaterThanOrEqual(noteRect.bottom - 0.5);

      const leftsWith = await wordLefts(page, '#with');
      const leftsWithout = await wordLefts(page, '#without');
      expect(leftsWith.length).toBe(leftsWithout.length);
      for (let i = 0; i < leftsWith.length; i++) {
        expect(Math.abs(leftsWith[i] - leftsWithout[i])).toBeLessThan(1.5);
      }
    });

    // Feedback de usuario: la nota promovida quedaba huérfana visualmente
    // (no se distinguía a qué sílaba pertenecía). El fix agrega un conector
    // (leader line, pseudo-elemento `::after`) que solo debe existir en el
    // segmento PROMOVIDO, nunca en uno sin promover — jsdom no resuelve
    // pseudo-elementos con geometría, por eso esto vive en e2e (Playwright),
    // no en un unit test.
    test('Tono-solo: el segmento promovido tiene conector visual (::after), el no promovido no', async ({
      page,
    }) => {
      const html = buildTonoLineHTML(PROMO_LINE, 'sop1', 'voice-text--soprano', {});

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

      const result = await page.evaluate(() => {
        const flipped = document.querySelector('.line-seg--note-flip .float-label.tono-note');
        const notFlipped = document.querySelector(
          '.line-seg:not(.line-seg--note-flip) .float-label.tono-note',
        );
        const flippedAfter = getComputedStyle(flipped, '::after');
        const notFlippedAfter = getComputedStyle(notFlipped, '::after');
        return {
          flippedContent: flippedAfter.content,
          flippedBorderLeftWidth: parseFloat(flippedAfter.borderLeftWidth),
          notFlippedContent: notFlippedAfter.content,
          notFlippedBorderLeftWidth: parseFloat(notFlippedAfter.borderLeftWidth),
        };
      });

      expect(result.flippedContent).not.toBe('none');
      expect(result.flippedBorderLeftWidth).toBeGreaterThan(0);
      expect(result.notFlippedContent).toBe('none');
      expect(result.notFlippedBorderLeftWidth).toBe(0);
    });

    test('Mixto: el segmento promovido tiene conector visual (::after), el no promovido no', async ({
      page,
    }) => {
      const chords = [{ pos: 17, ch: 'G' }];
      const html = buildMixedLineHTML(PROMO_LINE, chords, 'sop1', 'voice-text--soprano', {});

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

      const result = await page.evaluate(() => {
        const flipped = document.querySelector('.mix-seg--note-flip .mix-rail--note');
        const notFlipped = document.querySelector(
          '.mix-seg:not(.mix-seg--note-flip) .mix-rail--note',
        );
        const flippedAfter = getComputedStyle(flipped, '::after');
        const notFlippedAfter = getComputedStyle(notFlipped, '::after');
        return {
          flippedContent: flippedAfter.content,
          flippedBorderLeftWidth: parseFloat(flippedAfter.borderLeftWidth),
          notFlippedContent: notFlippedAfter.content,
          notFlippedBorderLeftWidth: parseFloat(notFlippedAfter.borderLeftWidth),
        };
      });

      expect(result.flippedContent).not.toBe('none');
      expect(result.flippedBorderLeftWidth).toBeGreaterThan(0);
      expect(result.notFlippedContent).toBe('none');
      expect(result.notFlippedBorderLeftWidth).toBe(0);
    });
  });
});
