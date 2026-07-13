import { test, expect } from '@playwright/test';
import { buildChordsLineHTML, buildTonoLineHTML, buildMixedLineHTML } from '../src/lib/lyricsRender.js';

/**
 * Repro geometrico del "hueco intra-palabra" en modo Acordes (Task 1 del plan
 * renglon-foco-consistente-modos). Este spec NO depende del webServer/dev
 * server: renderiza el HTML del builder real con `page.setContent` +
 * `addStyleTag` (CSS real del proyecto) y mide geometria real del DOM con
 * `getBoundingClientRect`/`Range`.
 *
 * Mecanismo confirmado (Wave 3, components.css ~L520-536): cuando el ancla de
 * un acorde cae DENTRO de una palabra, `buildAnnotatedLineHTML` reparte esa
 * palabra en dos `<span class="line-seg">` separados — uno por cada mitad.
 * Cada `.line-seg` es un `display:inline-flex` (caja atomica de nivel
 * inline). El SEGUNDO span (el que arranca en el ancla) agrupa TODO el texto
 * restante de la linea hasta el proximo punto de corte, SIN spans internos
 * por palabra — es una sola caja atomica que no puede compartir el borde de
 * linea con el contenido previo.
 *
 * Medicion real (ver notas de investigacion mas abajo): en una sola linea
 * ancha (viewport ~900px) esa caja SIEMPRE queda pegada (gap horizontal 0px)
 * al span anterior — el modelo de "hueco horizontal por pill mas ancho que
 * el texto" que motivo la hipotesis original NO se reproduce ahi, porque los
 * `.line-seg` adyacentes siempre se tocan sin espacio en el eje inline
 * (align-items:flex-start dentro de cada caja no inserta separacion entre
 * cajas vecinas).
 *
 * Lo que SI se reproduce, de forma consistente y mucho mas grave, es a
 * ANCHO DE COLUMNA REALISTA DE MOBILE (~375px, con el padding estandar de
 * 16px de la plataforma): como el segundo span es una caja atomica que
 * agrupa TODA la palabra + el resto de la linea, cuando ese contenido no
 * cabe en lo que queda de la linea actual, la caja completa salta entera a
 * la linea siguiente — partiendo la palabra EN DOS LINEAS DISTINTAS
 * ("conti" queda solo al final de la linea 1; "gooo..." arranca la linea
 * 2). Esto es el mismo "hueco intra-palabra" (misma causa raiz: el ancla
 * corta la palabra en dos cajas `.line-seg` atomicas) pero manifestado como
 * ruptura de linea en vez de separacion horizontal de pixeles.
 *
 * Este test verifica que ambas mitades de la palabra partida terminan en la
 * MISMA linea visual (mismo `top`). HOY debe FALLAR: quedan en lineas
 * distintas (delta de ~23px, una linea completa).
 *
 * Correr solo este spec (no requiere `pnpm dev` ni `pnpm dev:vercel`):
 *   npx playwright test e2e/renglon-foco-geometria.spec.js
 */

const CSS_PATH = 'src/styles/components.css';

// Tokens minimos que components.css necesita para que el pill del acorde
// tenga tamaño/color reales (no reproducimos el theme completo, solo el
// modelo de caja que nos interesa medir).
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

// 'Llevame contigooo caminaremos siempre juntos' — indices verificados con
// Node: c(8) o(9) n(10) t(11) i(12) g(13) o(14) o(15) o(16). pos:13 cae justo
// antes de la "g" → parte la palabra en "conti" | "gooo...", con suficiente
// texto detras para que el segundo span no quepa en el resto del ancho de
// columna mobile y tenga que saltar de linea.
const TEXT = 'Llevame contigooo caminaremos siempre juntos';
const CHORDS = [{ pos: 13, ch: 'G' }];

/**
 * Busca los rects (getBoundingClientRect) de los dos nodos de texto que
 * contienen `firstHalf`/`secondHalf` de la palabra partida. Los nodos de
 * texto reales incluyen el resto de su `.line-seg` como prefijo/sufijo
 * (p.ej. el primer span es "Llevame conti", no solo "conti"), por eso se
 * busca por endsWith/startsWith en vez de igualdad exacta.
 */
async function findSplitWordRects(page, firstHalf, secondHalf) {
  return page.evaluate(
    ({ firstHalf, secondHalf }) => {
      const container = document.querySelector('.lyrics__line');
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let firstHalfNode = null;
      let secondHalfNode = null;
      let node;
      // eslint-disable-next-line no-cond-assign
      while ((node = walker.nextNode())) {
        if (!firstHalfNode && node.textContent.endsWith(firstHalf)) firstHalfNode = node;
        if (!secondHalfNode && node.textContent.startsWith(secondHalf)) secondHalfNode = node;
      }
      if (!firstHalfNode || !secondHalfNode) {
        throw new Error(
          `No se encontraron los nodos de texto esperados. firstHalf=${JSON.stringify(
            firstHalf
          )} secondHalf=${JSON.stringify(secondHalf)}`
        );
      }
      const firstHalfLen = firstHalfNode.textContent.length;
      const rangeEnd = document.createRange();
      rangeEnd.setStart(firstHalfNode, firstHalfLen - 1);
      rangeEnd.setEnd(firstHalfNode, firstHalfLen);
      const lastGlyphRect = rangeEnd.getBoundingClientRect();

      const rangeStart = document.createRange();
      rangeStart.setStart(secondHalfNode, 0);
      rangeStart.setEnd(secondHalfNode, 1);
      const firstGlyphRect = rangeStart.getBoundingClientRect();

      return {
        lastGlyph: { top: lastGlyphRect.top, right: lastGlyphRect.right },
        firstGlyph: { top: firstGlyphRect.top, left: firstGlyphRect.left },
      };
    },
    { firstHalf, secondHalf }
  );
}

