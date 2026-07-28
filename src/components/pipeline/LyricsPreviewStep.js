/**
 * LyricsPreviewStep.js — Confirmación previa al approve (decisión 5 del spec
 * 2026-07-24): el admin ve el reparto final —secciones, cortes y timings—
 * sonando sobre la voz aislada antes de disparar sync/pitch/clips. Read-only:
 * para editar se vuelve al panel. Sin fase nueva en la máquina de estados.
 */
import { icon } from '../../lib/icons.js';
import { escapeHtml, safeUrl } from '../../lib/escape.js';
import { SECTION_TYPE_LABELS, normalizeSectionType } from '../../lib/sectionTypes.js';

function secondsLabel(startMs, endMs) {
  if (startMs === null || endMs === null) return '';
  return `${Math.round((endMs - startMs) / 1000)} s`;
}

/**
 * @param {{doc: object, vocalsUrl: string|null, onConfirm: Function, onBack: Function}} opts
 * @returns {HTMLElement} con `setCurrentTime(seconds)` para el resaltado.
 */
export function LyricsPreviewStep({ doc, vocalsUrl, onConfirm, onBack }) {
  const el = document.createElement('section');
  el.className = 'lps';
  // Foco programático al abrir el paso (regresión de teclado/lector de
  // pantalla si el approve monta esto y no mueve el foco a ningún lado).
  el.setAttribute('tabindex', '-1');

  const sectionsHtml = (doc?.sections ?? [])
    .map((section, sIdx) => {
      const instrumental = (section.lines ?? []).length === 0;
      const linesHtml = (section.lines ?? [])
        .map(
          (line, lIdx) =>
            `<p class="lps__line" data-section="${sIdx}" data-line="${lIdx}" data-start="${line.startMs ?? ''}" data-end="${line.endMs ?? ''}">${escapeHtml(line.text)}</p>`,
        )
        .join('');
      return `
        <div class="lps__section${instrumental ? ' lps__section--instrumental' : ''}">
          <h3 class="lps__section-title">
            ${escapeHtml(section.label || SECTION_TYPE_LABELS[normalizeSectionType(section.type)] || 'Sección')}
            <span class="lps__section-meta">${secondsLabel(section.startMs, section.endMs)}</span>
          </h3>
          ${instrumental ? '<p class="lps__instrumental">Sin letra — tramo instrumental</p>' : linesHtml}
        </div>`;
    })
    .join('');

  el.innerHTML = `
    <header class="lps__head">
      <h2 class="lps__title">Confirmar el reparto de la letra</h2>
      <p class="lps__hint">Revisa secciones, cortes y tiempos antes de aprobar.</p>
    </header>
    ${vocalsUrl ? `<audio class="lps__audio" controls preload="metadata" src="${escapeHtml(safeUrl(vocalsUrl) || '')}"></audio>` : ''}
    <div class="lps__sections">${sectionsHtml}</div>
    <footer class="lps__actions">
      <button type="button" class="btn2 lps__back">${icon('arrow-left', { size: 14 })} Volver a editar</button>
      <button type="button" class="btn lps__confirm">Aprobar letra</button>
    </footer>`;

  const lineEls = [...el.querySelectorAll('.lps__line')];
  el.setCurrentTime = (seconds) => {
    const ms = seconds * 1000;
    for (const lineEl of lineEls) {
      const start = Number(lineEl.dataset.start);
      const end = Number(lineEl.dataset.end);
      const active = Number.isFinite(start) && Number.isFinite(end) && ms >= start && ms <= end;
      lineEl.classList.toggle('is-active', active);
    }
  };

  const audio = el.querySelector('.lps__audio');
  if (audio) audio.addEventListener('timeupdate', () => el.setCurrentTime(audio.currentTime));
  el.querySelector('.lps__back').addEventListener('click', () => onBack?.());
  el.querySelector('.lps__confirm').addEventListener('click', () => onConfirm?.());

  return el;
}
