/**
 * Joystick.js — Control táctil virtual para el mundo virtual.
 *
 * Exporta:
 *   - computeVector(dx, dy, radius) → { x, y }  (función pura, testeable)
 *   - Joystick({ onChange, radius })             → { el, destroy }
 *
 * Coordenadas: sistema de pantalla (Y crece hacia abajo). La escena Phaser
 * decide cómo interpretar el eje Y del vector resultante.
 */

/**
 * Calcula el vector de dirección normalizado a partir del desplazamiento del thumb.
 *
 * - Divide dx y dy por `radius` para obtener un vector en [-1, 1] por componente.
 * - Si la magnitud resultante supera 1 (thumb fuera del radio), normaliza al
 *   círculo unitario (magnitud = 1) preservando la dirección.
 * - El eje Y NO se invierte: dy positivo (hacia abajo en pantalla) → y positivo.
 *
 * @param {number} dx  Desplazamiento horizontal del thumb respecto al centro (px).
 * @param {number} dy  Desplazamiento vertical del thumb respecto al centro (px).
 * @param {number} radius  Radio máximo del joystick (px).
 * @returns {{ x: number, y: number }}  Vector normalizado; componentes en [-1, 1].
 */
export function computeVector(dx, dy, radius) {
  const x = dx / radius;
  const y = dy / radius;
  const mag = Math.hypot(x, y);
  if (mag <= 1) return { x, y };
  // Clampear al círculo unitario
  return { x: x / mag, y: y / mag };
}

/**
 * Crea el componente de joystick táctil.
 *
 * @param {{ onChange: (v: {x:number,y:number}) => void, radius?: number }} opts
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function Joystick({ onChange, radius = 60 }) {
  const size = radius * 2;
  const thumbSize = radius * 0.6;

  // Contenedor exterior — tamaño dinámico (radio como parámetro)
  const el = document.createElement('div');
  el.className = 'joy-pad';
  el.style.width = size + 'px';
  el.style.height = size + 'px';

  // Base circular
  const base = document.createElement('div');
  base.setAttribute('data-joystick-base', '');
  base.className = 'joy-base';
  el.appendChild(base);

  // Thumb (el palo del joystick) — posición dinámica (calculada de radius)
  const thumb = document.createElement('div');
  thumb.setAttribute('data-joystick-thumb', '');
  thumb.className = 'joy-thumb';
  thumb.style.width = thumbSize + 'px';
  thumb.style.height = thumbSize + 'px';
  thumb.style.top = (radius - thumbSize / 2) + 'px';
  thumb.style.left = (radius - thumbSize / 2) + 'px';
  base.appendChild(thumb);

  let active = false;
  let originX = 0;
  let originY = 0;

  function onPointerDown(e) {
    active = true;
    if (base.setPointerCapture) base.setPointerCapture(e.pointerId);
    const rect = base.getBoundingClientRect();
    originX = rect.left + rect.width / 2;
    originY = rect.top + rect.height / 2;
    moveThumb(e.clientX, e.clientY);
  }

  function onPointerMove(e) {
    if (!active) return;
    moveThumb(e.clientX, e.clientY);
  }

  function onPointerUp() {
    if (!active) return;
    active = false;
    resetThumb();
    onChange({ x: 0, y: 0 });
  }

  function moveThumb(clientX, clientY) {
    const dx = clientX - originX;
    const dy = clientY - originY;
    const v = computeVector(dx, dy, radius);
    // Clampear la posición visual del thumb al radio
    const mag = Math.hypot(dx, dy);
    const clampedDx = mag > radius ? (dx / mag) * radius : dx;
    const clampedDy = mag > radius ? (dy / mag) * radius : dy;
    thumb.style.transform = `translate(${clampedDx}px, ${clampedDy}px)`;
    onChange(v);
  }

  function resetThumb() {
    thumb.style.transform = '';
  }

  base.addEventListener('pointerdown', onPointerDown);
  base.addEventListener('pointermove', onPointerMove);
  // pointerup en window para capturar sueltas fuera del base
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  function destroy() {
    base.removeEventListener('pointerdown', onPointerDown);
    base.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  }

  return { el, destroy };
}
