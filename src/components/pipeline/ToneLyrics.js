/**
 * ToneLyrics.js — letra con notas apiladas por sílaba, multi-voz (pipeline
 * unificado, plan D, Task D4c). Voz base (primera de `voices_present`) da el
 * texto; el resto de voces presentes en esa posición [línea][sílaba] apila
 * su nota debajo (nivel 1 lead=teal, nivel 2 backing=violeta, nivel 3+
 * colapsado en un punto expandible `.tone-more`). Resalta la sílaba activa
 * por tiempo y hace autoscroll de línea; tap en línea dispara seek.
 * Componente autónomo: D4d lo compone junto al player (setActiveTime en
 * cada timeupdate).
 */
import { escapeHtml } from '../../lib/escape.js';

// Roles de color por voz: lead siempre nivel 1 (teal). El resto de
// voices_present, en orden, ocupan nivel 2 (violeta) y nivel 3+ (rosa,
// colapsadas en .tone-more). male/female se tratan como backing/choir.
const ROLE_CLASS = {
  lead: 'tone-note--lead',
  backing: 'tone-note--alt',
  male: 'tone-note--alt',
  female: 'tone-note--alt',
  choir: 'tone-note--coros',
};

function roleClassFor(voiceKey, levelIndex) {
  if (ROLE_CLASS[voiceKey]) return ROLE_CLASS[voiceKey];
  return levelIndex === 0
    ? 'tone-note--lead'
    : levelIndex === 1
      ? 'tone-note--alt'
      : 'tone-note--coros';
}

// Etiqueta de una sílaba para una voz dada: '' si ditto (sostiene la nota
// anterior), nada (null) si blank (sin nota), el nombre de nota si no.
function noteLabel(syl) {
  if (!syl) return null;
  if (syl.blank) return null;
  if (syl.ditto) return '';
  return syl.note ?? null;
}

function renderSylNotes(voiceKeys) {
  const notes = [];
  for (const key of voiceKeys) {
    const syl = key.syl;
    const label = noteLabel(syl);
    if (label === null) continue;
    notes.push({ key: key.key, label });
  }
  if (notes.length === 0) return '';
  const stacked = notes.slice(0, 2);
  const extra = notes.slice(2);
  const stackedHtml = stacked
    .map(
      (n, idx) =>
        `<span class="tone-note ${roleClassFor(n.key, idx)}">${escapeHtml(n.label)}</span>`,
    )
    .join('');
  const moreHtml = extra.length
    ? `<button type="button" class="tone-more" data-action="tone-more" aria-expanded="false">+${extra.length}</button>
       <span class="tone-more-panel" hidden>${extra
         .map((n) => `<span class="tone-note tone-note--coros">${escapeHtml(n.label)}</span>`)
         .join('')}</span>`
    : '';
  return `<span class="tone-syl-notes">${stackedHtml}${moreHtml}</span>`;
}

/**
 * @param {{ analysis: object|null, onSeek?: (seconds: number) => void }} opts
 * @returns {{ el: HTMLElement, setActiveTime: (seconds: number) => void, destroy: () => void }}
 */
export function createToneLyrics({ analysis, onSeek } = {}) {
  const el = document.createElement('div');
  el.className = 'tone-lyrics';

  const ac = new AbortController();
  let destroyed = false;
  let lastActiveLineEl = null;

  const voicesPresent = Array.isArray(analysis?.voices_present) ? analysis.voices_present : [];
  const baseKey = voicesPresent.find((k) => analysis?.voices?.[k]?.lines?.length);
  const baseLines = baseKey ? (analysis.voices[baseKey].lines ?? []) : [];

  if (!baseKey || baseLines.length === 0) {
    el.innerHTML = '<p class="tone-lyrics__empty">No hay datos de partitura para esta canción.</p>';
    return { el, setActiveTime() {}, destroy() {} };
  }

  const otherKeys = voicesPresent.filter((k) => k !== baseKey && analysis.voices?.[k]?.lines);

  const html = baseLines
    .map((line, li) => {
      const syllables = line.syllables ?? [];
      const sylHtml = syllables
        .map((syl, si) => {
          const voiceKeys = [
            { key: baseKey, syl },
            ...otherKeys.map((k) => ({
              key: k,
              syl: analysis.voices[k].lines[li]?.syllables?.[si],
            })),
          ];
          const notesHtml = renderSylNotes(voiceKeys);
          const start = Number.isFinite(syl.start) ? syl.start : 0;
          const end = Number.isFinite(syl.end) ? syl.end : start;
          return `<span class="tone-syl" data-start="${start}" data-end="${end}">
            <span class="tone-syl-text">${escapeHtml(syl.text ?? '')}</span>
            ${notesHtml}
          </span>`;
        })
        .join('');
      return `<p class="tone-line" data-line="${li}">${sylHtml}</p>`;
    })
    .join('');

  el.innerHTML = html;

  // Cache de nodos para setActiveTime (se llama ~4Hz en cada timeupdate del
  // player): evita re-consultar el DOM completo con querySelectorAll en cada
  // llamada. Si el DOM se reconstruye (re-render), llamar a rebuildLineCache().
  let lineCache = [];
  function rebuildLineCache() {
    lineCache = [...el.querySelectorAll('.tone-line')].map((lineEl) => ({
      lineEl,
      syls: [...lineEl.querySelectorAll('.tone-syl')].map((sylEl) => ({
        sylEl,
        start: Number(sylEl.dataset.start),
        end: Number(sylEl.dataset.end),
      })),
    }));
  }
  rebuildLineCache();

  el.addEventListener(
    'click',
    (e) => {
      const moreBtn = e.target.closest('[data-action="tone-more"]');
      if (moreBtn) {
        const panel = moreBtn.nextElementSibling;
        const expanded = moreBtn.getAttribute('aria-expanded') === 'true';
        moreBtn.setAttribute('aria-expanded', String(!expanded));
        if (panel) panel.hidden = expanded;
        return;
      }
      const lineEl = e.target.closest('.tone-line');
      if (!lineEl) return;
      const firstSyl = lineEl.querySelector('.tone-syl');
      if (!firstSyl) return;
      onSeek?.(Number(firstSyl.dataset.start) || 0);
    },
    { signal: ac.signal },
  );

  function setActiveTime(seconds) {
    if (destroyed) return;
    let activeLineEl = null;
    for (const { lineEl, syls } of lineCache) {
      for (const { sylEl, start, end } of syls) {
        const isHot = seconds >= start && seconds < end;
        if (isHot) activeLineEl = lineEl;
        sylEl.classList.toggle('hot', isHot);
      }
    }
    if (activeLineEl && activeLineEl !== lastActiveLineEl) {
      lastActiveLineEl = activeLineEl;
      const prefersReducedMotion =
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      activeLineEl.scrollIntoView({
        block: 'center',
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    }
  }

  return {
    el,
    setActiveTime,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ac.abort();
    },
  };
}
