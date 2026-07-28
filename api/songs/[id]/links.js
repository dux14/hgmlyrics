import sql from '../../_lib/db.js';
import { requireAdmin } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import { persistLinksInTx } from '../../_lib/songLinks.js';

async function getLinks(_req, res, songId) {
  // Lecturas secuenciales por simplicidad, no por límite del pooler: el pool
  // (api/_lib/db.js) tiene max:5, tolera queries concurrentes sin problema.
  const platforms =
    await sql`SELECT id, platform, url FROM song_platform_links WHERE song_id = ${songId} ORDER BY platform`;
  const voices =
    await sql`SELECT id, voice_type AS "voiceType", url, label FROM song_voice_links WHERE song_id = ${songId} ORDER BY voice_type, created_at`;
  res.status(200).json({ platforms, voices });
}

async function putLinks(req, res, songId) {
  await requireAdmin(req, sql);
  const { platforms = [], voices = [] } = req.body ?? {};

  // Endpoint standalone, se mantiene por compat (SongLinks.js sigue usando el
  // GET; el guardado normal del editor ahora manda los links en el mismo
  // PUT/POST de songs y los persiste atómico — ver api/songs/[id].js).
  await sql.begin(async (tx) => {
    await persistLinksInTx(tx, songId, platforms, voices);
  });

  res.status(200).json({ success: true });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'PUT'])) return;
  const songId = req.query.id;
  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  if (req.method === 'GET') return getLinks(req, res, songId);
  return putLinks(req, res, songId);
});
