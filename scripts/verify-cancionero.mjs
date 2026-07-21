// scripts/verify-cancionero.mjs
// Task A7: verificación de cierre de la letra canónica (`song_lyrics_canonical`),
// a correr DESPUÉS del `--commit` de la ingesta del cancionero (Task A6,
// scripts/ingest-cancionero.mjs). Script READ-ONLY: solo hace SELECTs, no
// escribe en la DB ni llama a ninguna API externa. Emite un reporte por
// stdout con cobertura, validez de shape y sanity de cantidad de líneas.
//
// Uso:
//   node scripts/verify-cancionero.mjs
//
// Requiere env: DATABASE_URL.
//
// Exit code: 0 si no hay filas malformadas en song_lyrics_canonical,
// 1 si hay al menos una (para uso en verificación/CI manual).
import postgres from 'postgres';
import {
  validateCanonicalContent,
  coverageReport,
  lineCountMismatch,
  projectSongLines,
} from './_verifyLib.mjs';

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Falta DATABASE_URL.');
  }
}

async function fetchData(sql) {
  const songs = await sql`SELECT id, title, sections FROM songs`;
  const canonicalRows = await sql`SELECT song_id, content FROM song_lyrics_canonical`;
  return { songs, canonicalRows };
}

async function run() {
  requireDatabaseUrl();
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', prepare: false, max: 1 });
  let songs, canonicalRows;
  try {
    ({ songs, canonicalRows } = await fetchData(sql));
  } finally {
    await sql.end();
  }

  const songsById = new Map(songs.map((s) => [s.id, s]));
  const canonicalBySongId = new Map(canonicalRows.map((r) => [r.song_id, r]));

  // 1. Cobertura.
  const { covered, missing, pct } = coverageReport(songs.length, canonicalRows.length);
  const songsSinLetra = songs.filter((s) => !canonicalBySongId.has(s.id));

  console.log('== Cobertura de letra canónica ==');
  console.log(`Total canciones: ${songs.length}`);
  console.log(`Con letra canónica: ${covered} (${pct.toFixed(1)}%)`);
  console.log(`Sin letra canónica: ${missing}`);
  if (songsSinLetra.length > 0) {
    console.log('Canciones sin letra canónica:');
    for (const s of songsSinLetra) {
      console.log(`  - ${s.id} ("${s.title}")`);
    }
  }
  console.log('');

  // 2. Validez de shape + 3. Sanity de cantidad de líneas.
  console.log('== Validez de shape + sanity de líneas ==');
  let malformedCount = 0;
  let revisarCount = 0;
  let okCount = 0;

  for (const row of canonicalRows) {
    const song = songsById.get(row.song_id);
    const titulo = song?.title ?? '(canción no encontrada en songs)';
    const { ok, sectionCount, lineCount, problems } = validateCanonicalContent(row.content);

    if (!ok) {
      malformedCount += 1;
      console.log(`MALFORMADA: ${row.song_id} ("${titulo}")`);
      for (const p of problems) console.log(`    - ${p}`);
      continue;
    }

    const dbLines = projectSongLines(song?.sections);
    const { flag, ratio } = lineCountMismatch(lineCount, dbLines.length);
    if (flag) {
      revisarCount += 1;
      console.log(
        `REVISAR: ${row.song_id} ("${titulo}") -- ${sectionCount} secciones, ${lineCount} líneas ` +
          `canónicas vs ${dbLines.length} líneas en songs.sections (diferencia ${(ratio * 100).toFixed(0)}%).`,
      );
    } else {
      okCount += 1;
    }
  }
  console.log('');

  // 4. Resumen final.
  console.log('== Resumen ==');
  console.log(`OK: ${okCount}`);
  console.log(`Sin letra canónica: ${missing}`);
  console.log(`Malformadas: ${malformedCount}`);
  console.log(`A revisar (desajuste de líneas): ${revisarCount}`);

  if (malformedCount > 0) {
    console.log('');
    console.log(`FALLO: hay ${malformedCount} fila(s) malformada(s) en song_lyrics_canonical.`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  run().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

export { fetchData, run };
