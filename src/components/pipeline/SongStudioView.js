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
import { goBack, navigate, onRouteChange } from '../../router.js';
import { isAdmin } from '../../lib/authStore.js';
import { getSongStudio } from '../../lib/studioApi.js';
import { createMultiTrackPlayer } from './MultiTrackPlayer.js';
import { createToneLyrics } from './ToneLyrics.js';
import { createSectionAudioManager } from '../SectionPlayer.js';

// Etiqueta legible por tipo de stem. Fallback: el propio `kind` tal cual
// vino del backend (nunca queda una fila sin texto).
const KIND_LABEL = {
  vocals: 'Voz',
  lead: 'Voz principal',
  backing: 'Coros',
  male: 'Voz masculina',
  female: 'Voz femenina',
  choir: 'Coros',
  voice_a: 'Voz A',
  voice_b: 'Voz B',
  instrumental: 'Instrumental',
  guitar: 'Guitarra',
  piano: 'Piano',
  bass: 'Bajo',
  drums: 'Batería',
  other: 'Otro',
};

// `voice_a`/`voice_b` (sección duet) son voces, no instrumentos: sin ellas aquí
// caían bajo INSTRUMENTOS y mostraban el kind crudo como etiqueta.
const VOICE_KINDS = new Set([
  'vocals',
  'lead',
  'backing',
  'male',
  'female',
  'choir',
  'voice_a',
  'voice_b',
]);

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

// Clase de color por rol — mismo vocabulario que ToneLyrics.ROLE_CLASS
// (teal=lead, violeta=alt, rosa=coros). La leyenda sale de `tone.voices`
// (las voces que ToneLyrics REALMENTE pinta), nunca de una posición fija en
// `voices_present`: así ningún ítem atenúa un control muerto.
const ROLE_SWATCH_CLASS = {
  lead: 'tone-note--lead',
  alt: 'tone-note--alt',
  coros: 'tone-note--coros',
};

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
      ${
        isAdmin()
          ? `<button type="button" class="studio-view__edit">${icon('pencil', { size: 18 })}<span>Editar</span></button>`
          : ''
      }
    </header>
    <div class="studio-view__body">
      <p class="studio-view__loading">Cargando estudio...</p>
    </div>
  `;
  container.appendChild(view);
  view.querySelector('.pipeline-view__back').addEventListener('click', () => goBack());
  view
    .querySelector('.studio-view__edit')
    ?.addEventListener('click', () => navigate(`/song/${songId}/procesamiento`));

  const bodyEl = view.querySelector('.studio-view__body');

  let unmounted = false;
  let player = null;
  let tone = null;
  let clipManager = null;
  const off = onRouteChange(() => {
    unmounted = true;
    player?.destroy();
    tone?.destroy();
    clipManager?.destroy();
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

    const tracks = stemsToTracks(data.stems);
    player = createMultiTrackPlayer({
      tracks,
      structure: data.structure,
      beats: data.timings?.beats ?? null,
      bpm: data.audio?.bpmManual ?? data.timings?.bpmDetected ?? null,
      timeSignature: data.audio?.timeSignature ?? '4/4',
      beatAnchor: data.audio?.beatAnchor ?? 1,
    });

    tone = createToneLyrics({
      analysis: data.analysis,
      structure: data.structure,
      timings: data.timings,
      sections: data.sections,
      onSeek: (sec) => player?.seek(sec),
    });
    player.onTime((sec) => tone.setActiveTime(sec));

    const legendEl = document.createElement('div');
    legendEl.className = 'studio-view__legend';

    const lyricsWrap = document.createElement('div');
    lyricsWrap.className = 'studio-view__lyrics';
    lyricsWrap.appendChild(tone.el);

    bodyEl.innerHTML = '';
    // Layout B: se descarta `player.el` a propósito, solo se usan los
    // sub-elementos `els.*` recompuestos en el orden de esta vista. No
    // reintroducir `appendChild(player.el)` — duplicaría todo el DOM.
    bodyEl.append(
      player.els.transport,
      player.els.practice,
      player.els.sections,
      legendEl,
      lyricsWrap,
      player.els.nowSound,
      player.els.mixer,
      player.els.audios,
    );

    // Clip de la sección activa: reproduce song_section_audio con exclusión
    // mutua contra el multitrack (nunca dos fuentes sonando a la vez). Sin
    // clips (data.clips vacío), no se pinta el botón — nada de relleno.
    if (data.clips?.length) {
      clipManager = createSectionAudioManager({
        tracks: data.clips.map((c, idx) => ({
          id: `clip-${idx}`,
          sectionIndex: c.sectionIndex,
          voiceScope: c.voiceScope ?? null,
          url: c.url,
          label: c.label,
          durationSec: c.durationSec,
        })),
      });
      const clipBtn = document.createElement('button');
      clipBtn.type = 'button';
      clipBtn.className = 'studio-view__clip';
      clipBtn.innerHTML = `${icon('scissors', { size: 16 })}<span>Escuchar solo esta sección</span>`;
      clipBtn.addEventListener('click', () => {
        const idx = player.getActiveSection?.() ?? 0;
        const track = clipManager.tracksFor(idx)[0];
        if (!track) return;
        player.pause(); // exclusión mutua: nunca dos fuentes sonando
        clipManager.play(track);
      });
      bodyEl.append(clipBtn);
      // Exclusión mutua inversa: al arrancar el multitrack, pausar el clip.
      player.onPlay(() => clipManager?.pause());
      // El botón se deshabilita cuando la sección activa no tiene clip —
      // se recalcula al cambiar de chip (onTime, vía updateActiveChip).
      const refreshClipBtn = () => {
        const idx = player.getActiveSection?.() ?? 0;
        clipBtn.disabled = clipManager.tracksFor(idx).length === 0;
      };
      refreshClipBtn();
      player.onTime(() => refreshClipBtn());
    }

    // Leyenda: un ítem por voz que ToneLyrics efectivamente pinta
    // (tone.voices), no por posición en voices_present.
    const legendItems = Array.isArray(tone.voices) ? tone.voices : [];
    if (legendItems.length) {
      const dimmed = new Set();
      legendEl.innerHTML = legendItems
        .map(
          (item, i) =>
            `<button type="button" class="studio-view__legend-item" data-idx="${i}" aria-pressed="false">
              <span class="tone-note ${ROLE_SWATCH_CLASS[item.role] || 'tone-note--coros'}">●</span>
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
          tone?.setVoiceDimmed(item.key, !isDimmed);
        });
      });
    }
  }
}
