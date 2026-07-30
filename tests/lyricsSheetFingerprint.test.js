import { describe, expect, it } from 'vitest';
import { sectionFingerprint } from '../src/components/pipeline/lyrics/fingerprint.js';

function makeSection() {
  return {
    type: 'verse',
    label: 'Verso 1',
    startMs: 1000,
    endMs: 5000,
    lines: [
      {
        text: 'Una línea de prueba',
        vocalization: 'voz principal',
        confidence: 0.87,
        startMs: 1000,
        endMs: 2000,
        words: [
          { text: 'Una', startMs: 1000, endMs: 1200 },
          { text: 'línea', startMs: 1200, endMs: 1500 },
        ],
      },
    ],
  };
}

describe('sectionFingerprint', () => {
  it('es estable ante la misma sección reconstruida', () => {
    const a = structuredClone(makeSection());
    const b = structuredClone(makeSection());
    expect(sectionFingerprint(a)).toBe(sectionFingerprint(b));
  });

  it('cambia si cambia el texto de un renglón', () => {
    const original = structuredClone(makeSection());
    const modified = structuredClone(makeSection());
    modified.lines[0].text = 'Otra línea distinta';
    expect(sectionFingerprint(original)).not.toBe(sectionFingerprint(modified));
  });

  it('cambia si cambia el type de la sección', () => {
    const original = structuredClone(makeSection());
    const modified = structuredClone(makeSection());
    modified.type = 'chorus';
    expect(sectionFingerprint(original)).not.toBe(sectionFingerprint(modified));
  });

  it('no cambia si cambia el contenido de words, pero sí si words pasa a null', () => {
    const original = structuredClone(makeSection());
    const sameShape = structuredClone(makeSection());
    sameShape.lines[0].words = [{ text: 'Otra', startMs: 9000, endMs: 9500 }];
    expect(sectionFingerprint(original)).toBe(sectionFingerprint(sameShape));

    const withoutWords = structuredClone(makeSection());
    withoutWords.lines[0].words = null;
    expect(sectionFingerprint(original)).not.toBe(sectionFingerprint(withoutWords));
  });

  it('una sección con lines: [] no revienta', () => {
    const empty = structuredClone(makeSection());
    empty.lines = [];
    expect(() => sectionFingerprint(empty)).not.toThrow();
  });
});
