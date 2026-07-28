#!/usr/bin/env node
/**
 * backfill-avatars.mjs — Recomprime avatares viejos ya subidos al bucket
 * 'avatars' de Storage, antes del fix de compresión del 28-jul (701a12a).
 *
 * El fix de compresión solo corrió hacia adelante: los avatares subidos
 * antes de esa fecha pueden seguir a ~12MP / ~1.6MB, y cada transformación
 * en frío (avatarThumb, src/lib/avatarUrl.js) tiene que decodificar ese
 * original completo.
 *
 * Este script lista los objetos del bucket, redimensiona a máx. 512px por
 * lado con sharp los que superan un umbral de tamaño, y los re-sube CON LA
 * MISMA KEY (mismo path `${userId}/avatar.${ext}`, upsert:true). La key no
 * cambia, así que la URL persistida en profiles.avatar_url (que incluye el
 * cache-buster `?t=`) sigue siendo válida sin tocar la tabla profiles.
 *
 * Modo dry-run por defecto: solo imprime qué haría. Para escribir de
 * verdad hay que pasar --apply explícitamente.
 *
 * Usage:
 *   node scripts/backfill-avatars.mjs              # dry-run (no escribe nada)
 *   node scripts/backfill-avatars.mjs --apply       # aplica los cambios
 *
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en .env (o .env.local).
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dotenv no es dependencia del repo (no está en package.json); se parsea
// `.env` a mano, mismo patrón que mint_token.mjs en la raíz del repo. No
// pisa variables ya presentes en el entorno (p.ej. si se exportaron a mano).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_PATH)) {
  const envText = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const BUCKET = 'avatars';
const SIZE_THRESHOLD = 300 * 1024; // 300KB: por debajo de esto no vale la pena tocar
const MAX_DIMENSION = 512;
const CACHE_CONTROL = '31536000'; // 1 año, mismo valor que uploadAvatar() (storage.js)

const APPLY = process.argv.includes('--apply');

function fmtKB(n) {
  return (n / 1024).toFixed(1).padStart(8);
}

/**
 * Lista TODOS los objetos del bucket avatars recorriendo cada subcarpeta
 * `${userId}/`. El bucket no tiene un list() plano de todo el árbol: hay que
 * listar la raíz (carpetas = un nivel por usuario) y después cada carpeta.
 */
async function listAllAvatars() {
  const { data: userDirs, error } = await sb.storage.from(BUCKET).list('', { limit: 10000 });
  if (error) throw error;

  const objects = [];
  for (const dir of userDirs) {
    // list() en la raíz devuelve tanto carpetas como archivos sueltos (no
    // debería haber archivos sueltos en este bucket, pero por las dudas se
    // filtra por id null, que es como el SDK marca las "carpetas").
    if (dir.id !== null) continue;
    const { data: files, error: filesErr } = await sb.storage.from(BUCKET).list(dir.name, {
      limit: 100,
    });
    if (filesErr) {
      console.error(`  ! No se pudo listar ${dir.name}/: ${filesErr.message}`);
      continue;
    }
    for (const f of files) {
      objects.push({ key: `${dir.name}/${f.name}`, size: f.metadata?.size ?? 0 });
    }
  }
  return objects;
}

async function main() {
  console.log(`Modo: ${APPLY ? 'APLICAR (escribe en Storage)' : 'DRY-RUN (no escribe nada)'}`);
  console.log(`Umbral: recomprimir objetos > ${fmtKB(SIZE_THRESHOLD)} KB a máx. ${MAX_DIMENSION}px\n`);

  const objects = await listAllAvatars();
  console.log(`Encontrados ${objects.length} avatares en el bucket '${BUCKET}'.\n`);

  const toProcess = objects.filter((o) => o.size > SIZE_THRESHOLD);
  console.log(`${toProcess.length} superan el umbral y se recomprimirían.\n`);

  let totalBefore = 0;
  let totalAfter = 0;
  let processed = 0;
  let failed = 0;

  for (const obj of toProcess) {
    totalBefore += obj.size;

    try {
      const { data: blob, error: downloadErr } = await sb.storage.from(BUCKET).download(obj.key);
      if (downloadErr) throw downloadErr;

      const input = Buffer.from(await blob.arrayBuffer());
      const meta = await sharp(input).metadata();

      const resized = await sharp(input)
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .toBuffer();

      const after = resized.length;
      totalAfter += Math.min(after, obj.size);

      const savedPct = (((obj.size - after) / obj.size) * 100).toFixed(0).padStart(3);
      console.log(
        `  ${obj.key.padEnd(48)} ${meta.width}x${meta.height}  ${fmtKB(obj.size)} -> ${fmtKB(after)} KB  ${savedPct}%`,
      );

      if (APPLY) {
        const { error: uploadErr } = await sb.storage.from(BUCKET).upload(obj.key, resized, {
          contentType: blob.type || 'image/webp',
          upsert: true,
          cacheControl: CACHE_CONTROL,
        });
        if (uploadErr) throw uploadErr;
      }
      processed++;
    } catch (e) {
      failed++;
      console.error(`  ! Falló ${obj.key}: ${e.message || e}`);
      // No suma a totalAfter: se cuenta como si no se hubiera tocado.
      totalAfter += obj.size;
    }
  }

  const totalSaved = totalBefore - totalAfter;
  const totalPct = totalBefore > 0 ? ((totalSaved / totalBefore) * 100).toFixed(1) : '0.0';
  console.log(`\nTotal: ${fmtKB(totalBefore)} -> ${fmtKB(totalAfter)} KB (ahorro ${fmtKB(totalSaved)} KB, ${totalPct}%)`);
  console.log(`Procesados: ${processed}  Fallidos: ${failed}`);

  if (!APPLY) {
    console.log('\nDRY-RUN: no se escribió nada. Repetir con --apply para aplicar los cambios.');
  } else {
    console.log('\nAplicado: los objetos se re-subieron con la MISMA key (upsert), la URL en profiles.avatar_url no cambia.');
  }
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
