/**
 * labelOverlap.js — Anti-colisión medida de etiquetas de acorde/nota.
 *
 * Desde que `.float-label`/`.mix-rail--chord`/`.mix-rail--note` pasaron a
 * `width: 0` (ver "Etiqueta sobre la sílaba sin ensancharla" en
 * src/styles/components.css), el `<i>` interno sobresale a la derecha con su
 * ancho natural SIN reservar espacio en la sílaba. Eso resuelve el problema
 * original (huecos fantasma entre sílabas) pero abre dos casos sin resolver
 * en CSS puro:
 *
 *   (a) dos etiquetas vecinas en la misma fila visual pueden solaparse en
 *       líneas densas (una nota/acorde por sílaba, sílabas cortas).
 *   (b) la última etiqueta de una fila puede sobresalir del contenedor —
 *       en la vista inmersiva el ancestro `.imm-v1__viewport` tiene
 *       `overflow: hidden` y la recorta.
 *
 * Este módulo mide las etiquetas ya pintadas (`getBoundingClientRect`) y
 * aplica el empuje mínimo necesario como `margin-right` en el segmento
 * contenedor (`.line-seg`/`.mix-seg`). No toca el layout de la sílaba: solo
 * empuja lo que viene DESPUÉS del segmento ajustado.
 */

/**
 * Calcula, para una lista de etiquetas de UN mismo carril (ya medidas y en
 * orden visual del DOM), el ajuste mínimo de `margin-right` que necesita el
 * segmento de cada etiqueta para que:
 *
 *   (a) no se solape con la siguiente etiqueta de la MISMA fila visual
 *       (mismo `top` dentro de una tolerancia — dos etiquetas en filas
 *       distintas del wrap nunca compiten por espacio horizontal), y
 *   (b) ninguna etiqueta rebase `boundRight`.
 *
 * Semántica de "empujar": mover el margen del segmento i no mueve la
 * etiqueta i (ya está pintada donde está) — empuja todo lo que el
 * navegador coloque DESPUÉS de ese segmento en el flujo (la siguiente
 * sílaba/etiqueta), forzando el re-wrap si hace falta. Por eso:
 *
 *   - Colisión con el vecino: el ajuste se aplica al segmento i (el de la
 *     IZQUIERDA del par que colisiona), porque es el que puede empujar a
 *     i+1 hacia la derecha (o a la siguiente fila, si ya no cabe).
 *   - Rebase de `boundRight`: si la etiqueta i sola ya se pasa del borde,
 *     el ajuste tiene que ir al segmento ANTERIOR (i-1) — empujando i
 *     hacia abajo/derecha antes de que se pinte. Si i es la primera
 *     etiqueta de la fila (no hay anterior a quien empujar), no hay nada
 *     que hacer: es un límite documentado, no un bug — una sola etiqueta
 *     más ancha que el contenedor no tiene wrap posible sin recortarse a
 *     sí misma, y este módulo no trunca contenido.
 *
 *     OJO: este mecanismo depende de que `.line-word` sea una caja atómica
 *     (ver CSS "Integridad de palabra") — el margin-right en el segmento
 *     ANTERIOR solo corrige el rebase si de verdad fuerza el re-wrap de la
 *     PALABRA del segmento ofensor a la fila siguiente. Si esa palabra
 *     sigue cabiendo en la misma fila pese al empuje (por ejemplo, porque el
 *     margen no alcanza a completar el ancho restante de la fila), la
 *     etiqueta ofensora puede terminar con MÁS overshoot que antes (el
 *     margen movió su posición pero no su fila). Como `resolveLabelOverlaps`
 *     nunca resta márgenes entre pasadas (solo limpia al INICIO de una
 *     resolución completa, no entre la pasada 1 y la 2), ese caso queda sin
 *     corregir por diseño: es preferible un residuo de overshoot a una
 *     oscilación de márgenes que nunca converge. No se trunca contenido en
 *     ningún caso.
 *
 * Los ajustes son ACUMULATIVOS a lo largo de una fila: una cadena de N
 * etiquetas solapadas en cascada resuelve el ajuste de izquierda a
 * derecha, cada uno considerando el desplazamiento ya aplicado a los
 * anteriores (el rect original no cambia, pero el `right` efectivo sí).
 *
 * @param {Array<{left:number, right:number, top:number}>} items rects de
 *   los labels en orden visual del DOM (izquierda a derecha, arriba a
 *   abajo si hay wrap).
 * @param {number} gapPx separación mínima deseada entre dos labels vecinos.
 * @param {number} boundRight borde derecho del contenedor (`Infinity` si no
 *   aplica límite de borde).
 * @returns {number[]} ajuste en px por índice (mismo orden que `items`),
 *   pensado para aplicarse como `margin-right` al segmento del label.
 */
