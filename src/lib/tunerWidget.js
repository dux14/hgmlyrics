/**
 * tunerWidget.js — Motor compartido del afinador embebido (F3), consumido por
 * FloatingTuner.js (widget híbrido de la vista inmersiva/SongView).
 *
 * Reusa el mismo detector/estabilizador que Tuner.js pero afina contra una nota
 * OBJETIVO externa (la nota de la línea actual del teleprompter) en vez de la
 * nota más cercana: `cents = 100 * (midiDetectado - midiObjetivo) + centsFinos`,
 * así cantar una nota distinta bien afinada NO se pone verde (igual criterio que
 * `handlePitchSong`/`handlePitchEntrenar` en Tuner.js). Sin nota objetivo, cae en
 * modo libre (nota detectada centrada, sin objetivo).
 */

import { createPitchDetector } from './pitch.js';
import { createPitchStabilizer } from './pitchStabilizer.js';

/** Umbral de color: <10¢ ok, <30¢ warn, resto bad (mismo criterio que Tuner.js). */
export function colorFromCents(cents) {
  const abs = Math.abs(cents);
  if (abs < 10) return 'ok';
  if (abs < 30) return 'warn';
  return 'bad';
}

/**
 * createTunerEngine — motor compartido del afinador: pipeline de mic
 * (requestMic con épocas para descartar detectores obsoletos) + estabilizador
 * de pitch. Sin DOM: consumido por FloatingTuner.js (widget híbrido montado
 * bajo demanda en la vista inmersiva).
 *
 * @param {{ onPitch?: (stab: object|null) => void,
 *           onState?: (s: 'idle'|'requesting'|'running'|'stopped'|'denied') => void,
 *           onError?: (err: Error) => void }} [opts]
 * @returns {{ start: () => void, stop: () => void, requestMic: () => void,
 *             isRunning: () => boolean }}
 */
export function createTunerEngine({ onPitch = () => {}, onState = () => {}, onError } = {}) {
  let detector = null;
  const stabilizer = createPitchStabilizer();
  let running = false;

  /**
   * Arranca un detector nuevo (o ignora si ya hay uno en vuelo/corriendo).
   * `detector.start()` es async (getUserMedia + setupAudioGraph): si `stop()`
   * corre mientras tanto, nulea `detector` sincrónicamente pero pitch.js sigue
   * abriendo el stream/AudioContext en segundo plano. Guardamos la referencia
   * `d` y, al resolver, comparamos con `detector` (época): si cambió (stop() la
   * canceló, o un nuevo start() ya la reemplazó), llamamos `d.stop()` para
   * liberar lo que acaba de abrirse. Los callbacks (`onPitch`/`onState`) hacen
   * la misma comprobación para no pisar el estado de un detector más nuevo.
   */
  function requestMic() {
    if (detector) return; // ya hay uno en vuelo o corriendo
    const d = createPitchDetector({
      onPitch: (payload) => {
        if (detector !== d) return; // detector obsoleto: ignorar
        onPitch(stabilizer.push(payload));
      },
      onError: (err) => {
        if (detector !== d) return;
        if (onError) onError(err);
        else console.warn('[tuner-engine] mic error:', err);
      },
      onState: (s) => {
        if (detector !== d) return;
        // 'denied'/'stopped' son terminales (permiso rechazado o recover()
        // fallido en background): liberar la época deja que un reintento
        // (requestMic(), p.ej. el boton "Activar microfono") cree un
        // detector nuevo en vez de quedar no-op contra este ya muerto.
        // Diferido a un microtask: pitch.js llama onState('denied') y LUEGO
        // onError(e) en el MISMO tick (ver start() en pitch.js) — nulear
        // aquí synchronamente haría que el guard `detector !== d` de
        // onError trague ese error (detector ya null !== d).
        if (s === 'denied' || s === 'stopped') {
          Promise.resolve().then(() => {
            if (detector === d) detector = null;
          });
        }
        onState(s);
      },
    });
    detector = d;
    Promise.resolve(d.start()).then(() => {
      if (detector !== d) d.stop();
    });
  }

  function start() {
    if (running) return;
    running = true;
    requestMic();
  }

  /** Libera SIEMPRE el detector (mic nunca queda abierto). Idempotente. */
  function stop() {
    running = false;
    if (detector) {
      detector.stop();
      detector = null;
    }
    stabilizer.reset();
    onState('idle');
  }

  return { start, stop, requestMic, isRunning: () => running };
}
