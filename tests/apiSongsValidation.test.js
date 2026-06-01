import { describe, it, expect } from 'vitest';
// Source-assertion: confirma que el handler aplica validación server-side v2.
// (Invocar el handler real requeriría mocks de req/res + DB; seguimos el estilo
// de apiSongsV2.test.js y aseveramos sobre el código fuente.)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('api/songs/[id].js server-side v2 validation', () => {
  const src = readFileSync(resolve(process.cwd(), 'api/songs/[id].js'), 'utf8');

  it('importa validateSongV2 desde voiceSystem', () => {
    expect(src).toMatch(
      /import\s*\{[^}]*validateSongV2[^}]*\}\s*from\s*['"]\.\.\/\.\.\/src\/lib\/voiceSystem\.js['"]/,
    );
  });

  it('valida solo cuando schemaVersion === 2', () => {
    expect(src).toMatch(/if\s*\(\s*s\.schemaVersion\s*===\s*2\s*\)/);
    expect(src).toMatch(/validateSongV2\(\s*s\s*\)/);
  });

  it('responde 400 con el mensaje del error y no persiste (return)', () => {
    // El try/catch envuelve validateSongV2 y, on throw, responde 400 + return.
    expect(src).toMatch(
      /catch\s*\(\s*e\s*\)\s*\{[\s\S]*?res\.status\(400\)\.json\(\{\s*error:\s*e\.message\s*\}\)[\s\S]*?return;/,
    );
  });

  it('ya no contiene el TODO de validación diferida', () => {
    expect(src).not.toMatch(/TODO\(Plan D\)/);
  });
});

describe('api/songs/index.js server-side v2 validation (create)', () => {
  const src = readFileSync(resolve(process.cwd(), 'api/songs/index.js'), 'utf8');

  it('importa validateSongV2 y valida en create cuando schemaVersion === 2', () => {
    expect(src).toMatch(/import\s*\{[^}]*validateSongV2[^}]*\}/);
    expect(src).toMatch(/if\s*\(\s*s\.schemaVersion\s*===\s*2\s*\)/);
    expect(src).toMatch(/validateSongV2\(\s*s\s*\)/);
  });

  it('persiste voice_roster y schema_version en el INSERT', () => {
    expect(src).toMatch(/voice_roster/);
    expect(src).toMatch(/schema_version/);
    expect(src).toMatch(/sql\.json\(s\.voiceRoster/);
  });
});

describe('api server-side v3 validation', () => {
  const idSrc = readFileSync(resolve(process.cwd(), 'api/songs/[id].js'), 'utf8');
  const createSrc = readFileSync(resolve(process.cwd(), 'api/songs/index.js'), 'utf8');

  it('[id].js importa y valida v3', () => {
    expect(idSrc).toMatch(/validateSongV3/);
    expect(idSrc).toMatch(/s\.schemaVersion\s*===\s*3/);
  });

  it('index.js importa y valida v3 en create', () => {
    expect(createSrc).toMatch(/validateSongV3/);
    expect(createSrc).toMatch(/s\.schemaVersion\s*===\s*3/);
  });
});