export function computeOverlapAdjustments(items, gapPx, boundRight) {
  const n = items.length;
  const adjust = new Array(n).fill(0);
  if (n === 0) return adjust;

  // Tolerancia de fila: dos labels se consideran en la MISMA fila visual si
  // sus `top` difieren menos que la mitad de la altura típica de un label
  // (aprox. usando la altura del propio item si viene en el rect; si no,
  // una tolerancia fija generosa basada en la separación típica de líneas
  // de letra). Aquí no tenemos `height` en el contrato de entrada, así que
  // usamos un umbral fijo conservador en px: dos tops a menos de 4px se
  // tratan como la misma fila (los rects de una misma fila real caen casi
  // exactos; un salto de línea real mueve el top varias veces ese margen).
  const ROW_TOLERANCE_PX = 4;

  // `effectiveRight[i]` = right original + suma de ajustes ya decididos que
  // recaen a la izquierda de i y lo empujan (el margin-right de un segmento
  // anterior en la MISMA fila desplaza a todo lo que sigue en el flujo,
  // incluida la etiqueta i).
  const effectiveRight = items.map((it) => it.right);
  const effectiveLeft = items.map((it) => it.left);

  for (let i = 0; i < n; i++) {
    const cur = items[i];

    // (b) Rebase de borde derecho: si la etiqueta i (ya con los empujes
    // heredados) se pasa de `boundRight`, el ajuste va al segmento ANTERIOR
    // en la misma fila (empuja a i hacia la fila siguiente antes de que se
    // pinte). Si no hay anterior en la misma fila, es el límite documentado:
    // no hay a quién empujar, se deja como está.
    if (Number.isFinite(boundRight) && effectiveRight[i] > boundRight) {
      const overshoot = effectiveRight[i] - boundRight;
      const prev = i - 1;
      const sameRow = prev >= 0 && Math.abs(items[prev].top - cur.top) <= ROW_TOLERANCE_PX;
      if (sameRow) {
        adjust[prev] += overshoot;
        // Propaga el empuje a las etiquetas i..n-1 que dependían de la
        // posición de `prev` en el flujo (todas en la misma fila lógica).
        for (let k = prev + 1; k < n; k++) {
          if (Math.abs(items[k].top - items[prev].top) > ROW_TOLERANCE_PX) break;
          effectiveLeft[k] += overshoot;
          effectiveRight[k] += overshoot;
        }
      }
      // Si no hay anterior en la misma fila: límite documentado, sin ajuste.
    }

    // (a) Colisión con el vecino siguiente en la misma fila.
    const next = i + 1;
    if (next < n) {
      const sameRow = Math.abs(items[next].top - cur.top) <= ROW_TOLERANCE_PX;
      if (sameRow) {
        const needed = effectiveRight[i] + gapPx - effectiveLeft[next];
        if (needed > 0) {
          adjust[i] += needed;
          // El empuje de i corre a next y a toda la cadena de la misma fila
          // que venga después, para que la próxima iteración vea la
          // posición ya desplazada (cascada de solapados).
          for (let k = next; k < n; k++) {
            if (Math.abs(items[k].top - items[next].top) > ROW_TOLERANCE_PX) break;
            effectiveLeft[k] += needed;
            effectiveRight[k] += needed;
          }
        }
      }
    }
  }

  return adjust;
}

/** Selector de líneas que usan el modelo de etiquetas medido (Acordes/Tono/Mix). */
const LINE_SELECTOR = '.lyrics__line--chords, .lyrics__line--tono, .lyrics__line--mix';

/**
 * Agrupa, dentro de una línea, los labels por carril independiente:
 * en modo mixto el riel de acordes y el de notas NUNCA compiten entre sí
 * (un acorde no colisiona con una nota, viven en filas distintas del mismo
 * segmento); en chords/tono-solo hay un único carril de `.float-label`.
 *
 * @param {HTMLElement} lineEl
 * @returns {Array<{segEl: HTMLElement, labelI: HTMLElement}[]>} un array por
 *   carril, cada uno con los pares segmento+`<i>` en orden visual del DOM.
 */
