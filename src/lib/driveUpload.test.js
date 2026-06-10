import { describe, it, expect } from 'vitest';
import { buildSearchQuery, buildMultipartBody } from './driveUpload.js';

describe('buildSearchQuery', () => {
  it('arma el q de carpeta con parent y filtros', () => {
    expect(buildSearchQuery('Pistas Hakuna', 'root')).toBe(
      "name='Pistas Hakuna' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents",
    );
  });
  it('escapa comillas simples en el nombre', () => {
    expect(buildSearchQuery("O'Brien", 'abc')).toContain("name='O\\'Brien'");
  });
});

describe('buildMultipartBody', () => {
  it('arma un Blob multipart/related con metadata JSON + media', async () => {
    const meta = { name: 'x - pistas.zip', parents: ['folder1'] };
    const media = new Blob(['ZIPDATA'], { type: 'application/zip' });
    const blob = buildMultipartBody(meta, media, 'BOUNDARY');
    // Blob.type se normaliza a ASCII-minúsculas según la File API spec
    expect(blob.type).toBe('multipart/related; boundary=boundary');
    const text = await blob.text();
    expect(text).toContain('--BOUNDARY');
    expect(text).toContain('"name":"x - pistas.zip"');
    expect(text).toContain('"parents":["folder1"]');
    expect(text).toContain('ZIPDATA');
    expect(text.trimEnd().endsWith('--BOUNDARY--')).toBe(true);
  });
});
