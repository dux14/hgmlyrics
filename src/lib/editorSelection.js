/**
 * editorSelection.js — Helpers puros para los popups del editor (Voces/Acordes).
 *
 * Selección por rango de caracteres (tap inicio→tap fin), tira de caracteres
 * clicable, y operaciones de la lista de grupos. Sin DOM → testeable como string.
 */

/**
 * Normaliza dos índices de carácter a un rango [start, end) con end EXCLUSIVO.
 * Tocar un solo carácter i → {start:i, end:i+1}.
 * @param {number} anchorIdx @param {number} focusIdx
 * @returns {{start:number, end:number}}
 */
export function normalizeRange(anchorIdx, focusIdx) {
  const lo = Math.min(anchorIdx, focusIdx);
  const hi = Math.max(anchorIdx, focusIdx);
  return { start: lo, end: hi + 1 };
}

function escapeChar(c) {
  if (c === '&') return '&amp;';
  if (c === '<') return '&lt;';
  if (c === '>') return '&gt;';
  if (c === '"') return '&quot;';
  return c;
}

/**
 * HTML de la tira de caracteres clicables. Resalta las celdas en [sel.start, sel.end).
 * @param {string} text
 * @param {{start:number,end:number}|null} sel
 * @returns {string}
 */
export function buildCharStripHTML(text, sel) {
  const str = text || '';
  if (str.length === 0) return '<span class="char-strip__empty">(línea vacía)</span>';
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const inSel = sel && i >= sel.start && i < sel.end;
    const ch = str[i] === ' ' ? '&nbsp;' : escapeChar(str[i]);
    out += `<button class="char-cell${inSel ? ' char-cell--sel' : ''}" data-char="${i}" type="button">${ch}</button>`;
  }
  return out;
}

/**
 * Añade una entrada de grupo a una copia ordenada. Si ya existe una con el mismo
 * rango y voz, REEMPLAZA su nota (no duplica). Distintas voces sobre el mismo
 * rango = entradas separadas. Ordena por start, luego voiceId.
 * @param {Array<{start,end,voiceId,note}>} groups
 * @param {{start:number,end:number,voiceId:string,note?:string|null}} entry
 * @returns {Array}
 */
export function addGroupEntry(groups, entry) {
  const list = Array.isArray(groups) ? groups.slice() : [];
  const clean = {
    start: entry.start,
    end: entry.end,
    voiceId: entry.voiceId,
    note: entry.note ?? null,
  };
  const i = list.findIndex(
    (g) => g.start === clean.start && g.end === clean.end && g.voiceId === clean.voiceId,
  );
  if (i === -1) list.push(clean);
  else list[i] = clean;
  list.sort((a, b) => a.start - b.start || String(a.voiceId).localeCompare(String(b.voiceId)));
  return list;
}

/**
 * Elimina la entrada en el índice dado. Devuelve un NUEVO array (no muta).
 * @param {Array} groups @param {number} idx
 * @returns {Array}
 */
export function deleteGroupAt(groups, idx) {
  const list = Array.isArray(groups) ? groups.slice() : [];
  if (idx >= 0 && idx < list.length) list.splice(idx, 1);
  return list;
}
