// api/lists/[id]/songs.js
import sql from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';

const MAX_ITEMS = 200;
const VALID_TYPES = new Set(['song', 'weekly_word']);

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['PUT'])) return;
  const user = await requireUser(req);
  const id = req.query.id;

  // Accept new typed items format OR legacy songIds (backward compat)
  let ordered;
  let isLegacy = false;

  if (Array.isArray(req.body?.items)) {
    // New format: [{ item_type, item_id }, ...]
    const raw = req.body.items;
    if (raw.length > MAX_ITEMS) {
      const e = new Error('Demasiados items');
      e.status = 400;
      throw e;
    }
    for (const item of raw) {
      if (!VALID_TYPES.has(item.item_type) || typeof item.item_id !== 'string') {
        const e = new Error('item_type inválido');
        e.status = 400;
        throw e;
      }
    }
    // Dedupe by type+id
    const seen = new Set();
    ordered = raw.filter((item) => {
      const key = `${item.item_type}:${item.item_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } else if (Array.isArray(req.body?.songIds)) {
    // Legacy: just song ids
    const songIds = req.body.songIds;
    if (songIds.length > MAX_ITEMS) {
      const e = new Error('Demasiadas canciones');
      e.status = 400;
      throw e;
    }
    ordered = [...new Set(songIds)].map((sid) => ({ item_type: 'song', item_id: sid }));
    isLegacy = true;
  } else {
    const e = new Error('items o songIds requerido');
    e.status = 400;
    throw e;
  }

  // Ownership check (before songs existence for legacy, consistent with old behavior)
  const owned =
    await sql`SELECT id FROM ephemeral_lists WHERE id = ${id} AND owner_id = ${user.id}`;
  if (!owned[0]) {
    const e = new Error('No autorizado');
    e.status = 403;
    throw e;
  }

  // For legacy songIds: validate all songs exist
  if (isLegacy && ordered.length > 0) {
    const ids = ordered.map((o) => o.item_id);
    const exist = await sql`SELECT id FROM songs WHERE id IN ${sql(ids)}`;
    if (exist.length !== ids.length) {
      const e = new Error('Alguna canción no existe');
      e.status = 400;
      throw e;
    }
  }

  await sql.begin(async (tx) => {
    await tx`DELETE FROM ephemeral_list_items WHERE list_id = ${id}`;
    for (let i = 0; i < ordered.length; i++) {
      await tx`INSERT INTO ephemeral_list_items (list_id, item_type, item_id, position)
               VALUES (${id}, ${ordered[i].item_type}, ${ordered[i].item_id}, ${i})`;
    }
    await tx`UPDATE ephemeral_lists SET updated_at = now() WHERE id = ${id}`;
  });

  res.status(200).json({ count: ordered.length });
});
