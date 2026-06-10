import { describe, it, expect } from 'vitest';
import { buildSearchQuery } from './driveUpload.js';

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
