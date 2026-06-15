import { IncomingForm } from 'formidable';
import { createReadStream } from 'node:fs';
import sql from './_lib/db.js';
import { requireAdmin } from './_lib/auth.js';
import { allowMethods, withErrors } from './_lib/http.js';
import { uploadCover } from './_lib/storage.js';

// Vercel auto-parses JSON; we must disable that for multipart.
export const config = {
  api: { bodyParser: false },
};

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  await requireAdmin(req, sql);

  const form = new IncomingForm({
    maxFileSize: 10 * 1024 * 1024, // 10 MiB; covers are usually < 200 KiB
    keepExtensions: true,
  });

  const [, files] = await form.parse(req);
  const file = files.cover?.[0];
  if (!file) {
    res.status(400).json({ error: 'No file uploaded (expected field name "cover")' });
    return;
  }

  const contentType = file.mimetype || 'application/octet-stream';
  if (!ALLOWED.has(contentType)) {
    res.status(400).json({ error: 'Tipo no permitido' });
    return;
  }

  // formidable buffers to /tmp on Vercel (the only writable path). Stream it to Storage.
  const url = await uploadCover({
    filename: file.originalFilename ?? 'upload.bin',
    contentType,
    body: createReadStream(file.filepath),
  });

  res.status(200).json({ url });
});
