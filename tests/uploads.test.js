/**
 * uploads.test.js — TDD para detectImageType (api/_lib/uploads.js)
 *
 * La firma real del archivo (magic bytes) manda sobre el mimetype declarado
 * por el cliente. Verifica: (a) un PNG real es aceptado y devuelve
 * "image/png"; (b) un archivo de texto plano es rechazado con 400.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectImageType } from '../api/_lib/uploads.js';

const dir = mkdtempSync(join(tmpdir(), 'hgm-uploads-test-'));

/** Construye un chunk PNG mínimo (length + tipo + data + CRC, sin validar CRC). */
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

// PNG mínimo válido: firma + chunk IHDR + chunk IDAT (no basta la firma sola).
const REAL_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', Buffer.alloc(13)),
  pngChunk('IDAT', Buffer.alloc(0)),
]);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('detectImageType', () => {
  it('acepta un PNG real y devuelve "image/png"', async () => {
    const filepath = join(dir, 'imagen.bin');
    writeFileSync(filepath, REAL_PNG);

    const mime = await detectImageType(filepath, ['image/png', 'image/jpeg', 'image/webp']);

    expect(mime).toBe('image/png');
  });

  it('rechaza un archivo de texto plano con error 400', async () => {
    const filepath = join(dir, 'texto.bin');
    writeFileSync(filepath, 'esto no es una imagen, es texto plano\n'.repeat(10));

    await expect(
      detectImageType(filepath, new Set(['image/png', 'image/jpeg', 'image/webp'])),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('no coincide con un tipo de imagen permitido'),
    });
  });

  it('rechaza un tipo real detectado pero fuera de la allowlist', async () => {
    const filepath = join(dir, 'imagen2.bin');
    writeFileSync(filepath, REAL_PNG);

    await expect(detectImageType(filepath, new Set(['image/webp']))).rejects.toMatchObject({
      status: 400,
    });
  });
});
