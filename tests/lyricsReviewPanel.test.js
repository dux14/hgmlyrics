import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLyricsReview, sendLyricsAction, approveLyrics } from '../src/lib/pipelineApi.js';

vi.mock('../src/lib/pipelineApi.js', () => ({
  getLyricsReview: vi.fn(),
  sendLyricsAction: vi.fn(),
  approveLyrics: vi.fn(),
}));

const { LyricsReviewPanel } = await import('../src/components/pipeline/LyricsReviewPanel.js');

function baseReview() {
  return {
    hasCanonical: true,
    temperature: 0.8,
    sections: [
      {
        type: 'chorus',
        label: null,
        temperature: 0.6,
        lines: [
          {
            text: 'y en la noche oscura brillara',
            conflict: true,
            vocalization: false,
            score: 0.6,
            sources: {
              db: 'y en la noche oscura brillara',
              canonical: 'y en la noche oscura brillara tu luz',
              trans: 'y en la noche oscura brillara tu luz',
            },
          },
        ],
      },
    ],
    vocalizations: [
      {
        text: 'Oooh—oh',
        anchorAfterLine: { section: 0, line: 0 },
        accepted: null,
      },
    ],
  };
}

function pendingResult() {
  const review = baseReview();
  return { review, temperature: 0.8, canApprove: false, suggestions: [] };
}

function resolvedResult() {
  const review = baseReview();
  review.sections[0].lines[0].conflict = false;
  review.sections[0].lines[0].text = review.sections[0].lines[0].sources.canonical;
  review.vocalizations[0].accepted = true;
  return { review, temperature: 1, canApprove: true };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('LyricsReviewPanel', () => {
  beforeEach(() => {
    getLyricsReview.mockResolvedValue(pendingResult());
  });

  it('renderiza labels de sección con clase por tipo', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);
    const label = el.querySelector('.section-chorus');
    expect(label).not.toBeNull();
    expect(label.textContent).toBe('CORO');
  });

  it('el conflicto muestra las variantes y 3 botones de acción', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);
    const conf = el.querySelector('.conf');
    expect(conf).not.toBeNull();
    expect(conf.querySelector('.old').textContent).toBe('y en la noche oscura brillara');
    expect(conf.querySelector('.new').textContent).toBe('y en la noche oscura brillara tu luz');
    const buttons = conf.querySelectorAll('button');
    expect(buttons.length).toBe(3);
    expect([...buttons].map((b) => b.textContent)).toEqual([
      'Usar canónica',
      'Mantener actual',
      'Editar línea',
    ]);
  });

  it('Aprobar letra está disabled cuando canApprove es false', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);
    const approveBtn = el.querySelector('.lrp__approve');
    expect(approveBtn.disabled).toBe(true);
    expect(approveBtn.textContent).toBe('Aprobar letra');
  });

  it('el header sticky muestra el contador de pendientes junto al pill de temperatura', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);
    const header = el.querySelector('.lrp__header');
    const headerPending = header.querySelector('.lrp__header-pending');
    const headerTemp = header.querySelector('.temp');
    expect(headerPending).not.toBeNull();
    // 1 conflicto + 1 vocalización sin decidir del fixture base.
    expect(headerPending.textContent).toBe('2 pendientes');
    expect(headerTemp.textContent).toBe('80%');
  });

  it('click en "Usar canónica" llama sendLyricsAction y habilita Aprobar al resolverse todo', async () => {
    sendLyricsAction.mockResolvedValue(resolvedResult());
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const useCanonicalBtn = [...el.querySelectorAll('.conf button')].find(
      (b) => b.textContent === 'Usar canónica',
    );
    useCanonicalBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'resolve',
      section: 0,
      line: 0,
      choice: 'canonical',
    });

    const approveBtn = el.querySelector('.lrp__approve');
    expect(approveBtn.disabled).toBe(false);
  });

  it('la tarjeta de vocalización tiene los botones Agregar/Descartar', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);
    const voc = el.querySelector('.voc');
    expect(voc).not.toBeNull();
    expect(voc.querySelector('.lab').textContent).toBe('LA AI ESCUCHÓ ADEMÁS');
    const buttons = [...voc.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Agregar como vocalización', 'Descartar']);
  });

  it('click en Aprobar letra llama approveLyrics y onApproved', async () => {
    sendLyricsAction.mockResolvedValue(resolvedResult());
    approveLyrics.mockResolvedValue({ success: true });
    const onApproved = vi.fn();
    const el = await LyricsReviewPanel({ songId: 'song-1', onApproved });
    document.body.appendChild(el);

    const useCanonicalBtn = [...el.querySelectorAll('.conf button')].find(
      (b) => b.textContent === 'Usar canónica',
    );
    useCanonicalBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    el.querySelector('.lrp__approve').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(approveLyrics).toHaveBeenCalledWith('song-1');
    expect(onApproved).toHaveBeenCalled();
  });
});
