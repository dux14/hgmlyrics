import sql from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';

const MAX_SONGS = 200;

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['PUT'])) return;
  const user = await requireUser(req);
  const id = req.query.id;
  const songIds = Array.isArray(req.body?.songIds) ? req.body.songIds : null;
  if (!songIds) {
    const e = new Error('songIds requerido');
    e.status = 400;
    throw e;
  }
  if (songIds.length > MAX_SONGS) {
    const e = new Error('Demasiadas canciones');
    e.status = 400;
    throw e;
  }
  // dedupe preservando orden
  const ordered = [...new Set(songIds)];

  const owned =
    await sql`SELECT id FROM ephemeral_lists WHERE id = ${id} AND owner_id = ${user.id}`;
  if (!owned[0]) {
    const e = new Error('No autorizado');
    e.status = 403;
    throw e;
  }

  if (ordered.length > 0) {
    const exist = await sql`SELECT id FROM songs WHERE id IN ${sql(ordered)}`;
    if (exist.length !== ordered.length) {
      const e = new Error('Alguna canción no existe');
      e.status = 400;
      throw e;
    }
  }

  await sql.begin(async (tx) => {
    await tx`DELETE FROM ephemeral_list_songs WHERE list_id = ${id}`;
    for (let i = 0; i < ordered.length; i++) {
      await tx`INSERT INTO ephemeral_list_songs (list_id, song_id, position)
               VALUES (${id}, ${ordered[i]}, ${i})`;
    }
    await tx`UPDATE ephemeral_lists SET updated_at = now() WHERE id = ${id}`;
  });

  res.status(200).json({ count: ordered.length, songIds: ordered });
});
