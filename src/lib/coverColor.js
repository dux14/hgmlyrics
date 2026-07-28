/**
 * coverColor.js — extrae el par pastel {base, light} de una portada ya cargada,
 * usando canvas + la misma matemática que el precómputo. Para portadas remotas
 * (Storage) que no están en cover-colors.json. Requiere que la imagen se haya
 * cargado con CORS (crossOrigin='anonymous'); si el canvas queda contaminado o
 * el navegador no soporta canvas, devuelve null y el tile conserva su fallback.
 * @param {HTMLImageElement} img - imagen cargada
 * @returns {{base:string, light:string}|null}
 */
import { dominantColors } from './pastelColor.js';

export function extractCoverColor(img) {
  try {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size); // RGBA
    // Compactar RGBA → RGB (dominantColors espera 3 canales por pixel).
    const rgb = new Uint8ClampedArray(size * size * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
    }
    return dominantColors(rgb, size, size);
  } catch (_e) {
    return null;
  }
}
