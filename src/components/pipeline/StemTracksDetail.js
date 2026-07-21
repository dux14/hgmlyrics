/**
 * StemTracksDetail.js — detalle de la fila Pistas del stepper de
 * procesamiento (pipeline unificado, plan D, Task D3c). Una fila `.track`
 * por pista de stems ya separada (DISPLAY PROGRESIVO: aparece apenas su URL
 * existe), reproducibles con el gestor de audio único de SectionPlayer.js —
 * un solo `<audio>` real compartido, nunca uno por fila. Mientras stems
 * sigue separando lead/coros muestra un indicador de ecualizador; cuando
 * clips (que no tiene fila propia en el stepper) termina, agrega una
 * sub-línea informativa al final.
 */
import { icon } from '../../lib/icons.js';
import { escapeHtml } from '../../lib/escape.js';
import { createSectionAudioManager } from '../SectionPlayer.js';
import { getPipelineRun } from '../../lib/pipelineApi.js';

// Orden de despliegue + labels en español con tildes (kind -> texto).
const KIND_LABELS = [
  ['vocals', 'Voz'],
  ['instrumental', 'Instrumental'],
  ['lead', 'Voz principal'],
  ['backing', 'Coros'],
  ['male', 'Voz masculina'],
  ['female', 'Voz femenina'],
];

function trackLabel(kind) {
  const found = KIND_LABELS.find(([k]) => k === kind);
  return found ? found[1] : kind;
}

function toManagerTrack(kind, url) {
  // Shape que espera createSectionAudioManager (SectionPlayer.js): acá no
  // hay secciones ni voiceScope real, solo el id (kind) importa para
  // identificar qué pista suena.
  return { id: kind, sectionIndex: 0, voiceScope: null, label: trackLabel(kind), durationSec: null, url };
}

/**
 * @param {{ songId: string }} opts
 * @returns {{ el: HTMLElement, update: (run: object|null) => void, destroy: () => void }}
 */
export function createStemTracksDetail({ songId }) {
  const el = document.createElement('div');
  el.className = 'stem-tracks';

  const rows = new Map(); // kind -> { row, playBtn }
  let eqRow = null;
  let clipsLine = null;

  async function refetch() {
    const data = await getPipelineRun(songId);
    const tracksObj = data?.run?.phases?.stems?.tracks || {};
    return Object.entries(tracksObj)
      .filter(([, url]) => !!url)
      .map(([kind, url]) => toManagerTrack(kind, url));
  }

  const manager = createSectionAudioManager({ tracks: [], refetch });

  function paintRow(kind) {
    const entry = rows.get(kind);
    if (!entry) return;
    const current = manager.getCurrentTrack();
    const playing = current?.id === kind && !manager.audio.paused;
    entry.playBtn.innerHTML = icon(playing ? 'pause' : 'play', { size: 14 });
    entry.playBtn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
    entry.row.classList.toggle('track--playing', playing);
  }

  function paintAll() {
    rows.forEach((_, kind) => paintRow(kind));
  }

  const offTime = manager.onTime(paintAll);
  const offEnded = manager.onEnded(paintAll);
  manager.audio.addEventListener('play', paintAll);
  manager.audio.addEventListener('pause', paintAll);

  function ensureRow(kind, url) {
    if (rows.has(kind)) return;
    const row = document.createElement('div');
    row.className = 'track';
    row.dataset.kind = kind;
    row.innerHTML = `
      <button type="button" class="track__play" aria-label="Reproducir">${icon('play', { size: 14 })}</button>
      <span class="track__label">${escapeHtml(trackLabel(kind))}</span>
    `;
    row.querySelector('.track__play').addEventListener('click', () => {
      const current = manager.getCurrentTrack();
      if (current?.id === kind && !manager.audio.paused) {
        manager.pause();
      } else {
        manager.play(toManagerTrack(kind, url));
      }
      paintRow(kind);
    });
    // Las pistas siempre van antes del indicador de ecualizador y de la
    // sub-línea de clips, aunque ambos ya estén montados.
    const before = (eqRow && eqRow.parentNode === el && eqRow) || (clipsLine && clipsLine.parentNode === el && clipsLine) || null;
    if (before) el.insertBefore(row, before);
    else el.appendChild(row);
    rows.set(kind, { row, playBtn: row.querySelector('.track__play') });
  }

  function ensureEqRow() {
    if (eqRow) return;
    eqRow = document.createElement('div');
    eqRow.className = 'track track--eq';
    eqRow.innerHTML = `
      <span class="ph-loader ph-loader--eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="track__label">Separando lead y coros...</span>
    `;
    if (clipsLine && clipsLine.parentNode === el) el.insertBefore(eqRow, clipsLine);
    else el.appendChild(eqRow);
  }

  function removeEqRow() {
    if (!eqRow) return;
    eqRow.remove();
    eqRow = null;
  }

  function ensureClipsLine() {
    if (clipsLine) return;
    clipsLine = document.createElement('div');
    clipsLine.className = 'track track--clips';
    clipsLine.innerHTML = `${icon('check', { size: 14 })}<span class="track__label">Clips por sección listos</span>`;
    el.appendChild(clipsLine);
  }

  function update(run) {
    const tracksObj = run?.phases?.stems?.tracks || {};
    KIND_LABELS.forEach(([kind]) => {
      const url = tracksObj[kind];
      if (url) ensureRow(kind, url);
    });

    const stemsRunning = run?.phases?.stems?.status === 'running';
    const missingSplit = !tracksObj.lead || !tracksObj.backing;
    if (stemsRunning && missingSplit) ensureEqRow();
    else removeEqRow();

    if (run?.phases?.clips?.status === 'done') ensureClipsLine();

    paintAll();
  }

  return {
    el,
    update,
    destroy() {
      offTime();
      offEnded();
      manager.audio.removeEventListener('play', paintAll);
      manager.audio.removeEventListener('pause', paintAll);
      manager.destroy();
      rows.clear();
    },
  };
}
