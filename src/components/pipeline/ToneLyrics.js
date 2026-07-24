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
import { lineSegmentIndex } from '../../lib/studioPractice.js';
import { sectionColorSlug, displayLabel } from '../../lib/structureLabels.js';
import { createSpring } from '../../lib/spring.js';

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

/**
 * @param {{ analysis: object|null, structure?: object|null, timings?: object|null, sections?: Array|null, onSeek?: (seconds: number) => void }} opts
 *   `structure` (song_structure, SongFormer) alimenta los encabezados de
 *   sección — `sections` (cancionero) se sigue aceptando por compat de
 *   firma pero ya NO se usa para agrupar (dos pipelines independientes sin
 *   reconciliación de conteo de líneas, ver Task 5). `timings` (alignment)
 *   alimenta las marcas de confianza por línea.
 * @returns {{ el: HTMLElement, setActiveTime: (seconds: number) => void, destroy: () => void }}
 */
export function createToneLyrics({
  analysis,
  structure = null,
  timings = null,
  sections: _sections,
  onSeek,
} = {}) {
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

  // Headers de sección: vienen de `structure` (song_structure, SongFormer),
  // no del cancionero. La línea pertenece al segmento que contiene el
  // `start` (segundos) de su primera sílaba; se pinta un encabezado una sola
  // vez, justo antes de la primera línea de cada segmento nuevo. Sin
  // `structure` (o sin segments), `segments` queda [] y nunca se pinta
  // ninguno (compat con el plano).
  const segments = Array.isArray(structure?.segments) ? structure.segments : [];
  let currentSegIdx = -1;

  // Confianza por línea (alignment, `timings.lines[].{interpolated,score,manual}`):
  // indexado por `i` (índice de línea), no por posición del array.
  const timingByI = new Map((timings?.lines ?? []).map((l) => [l.i, l]));

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

      let headerHtml = '';
      const lineStart = Number.isFinite(line.syllables?.[0]?.start)
        ? line.syllables[0].start
        : null;
      const segIdx = lineStart === null ? -1 : lineSegmentIndex(lineStart, segments);
      if (segIdx !== -1 && segIdx !== currentSegIdx) {
        currentSegIdx = segIdx;
        const slug = sectionColorSlug(segments[segIdx].label);
        headerHtml = `<div class="tone-lyrics__section-header" style="color: var(--color-section-${slug})">${escapeHtml(displayLabel(segments[segIdx].label))}</div>`;
      }

      const t = timingByI.get(li);
      const score = typeof t?.score === 'string' ? Number(t.score) : t?.score;
      const confClasses = [];
      if (t?.interpolated === true || (Number.isFinite(score) && score < 0.6)) {
        confClasses.push('tone-line--lowconf');
      }
      if (t?.manual === true) confClasses.push('tone-line--manual');
      const lineClass = ['tone-line', ...confClasses].join(' ');

      return `${headerHtml}<p class="${lineClass}" data-line="${li}">${sylHtml}</p>`;
    })
    .join('');

  // `el` es el viewport (overflow: hidden); `.tone-lyrics__roll` es el nodo
  // que se traslada con el spring en setActiveTime.
  el.innerHTML = `<div class="tone-lyrics__roll">${html}</div>`;
  const rollEl = el.querySelector('.tone-lyrics__roll');

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

  const spring = createSpring();
  let rafId = null;
  let lastTs = null;

  // Retarget continuo del roll hacia la línea activa: sin teleport, el
  // spring reacomoda desde donde esté aunque cambie de línea a mitad de
  // camino. En jsdom (tests) clientHeight/offsetTop son 0 → targetY termina
  // en 0, no crashea, solo no hay animación real que verificar.
  function retargetScroll(lineEl) {
    const prefersReducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const viewportH = el.clientHeight;
    const centerY = lineEl.offsetTop + lineEl.offsetHeight / 2;
    const targetY = viewportH * 0.4 - centerY;
    if (prefersReducedMotion) {
      spring.snap(targetY);
      rollEl.style.transform = `translateY(${targetY}px)`;
      return;
    }
    spring.setTarget(targetY);
    if (rafId !== null) return;
    lastTs = null;
    const loop = (ts) => {
      if (lastTs === null) lastTs = ts;
      const moving = spring.step(ts - lastTs);
      lastTs = ts;
      rollEl.style.transform = `translateY(${spring.getValue()}px)`;
      rafId = moving ? requestAnimationFrame(loop) : null;
    };
    rafId = requestAnimationFrame(loop);
  }

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

  const DIST_CLASSES = ['tone-line--active', 'tone-line--d1', 'tone-line--d2', 'tone-line--far'];

  function setActiveTime(seconds) {
    if (destroyed) return;
    let activeLineEl = null;
    let activeIdx = -1;
    lineCache.forEach(({ lineEl, syls }, idx) => {
      for (const { sylEl, start, end } of syls) {
        const isHot = seconds >= start && seconds < end;
        if (isHot) {
          activeLineEl = lineEl;
          activeIdx = idx;
        }
        sylEl.classList.toggle('hot', isHot);
      }
    });

    // Sin línea activa (fuera de rango, p.ej. antes de la primera sílaba):
    // no tocamos clases de distancia ni el scroll, el roll queda donde está.
    if (activeIdx === -1) return;

    lineCache.forEach(({ lineEl }, idx) => {
      lineEl.classList.remove(...DIST_CLASSES);
      const d = Math.abs(idx - activeIdx);
      lineEl.classList.add(
        d === 0
          ? DIST_CLASSES[0]
          : d === 1
            ? DIST_CLASSES[1]
            : d === 2
              ? DIST_CLASSES[2]
              : DIST_CLASSES[3],
      );
    });

    if (activeLineEl !== lastActiveLineEl) {
      lastActiveLineEl = activeLineEl;
      retargetScroll(activeLineEl);
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
      if (rafId !== null) cancelAnimationFrame(rafId);
    },
    voices,
  };
}
