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
import { SECTION_TYPE_LABELS, normalizeSectionType } from '../../lib/sectionTypes.js';

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

// Etiqueta legible de la leyenda por rol de color (mismo vocabulario que
// ROLE_CLASS, sin el prefijo `tone-note--`).
const ROLE_LABEL = { lead: 'Voz principal', alt: 'Alterna', coros: 'Coros' };

function roleKeyFor(voiceKey, levelIndex) {
  return roleClassFor(voiceKey, levelIndex).replace('tone-note--', '');
}

// Voces que `setVoiceDimmed` acepta — enum fijo del pipeline (ver
// `voices_present`). Cualquier otra clave se ignora (defensa ante selector
// interpolado con `data-voice`).
const KNOWN_VOICE_KEYS = new Set(['lead', 'backing', 'male', 'female', 'choir']);

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
        `<span class="tone-note ${roleClassFor(n.key, idx)}" data-voice="${escapeHtml(n.key)}">${escapeHtml(n.label)}</span>`,
    )
    .join('');
  const moreHtml = extra.length
    ? `<button type="button" class="tone-more" data-action="tone-more" aria-expanded="false">+${extra.length}</button>
       <span class="tone-more-panel" hidden>${extra
         .map(
           (n) =>
             `<span class="tone-note tone-note--coros" data-voice="${escapeHtml(n.key)}">${escapeHtml(n.label)}</span>`,
         )
         .join('')}</span>`
    : '';
  return `<span class="tone-syl-notes">${stackedHtml}${moreHtml}</span>`;
}

// `song.sections` (letra del cancionero, v3) no referencia índices de línea:
// cada sección trae su propio array `lines`. Para repartir las líneas de
// `analysis` (pitch) por sección asumimos el mismo orden/cantidad y
// derivamos el rango [start, end) de cada sección por conteo acumulado de
// `section.lines.length`.
//
// OJO: `sections` (cancionero, editado a mano en SongEditor) y `analysis`
// (partitura de tono, generada en modal/pitch/ a partir de un split ASR por
// pausas — dominio propio, sin relación con el cancionero) son DOS
// PIPELINES INDEPENDIENTES sin reconciliación de conteo de líneas entre
// ambos. Si el cancionero se edita después del análisis, o el corte de ASR
// no coincide con los cortes del cancionero, el conteo total diverge y un
// reparto por índice asignaría encabezados a líneas equivocadas — en
// silencio. Por eso `totalLines` compara el conteo total ANTES de repartir:
// si no coincide, se descarta el agrupado entero (mejor lista plana que
// encabezados mal puestos).
function sectionBoundariesFor(sections, totalLines) {
  if (!Array.isArray(sections) || sections.length === 0) return [];
  let acc = 0;
  const boundaries = sections.map((s) => {
    const count = Array.isArray(s?.lines) ? s.lines.length : 0;
    const start = acc;
    acc += count;
    return { type: s?.type, start, end: acc };
  });
  if (acc !== totalLines) {
    console.warn(
      `ToneLyrics: sections (${acc} líneas) y analysis (${totalLines} líneas) desincronizados — se omite el agrupado por sección`,
    );
    return [];
  }
  return boundaries;
}

/**
 * @param {{ analysis: object|null, sections?: Array|null, onSeek?: (seconds: number) => void }} opts
 * @returns {{ el: HTMLElement, setActiveTime: (seconds: number) => void, destroy: () => void }}
 */
export function createToneLyrics({ analysis, sections, onSeek } = {}) {
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
    return { el, setActiveTime() {}, setVoiceDimmed() {}, destroy() {}, voices: [] };
  }

  const otherKeys = voicesPresent.filter((k) => k !== baseKey && analysis.voices?.[k]?.lines);

  // Voces efectivamente renderizadas, en el mismo orden que las notas
  // apiladas (base primero): fuente única de verdad para la leyenda — así
  // nunca atenúa un control muerto (voz presente en `voices_present` pero
  // sin `.lines`, por ende sin notas pintadas).
  const voices = [baseKey, ...otherKeys].map((key, levelIndex) => {
    const role = roleKeyFor(key, levelIndex);
    return { key, role, label: ROLE_LABEL[role] };
  });

  const boundaries = sectionBoundariesFor(sections, baseLines.length);
  let currentSectionIdx = -1;

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

      // Encabezado de sección: se emite una sola vez, justo antes de la
      // primera línea que cae en su rango [start, end). Sin `sections` (o
      // vacío), `boundaries` queda [] y nunca se pinta ninguno (compat).
      let headerHtml = '';
      const idx = boundaries.findIndex((b) => li >= b.start && li < b.end);
      if (idx !== -1 && idx !== currentSectionIdx) {
        currentSectionIdx = idx;
        const slug = normalizeSectionType(boundaries[idx].type);
        const label = SECTION_TYPE_LABELS[slug] ?? SECTION_TYPE_LABELS.verse;
        headerHtml = `<div class="tone-lyrics__section-header" style="color: var(--color-section-${slug})">${escapeHtml(label)}</div>`;
      }

      return `${headerHtml}<p class="tone-line" data-line="${li}">${sylHtml}</p>`;
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

  // Atenúa (opacity, sin remover nodos) las notas de una voz puntual — usado
  // por la leyenda de voces para "aislar" auditivamente/visualmente lead,
  // alterna o coros sin perder la referencia de las demás.
  function setVoiceDimmed(voiceKey, dimmed) {
    if (destroyed) return;
    if (!KNOWN_VOICE_KEYS.has(voiceKey)) return;
    el.querySelectorAll(`.tone-note[data-voice="${voiceKey}"]`).forEach((noteEl) => {
      noteEl.classList.toggle('dim', dimmed);
    });
  }

  return {
    el,
    setActiveTime,
    setVoiceDimmed,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ac.abort();
    },
    voices,
  };
}
