/**
 * avatarCompositor.js
 * Composición de capas LPC sobre un canvas 2D.
 * NO reordena — el llamador entrega las capas ya ordenadas.
 */

/** Orden canónico de capas LPC (solo documentación; composeLayers no reordena). */
export const LPC_LAYER_ORDER = [
  'body',
  'skin',
  'hair',
  'legs', // ropa inferior
  'torso', // ropa superior
  'accessory',
];

/**
 * Dibuja un array de imágenes sobre un canvas en el orden recibido.
 *
 * @param {Array<HTMLImageElement|HTMLCanvasElement|null|undefined>} orderedImages
 *   Capas ya ordenadas. Las entradas falsy se saltan.
 * @param {{ width?: number, height?: number }} [dims]
 *   Dimensiones del canvas. Si se omiten, se toman de la primera imagen no-falsy.
 * @returns {HTMLCanvasElement}
 */
export function composeLayers(orderedImages, { width, height } = {}) {
  // Resolver dimensiones desde la primera imagen no-falsy si no se pasan.
  if (width === undefined || height === undefined) {
    const first = orderedImages.find(Boolean);
    width = first ? first.width : 0;
    height = first ? first.height : 0;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');

  for (const img of orderedImages) {
    if (!img) continue;
    ctx.drawImage(img, 0, 0);
  }

  return canvas;
}
