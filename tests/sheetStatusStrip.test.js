import { describe, it, expect, vi } from 'vitest';
import { SheetStatusStrip } from '../src/components/pipeline/lyrics/SheetStatusStrip.js';
import { SCORE_THRESHOLD } from '../src/components/pipeline/ConfidenceSummary.js';

function line(text, extra = {}) {
  return { text, confidence: null, words: [], vocalization: false, ...extra };
}

function mkDoc(sections) {
  return { version: 2, sections };
}

describe('SheetStatusStrip', () => {
  it('cuenta renglones y secciones a través de 3 secciones', () => {
    const doc = mkDoc([
      { type: 'verso', lines: [line('a'), line('b')] },
      { type: 'coro', lines: [line('c')] },
      { type: 'instrumental', lines: [] },
    ]);
    const node = SheetStatusStrip({ doc, dudosoThreshold: SCORE_THRESHOLD, onJumpToDudoso: vi.fn() });

    expect(node.textContent).toContain('3 renglones');
    expect(node.textContent).toContain('3 secciones');
  });

  it('N dudosos usa el umbral importado de ConfidenceSummary', () => {
    const doc = mkDoc([
      {
        type: 'verso',
        lines: [
          line('a', { confidence: SCORE_THRESHOLD - 0.01, words: [{ text: 'a' }] }),
          line('b', { confidence: SCORE_THRESHOLD + 0.01, words: [{ text: 'b' }] }),
        ],
      },
    ]);
    const node = SheetStatusStrip({ doc, dudosoThreshold: SCORE_THRESHOLD, onJumpToDudoso: vi.fn() });

    expect(node.querySelector('.sheet-status-strip__dudosos').textContent).toContain('1 dudoso');
  });

  it('sin renglones dudosos, el indicador no se pinta', () => {
    const doc = mkDoc([
      { type: 'verso', lines: [line('a', { confidence: 0.9, words: [{ text: 'a' }] })] },
    ]);
    const node = SheetStatusStrip({ doc, dudosoThreshold: SCORE_THRESHOLD, onJumpToDudoso: vi.fn() });

    expect(node.querySelector('.sheet-status-strip__dudosos')).toBeNull();
  });

  it('N sin tiempo aparece solo si hay renglones sin words', () => {
    const sinWords = mkDoc([
      { type: 'verso', lines: [line('a', { words: [] }), line('b', { words: [{ text: 'b' }] })] },
    ]);
    const node = SheetStatusStrip({
      doc: sinWords,
      dudosoThreshold: SCORE_THRESHOLD,
      onJumpToDudoso: vi.fn(),
    });
    expect(node.querySelector('.sheet-status-strip__sin-tiempo').textContent).toContain(
      '1 sin tiempo',
    );

    const conWords = mkDoc([
      { type: 'verso', lines: [line('a', { words: [{ text: 'a' }] })] },
    ]);
    const node2 = SheetStatusStrip({
      doc: conWords,
      dudosoThreshold: SCORE_THRESHOLD,
      onJumpToDudoso: vi.fn(),
    });
    expect(node2.querySelector('.sheet-status-strip__sin-tiempo')).toBeNull();
  });

  it('las vocalizaciones no cuentan como dudosas', () => {
    const doc = mkDoc([
      {
        type: 'verso',
        lines: [line('la la', { vocalization: true, confidence: null, words: [] })],
      },
    ]);
    const node = SheetStatusStrip({ doc, dudosoThreshold: SCORE_THRESHOLD, onJumpToDudoso: vi.fn() });

    expect(node.querySelector('.sheet-status-strip__dudosos')).toBeNull();
  });

  it('tocar N dudosos llama a onJumpToDudoso con (sIdx, lIdx) del primer dudoso', () => {
    const onJumpToDudoso = vi.fn();
    const doc = mkDoc([
      { type: 'verso', lines: [line('a', { confidence: 0.9, words: [{ text: 'a' }] })] },
      {
        type: 'coro',
        lines: [
          line('b', { confidence: 0.9, words: [{ text: 'b' }] }),
          line('c', { confidence: 0.1, words: [{ text: 'c' }] }),
        ],
      },
    ]);
    const node = SheetStatusStrip({ doc, dudosoThreshold: SCORE_THRESHOLD, onJumpToDudoso });
    node.querySelector('.sheet-status-strip__dudosos').click();

    expect(onJumpToDudoso).toHaveBeenCalledWith(1, 1);
  });

  it('el chip Escuchar alterna y avisa su estado', () => {
    const onToggleListen = vi.fn();
    const doc = mkDoc([{ type: 'verso', lines: [line('a')] }]);
    const node = SheetStatusStrip({
      doc,
      dudosoThreshold: SCORE_THRESHOLD,
      onJumpToDudoso: vi.fn(),
      canListen: true,
      onToggleListen,
    });
    const chip = node.querySelector('.sheet-status-strip__listen');
    expect(chip.getAttribute('aria-pressed')).toBe('false');

    chip.click();
    expect(onToggleListen).toHaveBeenCalledTimes(1);

    node.setListening(true);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('sin voz aislada el chip Escuchar no se ofrece', () => {
    const doc = mkDoc([{ type: 'verso', lines: [line('a')] }]);
    const node = SheetStatusStrip({
      doc,
      dudosoThreshold: SCORE_THRESHOLD,
      onJumpToDudoso: vi.fn(),
      canListen: false,
    });

    expect(node.querySelector('.sheet-status-strip__listen')).toBeNull();
  });

  it('update(doc) recalcula los conteos', () => {
    const doc1 = mkDoc([{ type: 'verso', lines: [line('a')] }]);
    const node = SheetStatusStrip({ doc: doc1, dudosoThreshold: SCORE_THRESHOLD, onJumpToDudoso: vi.fn() });
    expect(node.textContent).toContain('1 renglón');

    const doc2 = mkDoc([
      { type: 'verso', lines: [line('a'), line('b')] },
      { type: 'coro', lines: [line('c', { confidence: 0.1, words: [{ text: 'c' }] })] },
    ]);
    node.update(doc2);

    expect(node.textContent).toContain('3 renglones');
    expect(node.textContent).toContain('2 secciones');
    expect(node.querySelector('.sheet-status-strip__dudosos').textContent).toContain('1 dudoso');
  });
});
