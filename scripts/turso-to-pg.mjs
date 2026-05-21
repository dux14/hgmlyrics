#!/usr/bin/env node
// Phase 2: copy all rows from Turso songs → Supabase Postgres songs.
//
// Required env (load via `set -a; source ~/.cache/hgmlyrics-migration-secrets.env; set +a`
// before invoking, then also export TURSO_DATABASE_URL and TURSO_AUTH_TOKEN
// from server/.env or render env):
//   DATABASE_URL          postgresql://postgres.<ref>:<pw>@aws-1-us-west-2.pooler.supabase.com:6543/postgres
//   TURSO_DATABASE_URL    libsql://hgmlyrics-dux14.aws-us-east-2.turso.io
//   TURSO_AUTH_TOKEN      (from `turso db tokens create hgmlyrics`)
//
// Flags:
//   --dry-run   read from Turso, build payload, print summary, do NOT write to PG
//   --force     allow run when target songs table already has rows (deletes them first)

import postgres from 'postgres';
import { createClient } from '@libsql/client';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FORCE = args.has('--force');

const required = ['DATABASE_URL', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env: ${missing.join(', ')}`);
  process.exit(1);
}

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  max: 1, // single connection, single transaction
  prepare: false, // pooler at port 6543 requires this
});

function mapRow(r) {
  // Turso camelCase -> PG snake_case, parse sections JSON, defensive defaults.
  let sections;
  try {
    sections = r.sections ? JSON.parse(r.sections) : [];
  } catch (e) {
    throw new Error(`Row id=${r.id}: invalid sections JSON: ${e.message}`);
  }
  if (!Array.isArray(sections)) {
    throw new Error(`Row id=${r.id}: sections is not an array after parse`);
  }
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    album_slug: r.albumSlug,
    year: r.year,
    genre: r.genre,
    voice_type: r.voiceType,
    voice_percent_male: r.voicePercentMale,
    voice_percent_female: r.voicePercentFemale,
    cover_image: r.coverImage,
    sections, // postgres.js serializes JS arrays into JSONB automatically
    album_order: r.albumOrder ?? 0,
    cejilla: r.cejilla,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

async function main() {
  console.log(`mode: ${DRY_RUN ? 'DRY-RUN' : 'WRITE'}${FORCE ? ' (--force)' : ''}`);

  // 1. Read from Turso
  const res = await turso.execute('SELECT * FROM songs ORDER BY album, albumOrder');
  console.log(`turso rows: ${res.rows.length}`);
  const rows = res.rows.map(mapRow);

  // Quick stats so the dry-run is useful
  const byAlbum = rows.reduce((acc, r) => ((acc[r.album] = (acc[r.album] ?? 0) + 1), acc), {});
  const sectionsLens = rows.map((r) => r.sections.length);
  console.log('rows by album:', byAlbum);
  console.log(
    `sections array length — min: ${Math.min(...sectionsLens)}, max: ${Math.max(...sectionsLens)}, avg: ${(
      sectionsLens.reduce((a, b) => a + b, 0) / sectionsLens.length
    ).toFixed(1)}`,
  );
  const orphanCovers = rows.filter((r) => r.cover_image && !r.cover_image.startsWith('/covers/'));
  if (orphanCovers.length) {
    console.log(`⚠️  ${orphanCovers.length} rows have cover_image outside /covers/ (likely dead /uploads/ refs):`);
    orphanCovers.forEach((r) => console.log(`    ${r.id} → ${r.cover_image}`));
  }

  if (DRY_RUN) {
    console.log('DRY-RUN: skipping PG write.');
    await turso.close();
    await sql.end();
    return;
  }

  // 2. Pre-flight target
  const existing = await sql`SELECT COUNT(*)::int AS n FROM songs`;
  const existingCount = existing[0].n;
  if (existingCount > 0 && !FORCE) {
    console.error(
      `Target songs table is not empty (${existingCount} rows). Re-run with --force to delete and re-insert.`,
    );
    await turso.close();
    await sql.end();
    process.exit(2);
  }

  // 3. Write inside one transaction
  await sql.begin(async (tx) => {
    if (existingCount > 0) {
      console.log(`--force: deleting ${existingCount} existing rows`);
      await tx`DELETE FROM songs`;
    }
    // postgres.js bulk insert via the `helpers` template: pass an array of objects
    // and the column list to control ordering.
    await tx`
      INSERT INTO songs ${tx(
        rows,
        'id', 'title', 'artist', 'album', 'album_slug', 'year', 'genre',
        'voice_type', 'voice_percent_male', 'voice_percent_female', 'cover_image',
        'sections', 'album_order', 'cejilla', 'created_at', 'updated_at',
      )}
    `;
  });

  const after = await sql`SELECT COUNT(*)::int AS n FROM songs`;
  console.log(`PG rows after insert: ${after[0].n}`);
  if (after[0].n !== rows.length) {
    console.error(`MISMATCH: turso=${rows.length} pg=${after[0].n}`);
    process.exitCode = 3;
  } else {
    console.log('✅ row count parity OK');
  }

  await turso.close();
  await sql.end();
}

main().catch(async (e) => {
  console.error('FATAL:', e);
  try { await turso.close(); } catch {}
  try { await sql.end(); } catch {}
  process.exit(1);
});
