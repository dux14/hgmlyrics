import { describe, it, expect } from 'vitest';
import { buildHighlightedHTML, upgradeLegacySong } from '../src/lib/voiceSystem.js';

// Fixture v1 representativa.
const v1 = {
  sections: [
    {
      type: 'verse',
      label: 'E1',
      lines: [
        { text: 'Santo es el Señor', voiceRanges: [{ start: 0, end: 5, voices: ['soprano'] }] },
      ],
    },
  ],
};

describe('regresión v1', () => {
  it('upgradeLegacySong no altera el texto de las líneas', () => {
    const up = upgradeLegacySong(v1);
    expect(up.sections[0].lines[0].text).toBe('Santo es el Señor');
  });

  it('el highlight v1 (buildHighlightedHTML) sigue produciendo el mismo HTML', () => {
    const line = v1.sections[0].lines[0];
    const before = buildHighlightedHTML(line.text, line.voiceRanges, 'soprano');
    // Tras el upgrade, las voiceRanges originales se conservan para lectura dual.
    const up = upgradeLegacySong(v1);
    const upLine = up.sections[0].lines[0];
    const after = buildHighlightedHTML(upLine.text, upLine.voiceRanges, 'soprano');
    expect(after).toBe(before);
  });
});
