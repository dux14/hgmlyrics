import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildTonoLineHTML, buildMixedLineHTML } from '../src/lib/lyricsRender.js';

/**
 * Geometria de la nota promovida (labelOverlap.js decideNotePromotions) en
 * la VISTA INMERSIVA. A diferencia de labels-sin-empuje.spec.js (que solo
 * carga components.css sobre un contenedor plano), aqui replicamos el
 * arbol real de ImmersiveView.js: `.song-view--immersive > .imm-v1 >
 * .imm-v1__viewport > .imm-roll > .imm-line.imm-line--active.lyrics__line--tono`
 * (ver `buildLine`/`renderRoll` en src/components/ImmersiveView.js) y
 * cargamos AMBAS hojas (components.css + immersive.css), porque la fuente
 * de la nota (`.imm-v1 .float-label.tono-note { font-size: 0.52em }`) y la
 * fuente de la linea activa (`.imm-line--active { font-size: 2.1rem }`) solo
 * existen juntas en ese contexto — es la causa raiz del bug (mismatch de
 * unidades em-de-nota vs em-de-linea).
 *
 * Correr solo este spec (no requiere `pnpm dev` ni `pnpm dev:vercel`):
 *   npx playwright test e2e/immersive-nota-promovida.spec.js
 */

const COMPONENTS_CSS_PATH = 'src/styles/components.css';
const IMMERSIVE_CSS_PATH = 'src/styles/immersive.css';

const TOKENS_CSS = `
  :root {
    --color-chord: #a5d6a7;
    --color-chord-bg: rgba(165, 214, 167, 0.12);
    --color-text: #ffffff;
    --line-height-lyrics: 1.8;
    --imm-font-scale: 1;
    --imm-text: #fff;
    --imm-gutter: 16px;
  }
  body {
    background: #000;
    font-family: Arial, sans-serif;
    margin: 0;
  }
`;

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

// Mismo fixture que la regresion "dormir tranquiiilo" de
// labels-sin-empuje.spec.js: el par final "l" G3 + "o" Bb3 (silabas de 1
// caracter dentro de la misma palabra) colisiona y Bb3 se promueve.
const PROMO_LINE = {
  text: 'dormir tranquiiilo',
  groups: [
    { voiceId: 'sop1', start: 7, end: 16, note: 'Ab3' },
    { voiceId: 'sop1', start: 16, end: 17, note: 'G3' },
    { voiceId: 'sop1', start: 17, end: 19, note: 'Bb3' },
  ],
};

/** Construye el arbol real de ImmersiveView.js para una linea con notas,
 * en el tamano de fila indicado (`imm-line--active` 2.1rem o
 * `imm-line--next`/`--prev`/etc 1.5rem — ambos muestran notas). */
