import { describe, it, expect } from 'vitest';
// Round-trip mínimo: verifica que el SELECT/UPDATE incluyen las columnas v2.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('api/songs/[id].js v2 columns', () => {
  // jsdom expone `import.meta.url` como http:; resolvemos contra cwd (raíz del repo).
  const src = readFileSync(resolve(process.cwd(), 'api/songs/[id].js'), 'utf8');
  it('selecciona voice_roster y schema_version', () => {
    expect(src).toMatch(/voice_roster\s+AS\s+"voiceRoster"/);
    expect(src).toMatch(/schema_version\s+AS\s+"schemaVersion"/);
  });
  it('persiste voice_roster y schema_version en update', () => {
    expect(src).toMatch(/voice_roster\s*=\s*\$\{sql\.json\(s\.voiceRoster/);
    expect(src).toMatch(/schema_version\s*=\s*\$\{s\.schemaVersion/);
  });
});