test.describe('renglon foco: hueco intra-palabra (geometria)', () => {
  test('modo Acordes: ancla de acorde a mitad de "contigooo" no parte la palabra en dos lineas', async ({
    page,
  }) => {
    const html = buildChordsLineHTML(TEXT, CHORDS, {});

    // El builder debe haber partido la palabra en dos .line-seg — si esto
    // falla, el spec esta mal construido (no reproduce el escenario).
    expect(html).toContain('conti');
    expect(html).toContain('gooo');

    // Ancho de columna mobile realista (16px de padding estandar de
    // plataforma a cada lado, ver CLAUDE.md "sin margen extra").
    await page.setViewportSize({ width: 375, height: 400 });
    await page.setContent(
      `<div style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--chords">${html}</div></div>`
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });

    const { lastGlyph, firstGlyph } = await findSplitWordRects(page, 'conti', 'gooo');

    // HOY este assert FALLA: el segundo `.line-seg` ("Ggooo caminaremos...")
    // es una caja atomica que no cabe en lo que queda de la linea 1 y salta
    // entera a la linea 2 — "conti" y "gooo" terminan en `top` distintos
    // (delta ~23px, una linea completa), partiendo visualmente la palabra
    // "contigooo" en dos renglones. La Task 2 debe evitar que el ancla de
    // un acorde intra-palabra fuerce ese salto de linea.
    expect(Math.abs(firstGlyph.top - lastGlyph.top)).toBeLessThan(3);

    // Chequeo secundario (solo tiene sentido si el assert anterior pasa,
    // i.e. ambas mitades comparten linea): el hueco horizontal entre el
    // ultimo glifo de "conti" y el primero de "gooo" debe ser chico.
    expect(firstGlyph.left - lastGlyph.right).toBeLessThan(1.5);
  });

  // Misma palabra/ancho de columna que el repro de Acordes, pero el corte
  // intra-palabra viene de un limite de grupo de voz (start/end), no de un
  // chord label — mismo mecanismo de fondo (cut a mitad de "contigooo").
  test('modo Tono: limite de grupo a mitad de "contigooo" no parte la palabra en dos lineas', async ({
    page,
  }) => {
    const line = {
      text: TEXT,
      groups: [{ voiceId: 'sop1', start: 0, end: 13, note: 'B3' }],
    };
    const html = buildTonoLineHTML(line, 'sop1', 'voice-text--soprano', {});

    expect(html).toContain('conti');
    expect(html).toContain('gooo');

    await page.setViewportSize({ width: 375, height: 400 });
    await page.setContent(
      `<div style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--tono">${html}</div></div>`
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });

    const { lastGlyph, firstGlyph } = await findSplitWordRects(page, 'conti', 'gooo');

    expect(Math.abs(firstGlyph.top - lastGlyph.top)).toBeLessThan(3);
    expect(firstGlyph.left - lastGlyph.right).toBeLessThan(1.5);
  });

  test('modo Mixto: ancla de acorde a mitad de "contigooo" no parte la palabra en dos lineas', async ({
    page,
  }) => {
    const line = {
      text: TEXT,
      groups: [{ voiceId: 'v1', start: 0, end: 13, note: 'B3' }],
    };
    const html = buildMixedLineHTML(line, CHORDS, 'v1', 'voice-text--tenor', {});

    expect(html).toContain('conti');
    expect(html).toContain('gooo');

    await page.setViewportSize({ width: 375, height: 400 });
    await page.setContent(
      `<div style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--mix">${html}</div></div>`
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });

    const { lastGlyph, firstGlyph } = await findSplitWordRects(page, 'conti', 'gooo');

    expect(Math.abs(firstGlyph.top - lastGlyph.top)).toBeLessThan(3);
    expect(firstGlyph.left - lastGlyph.right).toBeLessThan(1.5);
  });

  // No-regresion del motivo original del modelo columna (ver comentario de
  // cabecera en components.css ~L514/L548): con varias anclas de acorde muy
  // juntas (una por silaba), agrupar por palabra en .line-word NO debe hacer
  // que las etiquetas flotantes vecinas se solapen entre si.
  test('modo Acordes: linea densa (anclas por silaba) no solapa etiquetas flotantes', async ({
    page,
  }) => {
    const denseText = 'Santo Santo Santo';
    const denseChords = [
      { pos: 0, ch: 'C' },
      { pos: 2, ch: 'D' },
      { pos: 4, ch: 'E' },
      { pos: 6, ch: 'F' },
      { pos: 8, ch: 'G' },
      { pos: 10, ch: 'A' },
      { pos: 12, ch: 'B' },
      { pos: 14, ch: 'C' },
    ];
    const html = buildChordsLineHTML(denseText, denseChords, {});

    await page.setViewportSize({ width: 375, height: 400 });
    await page.setContent(
      `<div style="padding:16px;box-sizing:border-box;"><div class="lyrics__line lyrics__line--chords">${html}</div></div>`
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: CSS_PATH });

    const rects = await page.evaluate(() =>
      [...document.querySelectorAll('.float-label')].map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      })
    );

    expect(rects.length).toBe(denseChords.length);
    // Ninguna etiqueta flotante se superpone (interseccion de rects) con otra
    // que comparta linea visual (mismo `top`, dentro de tolerancia de 1px).
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const sameLine = Math.abs(a.top - b.top) < 1;
        if (!sameLine) continue;
        const overlaps = a.left < b.right && b.left < a.right;
        expect(overlaps).toBe(false);
      }
    }
  });
});
