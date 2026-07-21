import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/icons.js', () => ({ icon: vi.fn(() => '') }));

import { createToneLyrics } from '../src/components/pipeline/ToneLyrics.js';

// Shape basado en modal/pitch/tests/fixtures/analysis_small.json: lead+backing
// alineadas por índice, más una voz choir en la 2da línea para forzar 3+
// notas en una sílaba (colapso .tone-more).
function makeAnalysis() {
  return {
    voices_present: ['lead', 'backing', 'choir'],
    voices: {
      lead: {
        lines: [
          {
            syllables: [
              {
                text: 'Me',
                start: 0.31,
                end: 0.44,
                blank: false,
                midi: 60,
                cents: -6,
                ditto: false,
                note: 'C4',
              },
              {
                text: 'he',
                start: 0.44,
                end: 0.55,
                blank: false,
                midi: 60,
                cents: 0,
                ditto: true,
                note: null,
              },
              {
                text: 'vá',
                start: 0.55,
                end: 0.66,
                blank: false,
                midi: 62,
                cents: 3,
                ditto: false,
                note: 'D4',
              },
              {
                text: 'la',
                start: 0.66,
                end: 0.7,
                blank: true,
                midi: null,
                cents: null,
                ditto: false,
                note: null,
              },
            ],
          },
          {
            syllables: [
              {
                text: 'Oh',
                start: 1.0,
                end: 1.2,
                blank: false,
                midi: 64,
                cents: 0,
                ditto: false,
                note: 'E4',
              },
            ],
          },
        ],
      },
      backing: {
        lines: [
          {
            syllables: [
              {
                text: 'Me',
                start: 0.31,
                end: 0.44,
                blank: false,
                midi: 55,
                cents: 2,
                ditto: false,
                note: 'G3',
              },
              {
                text: 'he',
                start: 0.44,
                end: 0.55,
                blank: true,
                midi: null,
                cents: null,
                ditto: false,
                note: null,
              },
              {
                text: 'vá',
                start: 0.55,
                end: 0.66,
                blank: false,
                midi: 57,
                cents: 0,
                ditto: false,
                note: 'A3',
              },
              {
                text: 'la',
                start: 0.66,
                end: 0.7,
                blank: true,
                midi: null,
                cents: null,
                ditto: false,
                note: null,
              },
            ],
          },
          {
            syllables: [
              {
                text: 'Oh',
                start: 1.0,
                end: 1.2,
                blank: false,
                midi: 60,
                cents: 0,
                ditto: false,
                note: 'C4',
              },
            ],
          },
        ],
      },
      choir: {
        lines: [
          { syllables: [null, null, null, null] },
          {
            syllables: [
              {
                text: 'Oh',
                start: 1.0,
                end: 1.2,
                blank: false,
                midi: 67,
                cents: 0,
                ditto: false,
                note: 'G4',
              },
            ],
          },
        ],
      },
    },
  };
}