function immersiveShell(innerHTML, { rowClass = 'imm-line--active', modifierClass }) {
  return `
    <div class="song-view--immersive">
      <div class="imm-v1">
        <div class="imm-v1__viewport" id="imm-viewport">
          <div class="imm-roll" id="imm-roll">
            <div class="imm-line ${rowClass} ${modifierClass}" data-i="0">${innerHTML}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function setupPage(page, { rowClass = 'imm-line--active' } = {}) {
  const html = buildTonoLineHTML(PROMO_LINE, 'sop1', 'voice-text--soprano', {});
  await page.setViewportSize({ width: 400, height: 700 });
  await page.setContent(immersiveShell(html, { rowClass, modifierClass: 'lyrics__line--tono' }));
  await page.addStyleTag({ content: TOKENS_CSS });
  await page.addStyleTag({ path: COMPONENTS_CSS_PATH });
  await page.addStyleTag({ path: IMMERSIVE_CSS_PATH });
  await injectLabelOverlap(page);
  await page.evaluate(() => {
    window.resolveLabelOverlaps(document.querySelector('.lyrics__line--tono'));
  });
}

/** Mide el rect del glifo de letra (silaba) de cada .line-seg y el rect del
 * <i> de nota promovida (si existe) en ese segmento. */
async function measureTono(page) {
  return page.evaluate(() => {
    const segs = [...document.querySelectorAll('.line-seg')];
    return segs
      .map((seg) => {
        const textNode = [...seg.childNodes].find((n) => n.nodeType === 3);
        if (!textNode) return null;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const syllRect = range.getBoundingClientRect();
        const i = seg.querySelector('.float-label i');
        const noteRect = i ? i.getBoundingClientRect() : null;
        const flipped = seg.classList.contains('line-seg--note-flip');
        return {
          flipped,
          syllTop: syllRect.top,
          syllBottom: syllRect.bottom,
          noteRect: noteRect
            ? { top: noteRect.top, bottom: noteRect.bottom, left: noteRect.left }
            : null,
        };
      })
      .filter(Boolean);
  });
}

test.describe('nota promovida en vista inmersiva: libra la caja de la letra grande', () => {
  test('Tono-solo, fila activa (2.1rem): la nota promovida no se solapa con la silaba', async ({
    page,
  }) => {
    await setupPage(page, { rowClass: 'imm-line--active' });
    const segs = await measureTono(page);
    const promoted = segs.filter((s) => s.flipped && s.noteRect);
    expect(promoted.length).toBeGreaterThan(0);

    for (const seg of promoted) {
      // La nota promovida debe terminar (bottom) por encima del top del
      // glifo de letra, con un margen minimo (no rozar).
      expect(seg.noteRect.bottom).toBeLessThanOrEqual(seg.syllTop - 1);
    }
  });

  test('Tono-solo, fila vecina (1.5rem, imm-line--next): la nota promovida tampoco se solapa', async ({
    page,
  }) => {
    await setupPage(page, { rowClass: 'imm-line--next' });
    const segs = await measureTono(page);
    const promoted = segs.filter((s) => s.flipped && s.noteRect);
    expect(promoted.length).toBeGreaterThan(0);

    for (const seg of promoted) {
      expect(seg.noteRect.bottom).toBeLessThanOrEqual(seg.syllTop - 1);
    }
  });

  test('Tono-solo: la letra no se movio respecto a la version sin notas (fila activa)', async ({
    page,
  }) => {
    const html = buildTonoLineHTML(PROMO_LINE, 'sop1', 'voice-text--soprano', {});
    const lineNoNotes = {
      ...PROMO_LINE,
      groups: PROMO_LINE.groups.map((g) => ({ ...g, note: '' })),
    };
    const htmlNoNotes = buildTonoLineHTML(lineNoNotes, 'sop1', 'voice-text--soprano', {});

    await page.setViewportSize({ width: 400, height: 700 });
    await page.setContent(
      `<div class="song-view--immersive"><div class="imm-v1"><div class="imm-v1__viewport">
        <div class="imm-roll">
          <div id="with" class="imm-line imm-line--active lyrics__line--tono" data-i="0">${html}</div>
          <div id="without" class="imm-line imm-line--active lyrics__line--tono" data-i="1">${htmlNoNotes}</div>
        </div>
      </div></div></div>`,
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: COMPONENTS_CSS_PATH });
    await page.addStyleTag({ path: IMMERSIVE_CSS_PATH });
    await injectLabelOverlap(page);
    await page.evaluate(() => {
      window.resolveLabelOverlaps(document.querySelector('#with'));
    });

    const leftsWith = await page.$eval('#with', (el) =>
      [...el.querySelectorAll('.line-word')].map((w) => w.getBoundingClientRect().left),
    );
    const leftsWithout = await page.$eval('#without', (el) =>
      [...el.querySelectorAll('.line-word')].map((w) => w.getBoundingClientRect().left),
    );
    expect(leftsWith.length).toBe(leftsWithout.length);
    for (let i = 0; i < leftsWith.length; i++) {
      expect(Math.abs(leftsWith[i] - leftsWithout[i])).toBeLessThan(1.5);
    }
  });

  test('Tono-solo: el conector existe en el segmento promovido, no en el no promovido', async ({
    page,
  }) => {
    await setupPage(page, { rowClass: 'imm-line--active' });
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
      };
    });
    expect(result.flippedContent).not.toBe('none');
    expect(result.flippedBorderLeftWidth).toBeGreaterThan(0);
    expect(result.notFlippedContent).toBe('none');
  });

  // Nota: en Mixto la medicion original de este test comparaba contra el
  // TOP del riel `.mix-rail--lyric` (caja con el line-height completo, no
  // el glifo real) y reportaba un falso solape de ~3px que no existe
  // visualmente (confirmado con captura: orden acorde > nota > letra, sin
  // pisar nada — ver antes-de-tocar CSS). Aqui se mide el glifo real (Range
  // sobre el nodo de texto), igual que en los tests de Tono-solo arriba,
  // que es la unica medicion que le importa al usuario.
  test('Mixto, fila activa: la nota promovida no se solapa con el glifo real de la letra', async ({
    page,
  }) => {
    const chords = [{ pos: 17, ch: 'G' }];
    const html = buildMixedLineHTML(PROMO_LINE, chords, 'sop1', 'voice-text--soprano', {});
    await page.setViewportSize({ width: 400, height: 700 });
    await page.setContent(
      immersiveShell(html, { rowClass: 'imm-line--active', modifierClass: 'lyrics__line--mix' }),
    );
    await page.addStyleTag({ content: TOKENS_CSS });
    await page.addStyleTag({ path: COMPONENTS_CSS_PATH });
    await page.addStyleTag({ path: IMMERSIVE_CSS_PATH });
    await injectLabelOverlap(page);
    await page.evaluate(() => {
      window.resolveLabelOverlaps(document.querySelector('.lyrics__line--mix'));
    });

    const { chordRect, noteRect, glyphRect } = await page.evaluate(() => {
      const flippedSeg = document.querySelector('.mix-seg--note-flip');
      const chordI = flippedSeg.querySelector('.mix-rail--chord i');
      const noteI = flippedSeg.querySelector('.mix-rail--note i');
      const lyricRail = flippedSeg.querySelector('.mix-rail--lyric');
      const textNode = [...lyricRail.childNodes].find((n) => n.nodeType === 3);
      const range = document.createRange();
      range.selectNodeContents(textNode);
      return {
        chordRect: chordI ? chordI.getBoundingClientRect() : null,
        noteRect: noteI.getBoundingClientRect(),
        glyphRect: range.getBoundingClientRect(),
      };
    });

    expect(chordRect).not.toBeNull();
    // Orden vertical: acorde arriba, nota debajo del acorde, ambos por
    // encima del glifo real de la letra.
    expect(chordRect.top).toBeLessThan(noteRect.top);
    expect(noteRect.bottom).toBeLessThanOrEqual(glyphRect.top - 1);
  });
});
