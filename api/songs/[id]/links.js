import sql from '../../_lib/db.js';
import { requireAdmin } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';

function isHttpUrl(v) {
  try {
    const u = new URL(String(v));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

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

  await sql.begin(async (tx) => {
    await tx`DELETE FROM song_platform_links WHERE song_id = ${songId}`;
    await tx`DELETE FROM song_voice_links WHERE song_id = ${songId}`;

    // Validar todo antes de insertar (para no dejar filas parciales si algo falla
    // a mitad), y luego un solo INSERT multi-fila por tabla en vez de un
    // round-trip por entrada.
    const platformRows = [];
    for (const p of platforms) {
      if (!p.platform || !p.url) continue;
      if (!isHttpUrl(p.url)) {
        const e = new Error('url_invalida');
        e.status = 400;
        throw e;
      }
      platformRows.push({ song_id: songId, platform: p.platform, url: p.url });
    }
    if (platformRows.length > 0) {
      await tx`INSERT INTO song_platform_links ${tx(platformRows, 'song_id', 'platform', 'url')}`;
    }

    const voiceRows = [];
    for (const v of voices) {
      if (!v.voiceType || !v.url) continue;
      if (!isHttpUrl(v.url)) {
        const e = new Error('url_invalida');
        e.status = 400;
        throw e;
      }
      voiceRows.push({ song_id: songId, voice_type: v.voiceType, url: v.url, label: v.label || null });
    }
    if (voiceRows.length > 0) {
      await tx`INSERT INTO song_voice_links ${tx(voiceRows, 'song_id', 'voice_type', 'url', 'label')}`;
    }
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
