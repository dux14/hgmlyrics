/**
 * pastelColor.js — matemática pura de color pastel para tiles (sin DOM ni sharp).
 * Fuente única compartida por el script de precómputo (scripts/extract-cover-colors.mjs)
 * y la extracción en cliente (src/lib/coverColor.js), para que las portadas locales
 * (JSON precomputado) y las remotas (Storage, extraídas al vuelo) se vean idénticas.
 */

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

export function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Promedia los pixeles (RGB compacto) y devuelve un par pastel {base, light}:
 * desatura (cap ~0.40) y lleva la luminancia a banda media-clara para que el
 * texto blanco de la placa lea sobre cualquier portada.
 * @param {ArrayLike<number>} rawRGB - buffer RGB (3 canales por pixel)
 * @param {number} width
 * @param {number} height
 * @returns {{base:string, light:string}}
 */
export function dominantColors(rawRGB, width, height) {
  let r = 0, g = 0, b = 0;
  const n = width * height;
  for (let i = 0; i < rawRGB.length; i += 3) {
    r += rawRGB[i]; g += rawRGB[i + 1]; b += rawRGB[i + 2];
  }
  r = r / n; g = g / n; b = b / n;
  const [h, s0, l0] = rgbToHsl(r, g, b);
  const s = Math.min(0.40, s0 * 0.6);
  const l = Math.max(0.52, Math.min(0.68, l0 * 0.6 + 0.42));
  const lightL = Math.min(0.78, l + 0.10);
  return { base: hslToHex(h, s, l), light: hslToHex(h, s, lightL) };
}