describe('ToneLyrics — render', () => {
  let matchMediaMock;

  beforeEach(() => {
    matchMediaMock = vi.fn().mockReturnValue({ matches: false });
    window.matchMedia = matchMediaMock;
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('pinta líneas y sílabas con el texto de la voz base (lead)', () => {
    const { el } = createToneLyrics({ analysis: makeAnalysis() });
    const lines = el.querySelectorAll('.tone-line');
    expect(lines.length).toBe(2);
    expect(el.textContent).toContain('Me');
    expect(el.textContent).toContain('vá');
    expect(el.textContent).toContain('Oh');
  });

  it('apila notas coloreadas por voz: lead y backing', () => {
    const { el } = createToneLyrics({ analysis: makeAnalysis() });
    const firstSyl = el.querySelector('.tone-syl');
    const leadNote = firstSyl.querySelector('.tone-note--lead');
    const altNote = firstSyl.querySelector('.tone-note--alt');
    expect(leadNote.textContent).toBe('C4');
    expect(altNote.textContent).toBe('G3');
  });

  it('ditto muestra cadena vacía y blank no muestra nota', () => {
    const { el } = createToneLyrics({ analysis: makeAnalysis() });
    const syls = el.querySelectorAll('.tone-syl');
    // 2da sílaba de lead ("he") es ditto: nota vacía pero presente.
    const dittoSyl = syls[1];
    const leadNote = dittoSyl.querySelector('.tone-note--lead');
    expect(leadNote).toBeTruthy();
    expect(leadNote.textContent).toBe('');
    // 4ta sílaba ("la") es blank en ambas voces: sin ningún .tone-note.
    const blankSyl = syls[3];
    expect(blankSyl.querySelectorAll('.tone-note').length).toBe(0);
  });

  it('3+ notas en una sílaba colapsan en un punto .tone-more expandible', () => {
    const { el } = createToneLyrics({ analysis: makeAnalysis() });
    const ohSyl = [...el.querySelectorAll('.tone-syl')].find(
      (s) => s.querySelector('.tone-syl-text').textContent === 'Oh',
    );
    const moreBtn = ohSyl.querySelector('.tone-more');
    expect(moreBtn).toBeTruthy();
    const panel = ohSyl.querySelector('.tone-more-panel');
    expect(panel.hidden).toBe(true);
    moreBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(panel.hidden).toBe(false);
    expect(moreBtn.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('ToneLyrics — setActiveTime', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('marca .hot la sílaba correcta por [start,end) y hace scroll a la línea', () => {
    const { el, setActiveTime } = createToneLyrics({ analysis: makeAnalysis() });
    setActiveTime(0.6);
    const hotSyl = el.querySelector('.tone-syl.hot');
    expect(hotSyl.querySelector('.tone-syl-text').textContent).toBe('vá');
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'center', behavior: 'smooth' }),
    );
  });

  it('no re-scrollea si la línea activa no cambió', () => {
    const { setActiveTime } = createToneLyrics({ analysis: makeAnalysis() });
    setActiveTime(0.35);
    setActiveTime(0.6);
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('respeta prefers-reduced-motion (behavior: auto)', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    const { setActiveTime } = createToneLyrics({ analysis: makeAnalysis() });
    setActiveTime(0.35);
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto' }),
    );
  });
});

describe('ToneLyrics — tap en línea y destroy', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('tap en línea llama onSeek con el start (en segundos) de la primera sílaba', () => {
    const onSeek = vi.fn();
    const { el } = createToneLyrics({ analysis: makeAnalysis(), onSeek });
    const secondLine = el.querySelectorAll('.tone-line')[1];
    secondLine.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(onSeek).toHaveBeenCalledWith(1.0);
  });

  it('destroy() quita listeners: un click posterior no dispara onSeek', () => {
    const onSeek = vi.fn();
    const { el, destroy } = createToneLyrics({ analysis: makeAnalysis(), onSeek });
    destroy();
    const line = el.querySelector('.tone-line');
    line.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('destroy() es idempotente', () => {
    const { destroy } = createToneLyrics({ analysis: makeAnalysis() });
    expect(() => {
      destroy();
      destroy();
    }).not.toThrow();
  });
});

describe('ToneLyrics — analysis vacío', () => {
  it('sin voces no crashea y pinta estado vacío', () => {
    const { el, setActiveTime, destroy } = createToneLyrics({
      analysis: { voices_present: [], voices: {} },
    });
    expect(el.querySelector('.tone-lyrics__empty')).toBeTruthy();
    expect(() => setActiveTime(1)).not.toThrow();
    expect(() => destroy()).not.toThrow();
  });

  it('analysis null no crashea', () => {
    expect(() => createToneLyrics({ analysis: null })).not.toThrow();
  });
});

describe('ToneLyrics — voz secundaria más corta que la base', () => {
  it('renderiza la base completa sin crashear cuando una voz tiene menos líneas/sílabas', () => {
    const analysis = {
      voices_present: ['lead', 'backing'],
      voices: {
        lead: {
          lines: [
            {
              syllables: [
                { text: 'Me', start: 0.31, end: 0.44, blank: false, ditto: false, note: 'C4' },
                { text: 'he', start: 0.44, end: 0.55, blank: false, ditto: false, note: 'C4' },
              ],
            },
            {
              syllables: [
                { text: 'Oh', start: 1.0, end: 1.2, blank: false, ditto: false, note: 'E4' },
              ],
            },
          ],
        },
        // Voz más corta: una sola línea, con menos sílabas que la línea 0 de
        // la base. Las sílabas de lead sin contraparte no deben mostrar nota
        // de esta voz (optional chaining), y la línea 1 de la base tampoco
        // crashea al no existir línea 1 en backing.
        backing: {
          lines: [
            {
              syllables: [
                { text: 'Me', start: 0.31, end: 0.44, blank: false, ditto: false, note: 'G3' },
              ],
            },
          ],
        },
      },
    };

    let result;
    expect(() => {
      result = createToneLyrics({ analysis });
    }).not.toThrow();

    const { el } = result;
    const lines = el.querySelectorAll('.tone-line');
    expect(lines.length).toBe(2);
    expect(el.textContent).toContain('Me');
    expect(el.textContent).toContain('he');
    expect(el.textContent).toContain('Oh');

    // 1ra sílaba de la línea 0 tiene nota en ambas voces.
    const firstSyl = lines[0].querySelectorAll('.tone-syl')[0];
    expect(firstSyl.querySelector('.tone-note--lead').textContent).toBe('C4');
    expect(firstSyl.querySelector('.tone-note--alt').textContent).toBe('G3');

    // 2da sílaba de la línea 0 ("he") no tiene contraparte en backing: solo
    // muestra la nota de lead.
    const secondSyl = lines[0].querySelectorAll('.tone-syl')[1];
    expect(secondSyl.querySelector('.tone-note--lead').textContent).toBe('C4');
    expect(secondSyl.querySelector('.tone-note--alt')).toBeNull();

    // Línea 1 ("Oh") no existe en backing: solo nota de lead, sin crash.
    const ohSyl = lines[1].querySelector('.tone-syl');
    expect(ohSyl.querySelector('.tone-note--lead').textContent).toBe('E4');
    expect(ohSyl.querySelector('.tone-note--alt')).toBeNull();
  });
});
