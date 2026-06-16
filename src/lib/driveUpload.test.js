import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  buildSearchQuery,
  buildFileQuery,
  buildMultipartBody,
  findFileInFolder,
  uploadMedia,
} from './driveUpload.js';

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
  it('usa el mime indicado en la parte binaria (default zip)', async () => {
    const def = buildMultipartBody({ name: 'x' }, new Blob(['D']), 'B');
    expect(await def.text()).toContain('Content-Type: application/zip');
    const mp3 = buildMultipartBody({ name: 'x' }, new Blob(['D']), 'B', 'audio/mpeg');
    expect(await mp3.text()).toContain('Content-Type: audio/mpeg');
  });
});

describe('buildFileQuery', () => {
  it('arma el q por nombre dentro de la carpeta (sin filtro de mime)', () => {
    expect(buildFileQuery('colombia - Bajo.mp3', 'fold1')).toBe(
      "name='colombia - Bajo.mp3' and 'fold1' in parents and trashed=false",
    );
  });
  it('escapa comillas simples', () => {
    expect(buildFileQuery("O'x.mp3", 'f')).toContain("name='O\\'x.mp3'");
  });
});

describe('findFileInFolder', () => {
  afterEach(() => {
    delete globalThis.fetch;
  });
  it('devuelve el id del primer match', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ files: [{ id: 'EXIST', name: 'a.mp3' }] }),
    }));
    expect(await findFileInFolder('tok', 'a.mp3', 'F')).toBe('EXIST');
  });
  it('devuelve null si no hay match', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ files: [] }) }));
    expect(await findFileInFolder('tok', 'a.mp3', 'F')).toBe(null);
  });
});

describe('uploadMedia', () => {
  function installFakeXHR() {
    const instances = [];
    class FakeXHR {
      constructor() {
        this.upload = {};
        this.headers = {};
        this.status = 0;
        this.responseText = '';
        instances.push(this);
      }
      open(method, url) {
        this.method = method;
        this.url = url;
      }
      setRequestHeader(k, v) {
        this.headers[k] = v;
      }
      send(body) {
        this.body = body;
      }
    }
    globalThis.XMLHttpRequest = FakeXHR;
    return instances;
  }

  afterEach(() => {
    delete globalThis.XMLHttpRequest;
  });

  it('resuelve con el JSON parseado y reporta progreso en %', async () => {
    const instances = installFakeXHR();
    const body = new Blob(['x']);
    const seen = [];
    const p = uploadMedia('tok', 'http://up', body, 'BOUND', (pct) => seen.push(pct));
    const xhr = instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('http://up');
    expect(xhr.headers.Authorization).toBe('Bearer tok');
    expect(xhr.headers['Content-Type']).toBe('multipart/related; boundary=BOUND');
    xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 200 });
    xhr.upload.onprogress({ lengthComputable: true, loaded: 200, total: 200 });
    xhr.status = 200;
    xhr.responseText = '{"id":"file123"}';
    xhr.onload();
    await expect(p).resolves.toEqual({ id: 'file123' });
    expect(seen).toEqual([25, 100]);
  });

  it('usa el method indicado (PATCH para sobrescribir)', async () => {
    const instances = installFakeXHR();
    const p = uploadMedia('tok', 'http://up/ID', new Blob(['x']), 'BOUND', undefined, 'PATCH');
    const xhr = instances[0];
    expect(xhr.method).toBe('PATCH');
    xhr.status = 200;
    xhr.responseText = '{"id":"ID"}';
    xhr.onload();
    await expect(p).resolves.toEqual({ id: 'ID' });
  });

  it('rechaza con err.status 0 en error de red', async () => {
    const instances = installFakeXHR();
    const p = uploadMedia('tok', 'http://up', new Blob(['x']), 'BOUND');
    const xhr = instances[0];
    xhr.onerror();
    await expect(p).rejects.toMatchObject({ status: 0 });
  });

  it('rechaza con err.status cuando el status es >= 400', async () => {
    const instances = installFakeXHR();
    const p = uploadMedia('tok', 'http://up', new Blob(['x']), 'BOUND');
    const xhr = instances[0];
    xhr.status = 401;
    xhr.responseText = '';
    xhr.onload();
    await expect(p).rejects.toMatchObject({ status: 401 });
  });
});
