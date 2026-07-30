/**
 * SheetStatusStrip.js — tira de estado de la hoja viva de revisión de letra
 * (S3a, Task 7). A la izquierda, el tamaño del documento (`N renglones · N
 * secciones`); a la derecha, en ámbar y tocable, `N dudosos` (según
 * `dudosoThreshold`, el mismo umbral que `ConfidenceSummary.js` — un solo
 * número de confianza para todo el pipeline) y, cuando corresponde, `N sin
 * tiempo`. Reemplaza los badges de porcentaje por renglón del panel viejo:
 * la confianza puntual de cada línea vive ahora en su barra
 * (`SheetLine.js`), acá solo el resumen agregado. Cuando el run publicó voz
 * aislada (`canListen`), se suma el chip «Escuchar» que despliega el
 * transporte de audio (S3b-ii); `setListening(bool)` lo sincroniza desde
 * afuera con el estado real del transporte.
 */
import { icon } from '../../../lib/icons.js';

/** Un renglón es dudoso si tiene confianza numérica por debajo del umbral —
 * las vocalizaciones nunca la tienen (SheetLine.hasConfidence las excluye
 * de la barra por el mismo motivo), así que quedan afuera solas. */
function isDudoso(line, dudosoThreshold) {
  return (
    typeof dudosoThreshold === 'number' &&
    typeof line.confidence === 'number' &&
    line.confidence < dudosoThreshold
  );
}

function sinWords(line) {
  return !Array.isArray(line.words) || line.words.length === 0;
}

function plural(n, singular, plural_) {
  return n === 1 ? singular : plural_;
}

/** Recorre el documento en orden y devuelve los conteos agregados más el
 * `{ sIdx, lIdx }` del primer renglón dudoso (null si no hay ninguno). */
function computeStats(doc, dudosoThreshold) {
  const sections = doc?.sections ?? [];
  let lineCount = 0;
  let dudosoCount = 0;
  let sinTiempoCount = 0;
  let firstDudoso = null;

  sections.forEach((section, sIdx) => {
    const lines = section.lines ?? [];
    lines.forEach((line, lIdx) => {
      lineCount += 1;
      if (sinWords(line)) sinTiempoCount += 1;
      if (isDudoso(line, dudosoThreshold)) {
        dudosoCount += 1;
        if (firstDudoso === null) firstDudoso = { sIdx, lIdx };
      }
    });
  });

  return {
    lineCount,
    sectionCount: sections.length,
    dudosoCount,
    sinTiempoCount,
    firstDudoso,
  };
}

/**
 * @param {{doc: object, dudosoThreshold: number,
 *   onJumpToDudoso: (sIdx: number, lIdx: number) => void,
 *   canListen?: boolean, onToggleListen?: () => void}} opts
 * @returns {HTMLElement}
 */
export function SheetStatusStrip(opts) {
  const { dudosoThreshold, onJumpToDudoso, canListen, onToggleListen } = opts;
  let { doc } = opts;
  let listening = false;

  const el = document.createElement('div');
  el.className = 'sheet-status-strip';

  let stats = computeStats(doc, dudosoThreshold);

  function render() {
    stats = computeStats(doc, dudosoThreshold);

    const dudosoLabel = `${stats.dudosoCount} ${plural(stats.dudosoCount, 'dudoso', 'dudosos')}`;
    const sinTiempoLabel = `${stats.sinTiempoCount} sin tiempo`;

    el.innerHTML = `
      <span class="sheet-status-strip__summary">${stats.lineCount} ${plural(stats.lineCount, 'renglón', 'renglones')} · ${stats.sectionCount} ${plural(stats.sectionCount, 'sección', 'secciones')}</span>
      <span class="sheet-status-strip__flags">
        ${
          stats.dudosoCount > 0
            ? `<button type="button" class="sheet-status-strip__dudosos">${icon('triangle-alert', { size: 14 })}${dudosoLabel}</button>`
            : ''
        }
        ${
          stats.sinTiempoCount > 0
            ? `<span class="sheet-status-strip__sin-tiempo">${icon('clock', { size: 14 })}${sinTiempoLabel}</span>`
            : ''
        }
        ${
          canListen
            ? `<button type="button" class="sheet-status-strip__listen" aria-pressed="${listening}">${icon('volume-2', { size: 14 })}Escuchar</button>`
            : ''
        }
      </span>
    `;

    const dudososBtn = el.querySelector('.sheet-status-strip__dudosos');
    if (dudososBtn) {
      dudososBtn.addEventListener('click', () => {
        if (stats.firstDudoso) onJumpToDudoso?.(stats.firstDudoso.sIdx, stats.firstDudoso.lIdx);
      });
    }

    const listenBtn = el.querySelector('.sheet-status-strip__listen');
    if (listenBtn) {
      listenBtn.addEventListener('click', () => onToggleListen?.());
    }
  }

  render();

  el.update = function update(next) {
    doc = next;
    render();
  };

  el.setListening = function setListening(value) {
    listening = value;
    const listenBtn = el.querySelector('.sheet-status-strip__listen');
    if (listenBtn) listenBtn.setAttribute('aria-pressed', String(listening));
  };

  return el;
}
