import { describe, it, expect, vi } from 'vitest';
import { LyricsPreviewStep } from '../src/components/pipeline/LyricsPreviewStep.js';

const DOC = {
  version: 2,
  sections: [
    { type: 'intro', label: null, startMs: 0, endMs: 3400, lines: [] },
    {
      type: 'chorus',
      label: null,
      startMs: 10000,
      endMs: 20000,
      lines: [
        {
          text: 'canto uno',
          startMs: 11000,
          endMs: 12000,
          words: [],
          confidence: 0.9,
          vocalization: false,
          breath: false,
          manualStartMs: null,
        },
      ],
    },
  ],
};

describe('LyricsPreviewStep', () => {
  it('lista las secciones con su tipo y marca las instrumentales', () => {
    const el = LyricsPreviewStep({ doc: DOC, vocalsUrl: null, onConfirm: () => {}, onBack: () => {} });
    const sections = el.querySelectorAll('.lps__section');
    expect(sections).toHaveLength(2);
    expect(sections[0].classList.contains('lps__section--instrumental')).toBe(true);
    expect(sections[1].textContent).toContain('canto uno');
  });

  it('confirmar y volver disparan sus callbacks', () => {
    const onConfirm = vi.fn();
    const onBack = vi.fn();
    const el = LyricsPreviewStep({ doc: DOC, vocalsUrl: null, onConfirm, onBack });
    el.querySelector('.lps__confirm').click();
    el.querySelector('.lps__back').click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('resalta el renglón cuyo rango contiene el tiempo actual', () => {
    const el = LyricsPreviewStep({ doc: DOC, vocalsUrl: null, onConfirm: () => {}, onBack: () => {} });
    el.setCurrentTime(11.5);
    expect(el.querySelector('.lps__line.is-active').textContent).toContain('canto uno');
  });
});
