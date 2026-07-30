/**
 * SheetAudio.js — dueño del ciclo de vida del audio de la hoja de revisión de
 * letra. No reproduce: monta createMultiTrackPlayer con la única pista de
 * voz aislada y delega. Oculta la fila de mezcla (mute/solo no significan
 * nada con una sola pista) y renueva la URL firmada una vez si el audio
 * interno del player falla (las firmadas de signTracks vencen a las 6 h,
 * ver api/songs/[id]/pipeline.js).
 * @param {{ songId: string, url: string, onError?: (msg: string) => void }} opts
 * @returns {{ el: HTMLElement, open: () => void, close: () => void, isOpen: () => boolean, seek: (ms: number) => void, onTime: (cb: (sec:number)=>void) => (() => void), destroy: () => void }}
 */
import { createMultiTrackPlayer } from '../MultiTrackPlayer.js';
import { getPipelineRun } from '../../../lib/pipelineApi.js';

export function SheetAudio({ songId, url, onError }) {
  const el = document.createElement('div');
  el.className = 'sheet-audio';
  let player = null;
  let currentUrl = url;
  let lastSec = 0; // el player informa el tiempo por onTime, no lo expone
  let renewed = false; // un solo refetch por vida: nunca un bucle sobre una URL muerta
  const timeCbs = new Set();

  function mount(seekTo = null) {
    player = createMultiTrackPlayer({
      tracks: [{ kind: 'vocals', url: currentUrl, label: 'Voz' }],
      structure: null, // sin chips de sección: la hoja ya tiene sus secciones
    });
    // Con una sola pista, mute y solo no significan nada.
    if (player.els.mixer) player.els.mixer.hidden = true;
    el.appendChild(player.el);
    player.onTime((sec) => {
      lastSec = sec;
      for (const cb of timeCbs) cb(sec);
    });
    if (seekTo !== null) player.seek(seekTo);
  }

  function teardown() {
    player?.destroy();
    player = null;
    el.innerHTML = '';
  }

  // El `error` de un elemento <audio> interno del player NO burbujea: se
  // escucha en fase de captura sobre el contenedor.
  el.addEventListener(
    'error',
    () => {
      if (!player) return;
      // Ya renovamos una vez: la URL nueva también murió. No hay segundo
      // refetch (un solo refetch por vida, nunca un bucle sobre una URL
      // muerta) — solo avisar, que si no el usuario queda sin transporte y
      // sin explicación.
      if (renewed) {
        onError?.('No se pudo cargar la voz aislada');
        return;
      }
      renewed = true;
      const resumeAt = lastSec;
      getPipelineRun(songId)
        .then((data) => {
          const next = data?.run?.phases?.stems?.tracks?.vocals;
          if (!next) throw new Error('sin pista de voz');
          currentUrl = next;
          teardown();
          mount(resumeAt);
        })
        .catch(() => onError?.('No se pudo cargar la voz aislada'));
    },
    true,
  );

  return {
    el,
    open() {
      if (!player) mount();
    },
    close() {
      teardown();
    },
    isOpen: () => player !== null,
    /** `ms` es el contrato de la hoja hacia afuera; el player habla en segundos. */
    seek(ms) {
      this.open();
      player.seek(ms / 1000);
    },
    onTime(cb) {
      timeCbs.add(cb);
      return () => timeCbs.delete(cb);
    },
    destroy() {
      timeCbs.clear();
      teardown();
    },
  };
}
