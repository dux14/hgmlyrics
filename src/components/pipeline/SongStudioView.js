/**
 * SongStudioView.js — vista pública del Estudio de una canción (pipeline
 * unificado, plan D, Task D4d). Compone el reproductor multipista
 * (MultiTrackPlayer, D4b) con la letra-con-tono (ToneLyrics, D4c): el
 * tiempo maestro del player alimenta el resaltado de sílaba, el tap en una
 * línea de la letra hace seek del player, y una leyenda deja atenuar
 * (no ocultar) una voz puntual de la partitura.
 *
 * Regla del proyecto: nada se oculta. Una pista o voz inexistente en el
 * estudio de esta canción simplemente no genera fila/ítem — nunca se
 * inventa contenido de relleno.
 */
import '../../styles/pipeline.css';
import { icon } from '../../lib/icons.js';
import { goBack, onRouteChange } from '../../router.js';
import { getSongStudio } from '../../lib/studioApi.js';
import { createMultiTrackPlayer } from './MultiTrackPlayer.js';
import { createToneLyrics } from './ToneLyrics.js';

// Etiqueta legible por tipo de stem. Fallback: el propio `kind` tal cual
// vino del backend (nunca queda una fila sin texto).
const KIND_LABEL = {
  vocals: 'Voz',
  lead: 'Voz principal',
  backing: 'Coros',
  male: 'Voz masculina',
  female: 'Voz femenina',
  choir: 'Coros',
  instrumental: 'Instrumental',
  guitar: 'Guitarra',
  piano: 'Piano',
  bass: 'Bajo',
  drums: 'Batería',
  other: 'Otro',
};

const VOICE_KINDS = new Set(['vocals', 'lead', 'backing', 'male', 'female', 'choir']);

/** Mapea stems del backend a tracks del MultiTrackPlayer, agrupados (voces primero). */
function stemsToTracks(stems) {
  const tracks = (stems ?? []).map((s) => ({
    kind: s.kind,
    url: s.url,
    label: s.display || KIND_LABEL[s.kind] || s.kind,
    durationSec: s.durationSec,
    group: VOICE_KINDS.has(s.kind) ? 'voces' : 'instrumentos',
  }));
  const voces = tracks.filter((t) => t.group === 'voces');
  const instrumentos = tracks.filter((t) => t.group === 'instrumentos');
  return [...voces, ...instrumentos];
}

// Leyenda de voces: nivel 0 (base) = "Voz principal" (teal), nivel 1 =
// "Alterna" (violeta), nivel 2+ = "Coros" (rosa, puede agrupar más de una
// voz — se atenúan/reactivan juntas bajo un solo ítem).
function buildLegendItems(voicesPresent) {
  const items = [];
  if (voicesPresent[0]) {
    items.push({ label: 'Voz principal', cls: 'tone-note--lead', keys: [voicesPresent[0]] });
  }
  if (voicesPresent[1]) {
    items.push({ label: 'Alterna', cls: 'tone-note--alt', keys: [voicesPresent[1]] });
  }
  const coros = voicesPresent.slice(2);
  if (coros.length) {
    items.push({ label: 'Coros', cls: 'tone-note--coros', keys: coros });
  }
  return items;
}

/**
 * @param {HTMLElement} container
 * @param {string} songId
 */
export function renderSongStudioView(container, songId) {
  container.innerHTML = '';
  container.dataset.songId = songId;

  const view = document.createElement('div');
  view.className = 'pipeline-view';
  view.innerHTML = `
    <header class="pipeline-view__header">
      <button type="button" class="pipeline-view__back" aria-label="Volver">${icon('arrow-left')}</button>
      <h1 class="pipeline-view__title">Estudio</h1>
    </header>
    <div class="studio-view__body">
      <p class="studio-view__loading">Cargando estudio...</p>
    </div>
  `;
  container.appendChild(view);
  view.querySelector('.pipeline-view__back').addEventListener('click', () => goBack());

  const bodyEl = view.querySelector('.studio-view__body');

  let unmounted = false;
  let player = null;
  let tone = null;
  const off = onRouteChange(() => {
    unmounted = true;
    player?.destroy();
    tone?.destroy();
    off();
  });

  getSongStudio(songId)
    .then((data) => {
      if (unmounted) return;
      if (!data) {
        renderEmptyState();
        return;
      }
      renderStudio(data);
    })
    .catch((err) => {
      console.error('SongStudioView: no se pudo cargar el estudio', err);
      if (unmounted) return;
      bodyEl.innerHTML =
        '<p class="studio-view__empty">No se pudo cargar el estudio de esta canción.</p>';
    });

  function renderEmptyState() {
    bodyEl.innerHTML =
      '<p class="studio-view__empty">Esta canción todavía no tiene estudio publicado.</p>';
  }

  function renderStudio(data) {
    const titleEl = view.querySelector('.pipeline-view__title');
    if (data.title) titleEl.textContent = data.title;

    bodyEl.innerHTML = `
      <div class="studio-view__player"></div>
      <div class="studio-view__legend"></div>
      <div class="studio-view__lyrics"></div>
    `;

    const tracks = stemsToTracks(data.stems);
    player = createMultiTrackPlayer({ tracks });
    view.querySelector('.studio-view__player').appendChild(player.el);

    tone = createToneLyrics({
      analysis: data.analysis,
      onSeek: (sec) => player?.seek(sec),
    });
    view.querySelector('.studio-view__lyrics').appendChild(tone.el);

    player.onTime((sec) => tone.setActiveTime(sec));

    const voicesPresent = Array.isArray(data.analysis?.voices_present)
      ? data.analysis.voices_present
      : [];
    const legendItems = buildLegendItems(voicesPresent);
    const legendEl = view.querySelector('.studio-view__legend');
    if (legendItems.length) {
      const dimmed = new Set();
      legendEl.innerHTML = legendItems
        .map(
          (item, i) =>
            `<button type="button" class="studio-view__legend-item" data-idx="${i}" aria-pressed="false">
              <span class="tone-note ${item.cls}">●</span>
              <span>${item.label}</span>
            </button>`,
        )
        .join('');
      legendEl.querySelectorAll('.studio-view__legend-item').forEach((btn, i) => {
        btn.addEventListener('click', () => {
          const item = legendItems[i];
          const isDimmed = dimmed.has(i);
          if (isDimmed) dimmed.delete(i);
          else dimmed.add(i);
          btn.setAttribute('aria-pressed', String(!isDimmed));
          btn.classList.toggle('is-dimmed', !isDimmed);
          item.keys.forEach((key) => tone?.setVoiceDimmed(key, !isDimmed));
        });
      });
    }
  }
}
