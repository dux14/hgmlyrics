/**
 * POST /api/admin/tileset-upload
 *
 * Recibe la imagen del tileset como multipart/form-data (campo "tileset")
 * y la sube al bucket "world-maps" usando el cliente service-role, igual
 * que el avatar se sube a traves de api/profile/avatar.js.
 *
 * Retorna: { url: string } — URL publica del tileset en Storage.
 *
 * El upload por service-role es necesario porque el bucket "world-maps" no
 * tiene policies INSERT para `authenticated` (solo service-role bypasea RLS).
 */
import { IncomingForm } from 'formidable';
import { createReadStream } from 'node:fs';
import sql from '../_lib/db.js';
import { requireAdmin } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { uploadTileset } from '../_lib/storage.js';

export const config = {
  api: { bodyParser: false },
};

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);
// 20 MiB — igual que el limite del bucket definido en la migracion.
const MAX_SIZE = 20 * 1024 * 1024;

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;

  await requireAdmin(req, sql);

  const form = new IncomingForm({
    maxFileSize: MAX_SIZE,
    keepExtensions: true,
  });

  const [fields, files] = await form.parse(req);

  const file = files.tileset?.[0];
  if (!file) {
    res.status(400).json({ error: 'No se recibio el archivo (campo esperado: "tileset").' });
    return;
  }

  const contentType = file.mimetype || 'application/octet-stream';
  if (!ALLOWED.has(contentType)) {
    res.status(400).json({ error: 'Tipo de archivo no permitido.', allowed: [...ALLOWED] });
    return;
  }

  // Derivar la ruta en Storage a partir del nombre de mapa opcional.
  // El campo "mapName" es opcional; se usa solo para construir la ruta legible.
  const rawName = (fields.mapName?.[0] ?? 'tileset').trim() || 'tileset';
  const safeName = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40);
  const ext =
    contentType
      .split('/')
      .pop()
      .replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${safeName}-${Date.now()}/tileset.${ext}`;

  const url = await uploadTileset({
    path,
    contentType,
    body: createReadStream(file.filepath),
  });

  res.status(200).json({ url });
});
