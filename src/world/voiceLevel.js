/**
 * voiceLevel.js — Umbral e indicador de "hablando" para audio local y remoto.
 *
 * Funciones puras y testeables. No dependen de WebAudio ni de DOM.
 *
 * Diseño:
 *   - isSpeaking(rmsLevel, threshold) → boolean simple, sin estado.
 *   - makeSpeakingSmoother({ threshold, attack, release }) → función con estado que
 *     evita parpadeo: usa histeresis (umbral alto para activar, bajo para desactivar)
 *     y contadores de muestras (attack/release) antes de cambiar de estado.
 *
 * Histeresis:
 *   - Para ACTIVAR: rms > threshold
 *   - Para DESACTIVAR: rms > threshold * HYSTERESIS_RATIO  (umbral más bajo)
 *
 * El par attack/release cuenta cuántas muestras consecutivas deben superar o caer
 * por debajo del umbral correspondiente antes de cambiar el estado de salida.
 * Esto evita que un solo fotograma ruidoso o silencioso cambie el indicador.
 */

/** Razón de histeresis para el umbral de desactivación. */
const HYSTERESIS_RATIO = 0.6;

/**
 * Retorna true si el nivel RMS supera el umbral dado.
 * Función pura, sin estado.
 *
 * @param {number} rmsLevel  — nivel RMS en el rango [0, 1]
 * @param {number} threshold — umbral de activación en el rango [0, 1]
 * @returns {boolean}
 */
export function isSpeaking(rmsLevel, threshold) {
  return rmsLevel > threshold;
}

/**
 * Crea una función de suavizado con histeresis y contadores attack/release.
 *
 * @param {{
 *   threshold: number,  — umbral de activación [0, 1]
 *   attack:    number,  — muestras consecutivas activas requeridas para activar (≥1)
 *   release:   number,  — muestras consecutivas inactivas requeridas para desactivar (≥1)
 * }} opts
 *
 * @returns {(rmsLevel: number) => boolean} — función con estado; devuelve el estado suavizado
 */
export function makeSpeakingSmoother({ threshold, attack, release }) {
  /** Estado de salida actual: false = silencio, true = hablando. */
  let speaking = false;
  /** Contador de muestras consecutivas en la dirección de ataque. */
  let attackCount = 0;
  /** Contador de muestras consecutivas en la dirección de silencio. */
  let releaseCount = 0;

  // Umbral de desactivación (histeresis): más bajo que el de activación.
  const releaseThreshold = threshold * HYSTERESIS_RATIO;

  /**
   * Procesa una nueva muestra de RMS y retorna el estado suavizado.
   * @param {number} rmsLevel
   * @returns {boolean}
   */
  return function smooth(rmsLevel) {
    if (!speaking) {
      // Estamos en silencio: verificar si debemos activar
      if (rmsLevel > threshold) {
        attackCount++;
        releaseCount = 0;
        if (attackCount >= attack) {
          speaking = true;
          attackCount = 0;
        }
      } else {
        attackCount = 0;
        releaseCount = 0;
      }
    } else {
      // Estamos hablando: verificar si debemos desactivar
      if (rmsLevel <= releaseThreshold) {
        releaseCount++;
        attackCount = 0;
        if (releaseCount >= release) {
          speaking = false;
          releaseCount = 0;
        }
      } else {
        releaseCount = 0;
        attackCount = 0;
      }
    }

    return speaking;
  };
}

/**
 * Calcula el nivel RMS a partir de un Uint8Array de datos del AnalyserNode
 * (getByteTimeDomainData). Retorna un valor en [0, 1].
 *
 * Esta función es pura y testeable; el caller obtiene los datos del AnalyserNode
 * y los pasa aquí para separar la lógica de computo del API de WebAudio.
 *
 * @param {Uint8Array} timeDomainData — datos crudos del AnalyserNode [0, 255], 128=silencio
 * @returns {number} — RMS en [0, 1]
 */
export function computeRms(timeDomainData) {
  if (!timeDomainData || timeDomainData.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < timeDomainData.length; i++) {
    // Normalizar: 128 es el centro (silencio), rango [-1, 1]
    const sample = (timeDomainData[i] - 128) / 128;
    sumSq += sample * sample;
  }
  return Math.sqrt(sumSq / timeDomainData.length);
}
