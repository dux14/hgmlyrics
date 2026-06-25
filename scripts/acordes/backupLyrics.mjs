// scripts/acordes/backupLyrics.mjs
// Snapshot de sections/key/cejilla de TODAS las canciones a songs_lyrics_backup.
// Uso: node --env-file=.env scripts/acordes/backupLyrics.mjs
import sql from '../../api/_lib/db.js';

async function main() {
  const rows = await sql`
    INSERT INTO songs_lyrics_backup (song_id, sections, key, cejilla)
    SELECT id, sections, key, cejilla FROM songs
    RETURNING song_id
  `;
  console.log(`Respaldadas ${rows.length} canciones a songs_lyrics_backup.`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
