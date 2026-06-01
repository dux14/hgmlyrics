// scripts/backfill-song-v2.mjs
// Convierte canciones v1 a v2 en DB usando upgradeLegacySong. Idempotente.
// Uso: node scripts/backfill-song-v2.mjs --dry-run   (no escribe)
//      node scripts/backfill-song-v2.mjs             (escribe)
import postgres from 'postgres';
import { upgradeLegacySong, validateSongV2 } from '../src/lib/voiceSystem.js';

const DRY = process.argv.includes('--dry-run');
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', prepare: false, max: 1 });

const rows = await sql`SELECT id, sections, schema_version AS "schemaVersion" FROM songs`;
let converted = 0;
for (const row of rows) {
  if (row.schemaVersion === 2) continue;
  const up = upgradeLegacySong({ schemaVersion: row.schemaVersion, sections: row.sections });
  validateSongV2(up); // aborta si algo quedó inválido
  converted++;
  if (DRY) {
    console.log(`[dry-run] ${row.id} → v2 (${up.voiceRoster.length} voces)`);
  } else {
    await sql`
      UPDATE songs
      SET sections = ${sql.json(up.sections)},
          voice_roster = ${sql.json(up.voiceRoster)},
          schema_version = 2
      WHERE id = ${row.id}
    `;
    console.log(`converted ${row.id}`);
  }
}
console.log(`${DRY ? '[dry-run] ' : ''}${converted} canciones a convertir.`);
await sql.end();
