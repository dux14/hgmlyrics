import sharp from 'sharp';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dominantColors } from '../src/lib/pastelColor.js';

const COVERS_DIR = 'public/covers';
const OUT = 'public/cover-colors.json';

// Reexport: el test del script importa dominantColors desde aquí.
export { dominantColors };

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