function collectRails(lineEl) {
  if (lineEl.classList.contains('lyrics__line--mix')) {
    const chordRail = [];
    const noteRail = [];
    lineEl.querySelectorAll('.mix-seg').forEach((segEl) => {
      const chordI = segEl.querySelector('.mix-rail--chord i');
      if (chordI) chordRail.push({ segEl, labelI: chordI });
      const noteI = segEl.querySelector('.mix-rail--note i');
      if (noteI) noteRail.push({ segEl, labelI: noteI });
    });
    return [chordRail, noteRail].filter((rail) => rail.length > 0);
  }
  const rail = [];
  lineEl.querySelectorAll('.line-seg').forEach((segEl) => {
    const i = segEl.querySelector('.float-label i');
    if (i) rail.push({ segEl, labelI: i });
  });
  return rail.length > 0 ? [rail] : [];
}

/**
 * Quita los ajustes de una pasada previa (limpieza antes de volver a medir:
 * si no se limpia, el margen aplicado en la pasada anterior contamina la
 * medición de la nueva).
 * @param {HTMLElement} rootEl
 */
function clearPreviousAdjustments(rootEl) {
  rootEl.querySelectorAll('[data-overlap-fix]').forEach((el) => {
    el.style.marginRight = '';
    el.removeAttribute('data-overlap-fix');
  });
}

/**
 * Recorre las líneas de acordes/tono/mixto dentro de `rootEl`, mide sus
 * etiquetas y aplica el empuje mínimo para que no se solapen ni rebasen el
 * borde de la línea. Dos fases sin intercalar (lectura completa primero,
 * escritura después) para evitar layout thrashing; una segunda pasada
 * repite lectura+escritura porque el nuevo margin-right puede cambiar el
 * wrap de la línea (máximo 2 pasadas en total).
 *
 * @param {HTMLElement} rootEl contenedor que envuelve una o más líneas.
 */
export function resolveLabelOverlaps(rootEl) {
  if (!rootEl) return;

  clearPreviousAdjustments(rootEl);
  runPass(rootEl);
  // Segunda pasada: el margin-right aplicado en la primera puede haber
  // cambiado el wrap (una etiqueta que antes sobresalía del borde ahora cae
  // en la fila siguiente), así que se vuelve a medir sobre el DOM ya
  // ajustado. No se limpia entre pasadas: la segunda pasada corrige sobre
  // lo ya aplicado, no repite desde cero.
  runPass(rootEl);
}

/** Ejecuta una pasada completa de lectura+escritura sobre todas las líneas de `rootEl`. */
function runPass(rootEl) {
  const lineEls = rootEl.querySelectorAll(LINE_SELECTOR);
  if (lineEls.length === 0) return;

  // Fase de lectura: todas las mediciones antes de tocar el DOM.
  const writes = []; // { segEl, adjustPx }
  lineEls.forEach((lineEl) => {
    const lineRect = lineEl.getBoundingClientRect();
    const rails = collectRails(lineEl);
    rails.forEach((rail) => {
      const items = rail.map(({ labelI }) => {
        const r = labelI.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top };
      });
      if (items.length === 0) return;
      const fontSizePx = parseFloat(getComputedStyle(rail[0].labelI).fontSize) || 16;
      const gapPx = fontSizePx * 0.35;
      const adjustments = computeOverlapAdjustments(items, gapPx, lineRect.right);
      rail.forEach(({ segEl }, i) => {
        if (adjustments[i] > 0) writes.push({ segEl, adjustPx: adjustments[i] });
      });
    });
  });

  // Fase de escritura: se aplican todos los ajustes calculados.
  writes.forEach(({ segEl, adjustPx }) => {
    segEl.style.marginRight = `${adjustPx}px`;
    segEl.setAttribute('data-overlap-fix', '1');
  });
}

/**
 * Engancha la resolución de colisiones a un contenedor vivo: corre una vez
 * de inmediato, se reejecuta cuando cargan las fuentes (el ancho real de
 * los labels solo se conoce con la fuente ya aplicada) y ante cambios de
 * tamaño del contenedor (resize de ventana, cambio de layout), con
 * debounce vía `requestAnimationFrame` para no medir en cada micro-cambio.
 *
 * Degrada sin romper si `ResizeObserver` no existe (jsdom en tests).
 *
 * @param {HTMLElement} rootEl
 * @returns {() => void} `disconnect()` — corta el observer y cancela un rAF pendiente.
 */
export function observeLabelOverlaps(rootEl) {
  if (!rootEl) return () => {};

  let rafId = null;
  const scheduleRun = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      resolveLabelOverlaps(rootEl);
    });
  };

  scheduleRun();

  let fontsReadyCancelled = false;
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (!fontsReadyCancelled) scheduleRun();
    });
  }

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => scheduleRun());
    ro.observe(rootEl);
  }

  return function disconnect() {
    fontsReadyCancelled = true;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    ro?.disconnect();
  };
}
