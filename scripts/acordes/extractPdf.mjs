// scripts/acordes/extractPdf.mjs
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { splitColumns } from './lib/columns.mjs';
import { groupLines } from './lib/lines.mjs';
import { pairChordLines } from './lib/pair.mjs';
import { classifySections } from './lib/sections.mjs';

/** Carga el PDF y devuelve items normalizados por página. */
export async function loadPdfItems(path) {
  const data = new Uint8Array(await readFile(path));
  const doc = await getDocument({ data }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .filter((it) => 'str' in it)
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width }))
    );
  }
  return pages;
}

/**
 * Heurística de fronteras de canción. CALIBRAR en el piloto contra el PDF real.
 * Versión inicial: una canción empieza en una línea cuyo texto matchea `^\d+\.?\s` (numeración)
 * o está en negrita/mayúsculas aislada. Devuelve grupos de líneas por canción.
 * @param {Array<{y:number,text:string,items:Array}>} columnLines
 * @returns {Array<{title:string, lines:Array}>}
 */
export function detectSongBoundaries(columnLines) {
  const songs = [];
  let current = null;
  const titleRe = /^\s*\d+\.?\s+\S/; // p.ej. "63. Olor a Tostadas" — AJUSTAR en piloto
  for (const line of columnLines) {
    if (titleRe.test(line.text)) {
      if (current) songs.push(current);
      current = { title: line.text.replace(/^\s*\d+\.?\s+/, '').trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) songs.push(current);
  return songs;
}

/** Extrae cejilla (explícita) y key (solo si aparece). CALIBRAR regex en piloto. */
export function extractMeta(songLines) {
  const blob = songLines.map((l) => l.text).join('\n');
  const cejillaM = blob.match(/cejilla\s*:?\s*(\d+)/i);
  const keyM = blob.match(/\b(tono|key)\s*:?\s*([A-G][#b]?m?)\b/i);
  return {
    cejilla: cejillaM ? Number(cejillaM[1]) : null,
    key: keyM ? keyM[2] : null,
  };
}

/** Pipeline completo: pages → [{title, cejilla, key, sections}]. */
export async function extractSongs(path, { columnThreshold = 290, deltaY = 14 } = {}) {
  const pages = await loadPdfItems(path);
  // Aplanar líneas por columna a través de todas las páginas, en orden de lectura.
  const allColumnLines = [];
  for (const items of pages) {
    const { left, right } = splitColumns(items, columnThreshold);
    for (const col of [left, right]) {
      allColumnLines.push(...groupLines(col));
    }
  }
  const rawSongs = detectSongBoundaries(allColumnLines);
  return rawSongs.map((song) => {
    const positioned = pairChordLines(song.lines, deltaY);
    // Agrupar líneas en secciones por bloques separados (línea vacía) — simplificación inicial.
    const sections = [{ label: undefined, lines: positioned }];
    return {
      title: song.title,
      ...extractMeta(song.lines),
      sections: classifySections(sections),
    };
  });
}
