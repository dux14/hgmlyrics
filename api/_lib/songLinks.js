/**
 * Validación y persistencia de song_platform_links / song_voice_links.
 * Compartido entre api/songs/[id]/links.js (endpoint standalone, se mantiene
 * por compat) y el guardado atómico en api/songs/index.js + api/songs/[id].js.
 */

export function isHttpUrl(v) {
  try {
    const u = new URL(String(v));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Valida platforms/voices y arma las filas listas para INSERT. Lanza
 * Error('url_invalida') (status 400) al primer link con URL no http(s).
 * Entradas sin platform/url o sin voiceType/url se ignoran (igual que hoy).
 * @param {string} songId
 * @param {Array<{platform:string,url:string}>} platforms
 * @param {Array<{voiceType:string,url:string,label?:string}>} voices
 */
export function buildLinkRows(songId, platforms = [], voices = []) {
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

  return { platformRows, voiceRows };
}

/**
 * DELETE+INSERT de los links de una canción dentro de una transacción (tx)
 * ya abierta por el llamador (sql.begin). No abre ni cierra transacción.
 * @param {import('postgres').TransactionSql} tx
 * @param {string} songId
 * @param {Array} platforms
 * @param {Array} voices
 */
export async function persistLinksInTx(tx, songId, platforms = [], voices = []) {
  const { platformRows, voiceRows } = buildLinkRows(songId, platforms, voices);

  await tx`DELETE FROM song_platform_links WHERE song_id = ${songId}`;
  await tx`DELETE FROM song_voice_links WHERE song_id = ${songId}`;

  if (platformRows.length > 0) {
    await tx`INSERT INTO song_platform_links ${tx(platformRows, 'song_id', 'platform', 'url')}`;
  }
  if (voiceRows.length > 0) {
    await tx`INSERT INTO song_voice_links ${tx(voiceRows, 'song_id', 'voice_type', 'url', 'label')}`;
  }
}
