/**
 * StemTracksDetail.js — detalle de la fila Pistas del stepper de
 * procesamiento. Monta el MultiTrackPlayer sincronizado (mismo componente
 * que el Estudio publico, SongStudioView): todas las pistas suenan a la vez
 * con mute/solo por pista, scrubber maestro y chips de seccion. El player
 * recibe sus pistas al crearse, asi que se RECREA cuando cambia el conjunto
 * de kinds separados (firma por kinds, nunca por URL: las URLs firmadas se
 * regeneran en cada poll y no deben resetear la reproduccion). Mientras
 * stems separa lead/coros se muestra un indicador de ecualizador; cuando
 * clips termina, una sub-linea informativa al final.
 */
import { icon } from '../../lib/icons.js';
import { createMultiTrackPlayer } from './MultiTrackPlayer.js';

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

/**
 * @param {{ songId: string }} opts
 * @returns {{ el: HTMLElement, update: (run: object|null) => void, destroy: () => void }}
 */
export function createStemTracksDetail({ songId: _songId }) {
  const el = document.createElement('div');
  el.className = 'stem-tracks';

  const playerHost = document.createElement('div');
  playerHost.className = 'stem-tracks__player';
  el.appendChild(playerHost);

  let player = null;
  let signature = '';
  let eqRow = null;
  let clipsLine = null;

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
    // Orden estable de KIND_LABELS; kinds desconocidos del backend al final.
    const known = KIND_LABELS.filter(([kind]) => tracksObj[kind]).map(([kind]) => kind);
    const extra = Object.keys(tracksObj).filter((k) => tracksObj[k] && !known.includes(k));
    const kinds = [...known, ...extra];

    const sig = kinds.join('|');
    if (sig !== signature) {
      signature = sig;
      player?.destroy();
      player = null;
      playerHost.innerHTML = '';
      if (kinds.length) {
        const tracks = kinds.map((kind) => ({
          kind,
          url: tracksObj[kind],
          label: trackLabel(kind),
          durationSec: null,
        }));
        player = createMultiTrackPlayer({ tracks, structure: run?.structure ?? null });
        playerHost.appendChild(player.el);
      }
    }

    const stemsRunning = run?.phases?.stems?.status === 'running';
    const missingSplit = !tracksObj.lead || !tracksObj.backing;
    if (stemsRunning && missingSplit) ensureEqRow();
    else removeEqRow();

    if (run?.phases?.clips?.status === 'done') ensureClipsLine();
  }

  return {
    el,
    update,
    destroy() {
      player?.destroy();
      player = null;
    },
  };
}
