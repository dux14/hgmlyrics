/**
 * input.js — Lógica pura del input de movimiento del mundo virtual.
 *
 * Combina dos fuentes de input para el avatar local:
 *   - Teclado (WASD + flechas): vector de componentes en {-1, 0, 1}.
 *   - Joystick táctil: vector analógico normalizado (magnitud 0..1).
 *
 * El teclado tiene prioridad: si hay tecla activa, se ignora el joystick (evita
 * conflictos al usar ambos). El joystick aporta movimiento analógico con una
 * deadzone para no derivar por toques accidentales.
 *
 * Convención de ejes: sistema de pantalla (Y crece hacia abajo), igual que el
 * joystick y la física de Phaser en la escena.
 */

const JOYSTICK_DEADZONE = 0.2;

/**
 * Combina el vector de teclado (prioritario) con el del joystick (analógico).
 *
 * @param {{ x: number, y: number }} keyboard  Vector de teclado (componentes -1/0/1).
 * @param {{ x: number, y: number }} joystick   Vector analógico del joystick (mag 0..1).
 * @param {number} [deadzone]  Umbral mínimo de magnitud del joystick.
 * @returns {{ x: number, y: number }}  Vector de input resultante.
 */
export function mergeInputVector(keyboard, joystick, deadzone = JOYSTICK_DEADZONE) {
  if (keyboard.x !== 0 || keyboard.y !== 0) {
    return { x: keyboard.x, y: keyboard.y };
  }
  const mag = Math.hypot(joystick.x, joystick.y);
  if (mag > deadzone) {
    return { x: joystick.x, y: joystick.y };
  }
  return { x: 0, y: 0 };
}

/**
 * Deriva la dirección dominante de un vector de input para la animación.
 * Sin movimiento conserva la última dirección. En empate gana el eje vertical.
 *
 * @param {number} x
 * @param {number} y
 * @param {'up'|'down'|'left'|'right'} lastDir  Dirección previa (fallback).
 * @returns {'up'|'down'|'left'|'right'}
 */
export function deriveDir(x, y, lastDir) {
  if (x === 0 && y === 0) return lastDir;
  if (Math.abs(x) > Math.abs(y)) {
    return x > 0 ? 'right' : 'left';
  }
  return y > 0 ? 'down' : 'up';
}
