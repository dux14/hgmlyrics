import { describe, it, expect } from 'vitest';
import { normalizeLyric, diffSong, buildReport } from '../../scripts/acordes/lib/audit.mjs';

describe('normalizeLyric', () => {
  it('quita acentos/emojis y colapsa alargamientos (3+)', () => {
    expect(normalizeLyric('Caaanción 🎵')).toBe('cancion');
  });
});

describe('diffSong', () => {
  const mk = (text, chords, extra = {}) => ({
    sections: [{ lines: [{ text, chords }] }],
    ...extra,
  });

  it('ALTA cuando el texto difiere', () => {
    const f = diffSong(mk('hola', []), mk('adios', []));
    expect(f.some((x) => x.severity === 'ALTA' && x.kind === 'text')).toBe(true);
  });
  it('MEDIA cuando un acorde está en una fuente y no en otra', () => {
    const f = diffSong(mk('hola', [{ pos: 0, ch: 'Am' }]), mk('hola', []));
    expect(f.some((x) => x.severity === 'MEDIA' && x.kind === 'chord')).toBe(true);
  });
  it('BAJA en diferencia de cejilla', () => {
    const f = diffSong(mk('hola', [], { cejilla: 2 }), mk('hola', [], { cejilla: 0 }));
    expect(f.some((x) => x.severity === 'BAJA' && x.kind === 'cejilla')).toBe(true);
  });
  it('BAJA por acorde no inlineable', () => {
    const f = diffSong(
      mk('hola', [{ pos: 0, ch: 'Dm7b5' }]),
      mk('hola', [{ pos: 0, ch: 'Dm7b5' }]),
    );
    expect(f.some((x) => x.kind === 'chord-extended')).toBe(true);
  });
});

describe('buildReport', () => {
  it('incluye dashboard con conteos y listas de no-match', () => {
    const md = buildReport(
      [{ title: 'X', findings: [{ severity: 'ALTA', kind: 'text', detail: 'd' }] }],
      [{ title: 'FaltaPDF' }],
      [{ title: 'FaltaBD' }],
    );
    expect(md).toContain('## Dashboard');
    expect(md).toContain('ALTA 1');
    expect(md).toContain('FaltaPDF');
    expect(md).toContain('FaltaBD');
  });
});
