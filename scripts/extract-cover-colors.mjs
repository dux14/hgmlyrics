import sharp from 'sharp';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const COVERS_DIR = 'public/covers';
const OUT = 'public/cover-colors.json';

function rgbToHsl(r, g, b) {
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
function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Promedia los pixeles, oscurece para que el texto blanco lea; devuelve {base, light}. */
export async function dominantColors(rawRGB, width, height) {
  let r = 0, g = 0, b = 0;
  const n = width * height;
  for (let i = 0; i < rawRGB.length; i += 3) {
    r += rawRGB[i]; g += rawRGB[i + 1]; b += rawRGB[i + 2];
  }
  r = r / n; g = g / n; b = b / n;
  let [h, s, l] = rgbToHsl(r, g, b);
  l = Math.min(l, 0.46); s = Math.min(1, s * 1.15 + 0.05);
  return { base: hslToHex(h, s, l), light: hslToHex(h, Math.min(0.6, l + 0.16), s) };
}

async function main() {
  const files = (await readdir(COVERS_DIR)).filter((f) => f.endsWith('.webp'));
  const out = {};
  for (const file of files) {
    const { data, info } = await sharp(join(COVERS_DIR, file))
      .resize(32, 32, { fit: 'cover' })
      .raw().toBuffer({ resolveWithObject: true });
    // raw puede traer 3 (RGB) o 4 (RGBA) canales; compactar a RGB
    const ch = info.channels;
    const rgb = ch === 3 ? data : Buffer.from(
      Array.from({ length: 32 * 32 * 3 }, (_, i) => data[Math.floor(i / 3) * ch + (i % 3)])
    );
    out[file] = await dominantColors(rgb, 32, 32);
  }
  await writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`cover-colors.json: ${Object.keys(out).length} portadas`);
}

// ejecutar solo si se invoca directamente
if (import.meta.url === `file://${process.argv[1]}`) main();
