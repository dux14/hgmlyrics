/**
 * SongPartituraView.js — vista pública de la Partitura de una canción
 * (pipeline unificado, plan D, Task D5b). Muestra letra↔nota por voz a
 * partir del análisis publicado del Estudio (getSongStudio): reusa el
 * mismo render compartido de PartituraPage (renderVoiceLines, D5a).
 *
 * Solo las voces con letra (`.lines`) tienen sentido en una partitura de
 * letra — `male`/`female`/`choir` suelen venir como `{notes}` sin `.lines`
 * (voces sin letra) y se filtran, mismo criterio que SongStudioView/ToneLyrics.
 */
import '../../styles/pipeline.css';
import '../../styles/partitura.css';
import { icon } from '../../lib/icons.js';
import { goBack, onRouteChange } from '../../router.js';
import { getSongStudio } from '../../lib/studioApi.js';
import { escapeHtml } from '../../lib/escape.js';
import { renderVoiceLines } from '../../lib/partituraRender.js';

// Etiqueta legible por tipo de voz — mismo vocabulario que SongStudioView.
const VOICE_LABEL = {
  lead: 'Voz principal',
  backing: 'Coros',
  vocals: 'Voz',
  male: 'Voz masculina',
  female: 'Voz femenina',
  choir: 'Coros',
};

/**
 * @param {HTMLElement} container
 * @param {string} songId
 */
export function renderSongPartituraView(container, songId) {
  container.innerHTML = '';
  container.dataset.songId = songId;

  const view = document.createElement('div');
  view.className = 'pipeline-view';
  view.innerHTML = `
    <header class="pipeline-view__header">
      <button type="button" class="pipeline-view__back" aria-label="Volver">${icon('arrow-left')}</button>
      <h1 class="pipeline-view__title partitura-view__title">Partitura</h1>
      <a class="pipeline-view__studio-link" href="#/song/${escapeHtml(songId)}/estudio">${icon('audio-lines', { size: 16 })}<span>Ver en Estudio</span></a>
    </header>
    <div class="partitura-view__body">
      <p class="partitura-view__loading">Cargando partitura...</p>
    </div>
  `;
  container.appendChild(view);
  view.querySelector('.pipeline-view__back').addEventListener('click', () => goBack());

  const bodyEl = view.querySelector('.partitura-view__body');

  let unmounted = false;
  const off = onRouteChange(() => {
    unmounted = true;
    off();
  });

  getSongStudio(songId)
    .then((data) => {
      if (unmounted) return;
      const voces = (data?.analysis?.voices_present ?? []).filter(
        (key) => data.analysis.voices?.[key]?.lines?.length,
      );
      if (!data || !voces.length) {
        renderEmptyState();
        return;
      }
      renderPartitura(data, voces);
    })
    .catch((err) => {
      console.error('SongPartituraView: no se pudo cargar la partitura', err);
      if (unmounted) return;
      bodyEl.innerHTML =
        '<p class="partitura-view__empty">No se pudo cargar la partitura de esta canción.</p>';
    });

  function renderEmptyState() {
    bodyEl.innerHTML =
      '<p class="partitura-view__empty">Esta canción todavía no tiene partitura publicada.</p>';
  }

  function renderPartitura(data, voces) {
    const titleEl = view.querySelector('.partitura-view__title');
    if (data.title) titleEl.textContent = data.title;

    const tabsHtml = voces
      .map(
        (key, i) =>
          `<button type="button" role="tab" aria-selected="${i === 0}" class="partitura__voice-tab${i === 0 ? ' is-active' : ''}" data-voice-key="${escapeHtml(key)}">${escapeHtml(VOICE_LABEL[key] || key)}</button>`,
      )
      .join('');

    bodyEl.innerHTML = `
      <div class="partitura__voice-tabs" role="tablist">${tabsHtml}</div>
      <div class="partitura__voice partitura-view__voice" role="tabpanel"></div>
    `;

    const voiceEl = bodyEl.querySelector('.partitura-view__voice');
    const paintVoice = (key) => {
      voiceEl.innerHTML = renderVoiceLines(data.analysis.voices[key]);
    };
    paintVoice(voces[0]);

    bodyEl.querySelector('.partitura__voice-tabs').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-voice-key]');
      if (!btn) return;
      const key = btn.dataset.voiceKey;
      bodyEl.querySelectorAll('.partitura__voice-tab').forEach((tab) => {
        const active = tab === btn;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      paintVoice(key);
    });
  }
}
