// scripts/ingest-cancionero.mjs
// Task A6: ingesta del cancionero PDF ("Cancionero + Acordes 2026.pdf") a
// letra canónica (`song_lyrics_canonical`), vía Claude con output
// estructurado. Script one-off repetible, NO forma parte del pipeline en
// runtime.
//
// Uso:
//   node scripts/ingest-cancionero.mjs            dry-run: extrae con Claude,
//                                                  escribe scripts/cancionero-extracted.json
//                                                  y NO toca la DB.
//   (revisar scripts/cancionero-extracted.json a mano -- esa revisión humana
//   ES el paso de validación antes de escribir en producción)
//   node scripts/ingest-cancionero.mjs --commit    lee el JSON revisado y
//                                                  hace upsert por cancion
//                                                  matcheada.
//
// Requiere env: ANTHROPIC_API_KEY (la provee Samu) y DATABASE_URL (dry-run
// no necesita DATABASE_URL, solo --commit).
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import postgres from 'postgres';
import {
  EXTRACTION_SCHEMA,
  EXTRACTION_PROMPT,
  parseExtraction,
  matchSongs,
  buildUpserts,
} from './_ingestLib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH = path.join(__dirname, '..', 'Cancionero + Acordes 2026.pdf');
const OUTPUT_PATH = path.join(__dirname, 'cancionero-extracted.json');
const SOURCE_LABEL = 'cancionero-2026-pdf';

async function extractWithClaude() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Falta ANTHROPIC_API_KEY. La provee Samu.');
  }
  if (!existsSync(PDF_PATH)) {
    throw new Error(`No se encontro el PDF en ${PDF_PATH}.`);
  }
  const pdfBase64 = (await readFile(PDF_PATH)).toString('base64');
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: 'claude-sonnet-5',
    max_tokens: 64000,
    output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'max_tokens') {
    console.warn(
      'AVISO: la respuesta se trunco por max_tokens. El cancionero puede exceder ' +
        '64000 tokens de output -- si pasa, hay que chunkear la extracción por rangos ' +
        'de páginas (no implementado en esta version simple).',
    );
  }
  const textBlock = msg.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Respuesta de Claude sin bloque de texto.');
  return parseExtraction(textBlock.text);
}

async function fetchSongsFromDb(sql) {
  return sql`SELECT id, title FROM songs`;
}

async function runDryRun() {
  const canciones = await extractWithClaude();
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', prepare: false, max: 1 });
  let songsFromDb;
  try {
    songsFromDb = await fetchSongsFromDb(sql);
  } finally {
    await sql.end();
  }
  const { linked, unlinked } = matchSongs(canciones, songsFromDb);
  await writeFile(
    OUTPUT_PATH,
    JSON.stringify({ linked, unlinked: unlinked.map((u) => u.cancion) }, null, 2),
  );
  console.log(`[dry-run] ${canciones.length} canciones extraídas del PDF.`);
  console.log(`[dry-run] ${linked.length} matchearon a un song_id existente:`);
  for (const { cancion, songId, score } of linked) {
    console.log(`  - "${cancion.titulo}" -> ${songId} (score ${score.toFixed(2)})`);
  }
  console.log(`[dry-run] ${unlinked.length} SIN match confiable (revisar a mano):`);
  for (const { cancion, bestScore } of unlinked) {
    console.log(`  - "${cancion.titulo}" (mejor score ${bestScore.toFixed(2)})`);
  }
  console.log(`[dry-run] resultado completo en ${OUTPUT_PATH}. Revisar antes de --commit.`);
}

async function runCommit() {
  if (!existsSync(OUTPUT_PATH)) {
    throw new Error(
      `No existe ${OUTPUT_PATH}. Corre primero el dry-run y revisa el JSON antes de --commit.`,
    );
  }
  const { linked } = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
  if (!Array.isArray(linked) || linked.length === 0) {
    console.log('Nada para commitear: "linked" vacío en scripts/cancionero-extracted.json.');
    return;
  }
  const upserts = buildUpserts(linked);
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', prepare: false, max: 1 });
  try {
    for (const { songId, content } of upserts) {
      await sql`
        INSERT INTO song_lyrics_canonical (song_id, source, content)
        VALUES (${songId}, ${SOURCE_LABEL}, ${sql.json(content)})
        ON CONFLICT (song_id) DO UPDATE SET content = EXCLUDED.content, source = EXCLUDED.source
      `;
      console.log(`commiteado ${songId} ("${content.titulo}")`);
    }
  } finally {
    await sql.end();
  }
  console.log(`${upserts.length} canciones commiteadas en song_lyrics_canonical.`);
}

const isMain = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '');
if (isMain) {
  const commit = process.argv.includes('--commit');
  (commit ? runCommit() : runDryRun()).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

export { extractWithClaude, fetchSongsFromDb, runDryRun, runCommit };
