import { describe, it, expect, vi } from 'vitest';
import { LyricsPreviewStep } from '../src/components/pipeline/LyricsPreviewStep.js';

const DOC = {
  version: 2,
  sections: [
    { type: 'instrumental', label: null, startMs: 0, endMs: 3400, lines: [] },
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

  // Task 4 (S3a-ii): tras la sesión 1 "instrumental" es un tipo de sección,
  // no un proxy de "sin renglones" — una sección recién insertada puede
  // estar vacía sin ser instrumental, y una instrumental puede traer texto.
  it('una sección verse con lines: [] no dice "tramo instrumental"', () => {
    const doc = {
      version: 2,
      sections: [{ type: 'verse', label: null, startMs: 0, endMs: 3400, lines: [] }],
    };
    const el = LyricsPreviewStep({ doc, vocalsUrl: null, onConfirm: () => {}, onBack: () => {} });
    const section = el.querySelector('.lps__section');
    expect(section.classList.contains('lps__section--instrumental')).toBe(false);
    expect(section.textContent).not.toContain('tramo instrumental');
  });

  it('una sección instrumental con renglones muestra los renglones', () => {
    const doc = {
      version: 2,
      sections: [
        {
          type: 'instrumental',
          label: null,
          startMs: 0,
          endMs: 3400,
          lines: [
            {
              text: 'ah ah ah',
              startMs: 1000,
              endMs: 2000,
              words: [],
              confidence: 0.9,
              vocalization: true,
              breath: false,
              manualStartMs: null,
            },
          ],
        },
      ],
    };
    const el = LyricsPreviewStep({ doc, vocalsUrl: null, onConfirm: () => {}, onBack: () => {} });
    const section = el.querySelector('.lps__section');
    expect(section.classList.contains('lps__section--instrumental')).toBe(true);
    expect(section.textContent).toContain('ah ah ah');
    expect(section.textContent).not.toContain('tramo instrumental');
  });

  it('una sección instrumental con lines: [] sigue mostrando la leyenda', () => {
    const doc = {
      version: 2,
      sections: [{ type: 'instrumental', label: null, startMs: 0, endMs: 3400, lines: [] }],
    };
    const el = LyricsPreviewStep({ doc, vocalsUrl: null, onConfirm: () => {}, onBack: () => {} });
    const section = el.querySelector('.lps__section');
    expect(section.textContent).toContain('tramo instrumental');
  });
});
