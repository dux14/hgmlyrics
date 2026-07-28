/**
 * apiUpload.test.js — TDD para POST /api/upload (subida de portadas, admin)
 *
 * SEC-08: allowlist de content-type antes de delegar a Storage.
 * MIME no permitido (ej. image/svg+xml) → 400 "Tipo no permitido" sin llamar uploadCover.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync } from 'node:fs';

// ── Mock de storage ───────────────────────────────────────────────────────────
const mockUploadCover = vi.fn();
vi.mock('../api/_lib/storage.js', () => ({
  uploadCover: mockUploadCover,
}));

// ── Mock de auth (requireAdmin pasa sin rechazar) ─────────────────────────────
vi.mock('../api/_lib/auth.js', () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: 'admin1', email: 'admin@test.com' }),
}));

// ── Mock de @supabase/supabase-js (importado por db.js) ──────────────────────
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: vi.fn() } }),
}));

// ── Mock de postgres (importado por db.js) ───────────────────────────────────
vi.mock('postgres', () => ({
  default: () => Object.assign(() => Promise.resolve([]), { json: (v) => v }),
}));

// ── Mock de formidable: controla qué file.mimetype devuelve el parser ─────────
const mockParse = vi.fn();
vi.mock('formidable', () => ({
  IncomingForm: function IncomingForm() {
    this.parse = mockParse;
  },
}));

// ── Env vars ──────────────────────────────────────────────────────────────────
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.DATABASE_URL = 'postgresql://test';

// Importar handler DESPUÉS de los mocks
const handler = (await import('../api/upload.js')).default;

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  return res;
}

function makeReq() {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer admin-token' },
  };
}

/** Construye un chunk PNG mínimo (length + tipo + data + CRC, sin validar CRC). */
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

// Firmas reales (magic bytes) por mimetype, para que la detección real de
// file-type (SEC: validación de contenido, no solo mimetype declarado) pase
// en los casos que deben aceptarse. PNG requiere firma + chunk IHDR + IDAT,
// no basta con los 8 bytes de cabecera.
const MAGIC_BYTES = {
  'image/png': Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.alloc(13)),
    pngChunk('IDAT', Buffer.alloc(0)),
  ]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
  'image/webp': Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii'),
  ]),
};

/** Simula formidable devolviendo un archivo con el mimetype dado. */
function stubFile(mimetype) {
  // Si conocemos la firma real de este mimetype, escríbela para que
  // detectImageType (validación de contenido) coincida con lo declarado.
  const bytes = MAGIC_BYTES[mimetype];
  if (bytes) writeFileSync('/tmp/hgm-upload-test.bin', bytes);

  mockParse.mockResolvedValueOnce([
    {},
    {
      cover: [
        {
          mimetype,
          originalFilename: 'imagen.png',
          filepath: '/tmp/hgm-upload-test.bin',
        },
      ],
    },
  ]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/upload — allowlist de content-type', () => {
  const TMP_FILE = '/tmp/hgm-upload-test.bin';

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadCover.mockResolvedValue('https://cdn.example.com/covers/imagen.png');
    // Crea un archivo temporal vacío para que createReadStream no tire ENOENT
    writeFileSync(TMP_FILE, '');
  });

  it('rechaza image/svg+xml con 400 y no llama a uploadCover', async () => {
    stubFile('image/svg+xml');
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'Tipo no permitido' });
    expect(mockUploadCover).not.toHaveBeenCalled();
  });

  it('rechaza text/html con 400 y no llama a uploadCover', async () => {
    stubFile('text/html');
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'Tipo no permitido' });
    expect(mockUploadCover).not.toHaveBeenCalled();
  });

  it('acepta image/png y delega a uploadCover', async () => {
    stubFile('image/png');
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ url: expect.any(String) });
    expect(mockUploadCover).toHaveBeenCalledOnce();
    expect(mockUploadCover).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/png' }),
    );
  });

  it('acepta image/jpeg y delega a uploadCover', async () => {
    stubFile('image/jpeg');
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockUploadCover).toHaveBeenCalledOnce();
  });

  it('acepta image/webp y delega a uploadCover', async () => {
    stubFile('image/webp');
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockUploadCover).toHaveBeenCalledOnce();
  });

  it('rechaza cuando no se envía archivo con 400', async () => {
    mockParse.mockResolvedValueOnce([{}, {}]);
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('cover') });
    expect(mockUploadCover).not.toHaveBeenCalled();
  });
});
