import { IncomingForm } from 'formidable';
import { createReadStream } from 'node:fs';
import sql from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { uploadAvatar } from '../_lib/storage.js';

export const config = {
  api: { bodyParser: false },
};

const ALLOWED = new Set(['image/webp', 'image/png', 'image/jpeg']);
const MAX_SIZE = 2 * 1024 * 1024;

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  const user = await requireUser(req);

  const form = new IncomingForm({
    maxFileSize: MAX_SIZE,
    keepExtensions: true,
  });

  const [, files] = await form.parse(req);
  const file = files.avatar?.[0];
  if (!file) {
    res.status(400).json({ error: 'No file uploaded (expected field name "avatar")' });
    return;
  }

  const contentType = file.mimetype || 'application/octet-stream';
  if (!ALLOWED.has(contentType)) {
    res.status(400).json({ error: 'unsupported_type', allowed: [...ALLOWED] });
    return;
  }

  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpg' : 'webp';

  const url = await uploadAvatar({
    userId: user.id,
    ext,
    contentType,
    body: createReadStream(file.filepath),
  });

  await sql`UPDATE profiles SET avatar_url = ${url} WHERE id = ${user.id}`;

  res.status(200).json({ url });
});
