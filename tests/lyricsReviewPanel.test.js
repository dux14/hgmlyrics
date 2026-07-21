import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLyricsReview, sendLyricsAction, approveLyrics } from '../src/lib/pipelineApi.js';

vi.mock('../src/lib/pipelineApi.js', () => ({
  getLyricsReview: vi.fn(),
  sendLyricsAction: vi.fn(),
  approveLyrics: vi.fn(),
}));

// jsdom no implementa matchMedia; se fuerza reduce-motion para que las
// acciones de red no esperen la animación de colapso (~220ms) en cada test
// — el motion en sí (gateado por esta misma preferencia) no se prueba acá.
window.matchMedia = () => ({
  matches: true,
  media: '(prefers-reduced-motion: reduce)',
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
});

const { LyricsReviewPanel } = await import('../src/components/pipeline/LyricsReviewPanel.js');

/** Flush de microtasks + un tick de macrotask: robusto sin depender de
 * cuántos `await` internos tiene la cadena runAction→performAction→fetch. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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
    await flush();

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
    await flush();

    el.querySelector('.lrp__approve').click();
    await flush();

    expect(approveLyrics).toHaveBeenCalledWith('song-1');
    expect(onApproved).toHaveBeenCalled();
  });

  it('escapa HTML de una línea con < & " — se renderiza como texto, no como markup', async () => {
    const review = baseReview();
    review.sections[0].lines[0].conflict = false;
    review.sections[0].lines[0].text = '<script>alert("x")</script> & co';
    getLyricsReview.mockResolvedValue({
      review,
      temperature: 1,
      canApprove: true,
      suggestions: [],
    });

    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    expect(el.querySelector('script')).toBeNull();
    const line = el.querySelector('.lrp__line');
    expect(line.textContent).toBe('<script>alert("x")</script> & co');
  });

  it('click en el tijera de división llama sendLyricsAction con el payload exacto de splitLine', async () => {
    const review = baseReview();
    review.sections[0].lines[0].conflict = false;
    review.sections[0].lines[0].text = 'una linea larga de prueba';
    getLyricsReview.mockResolvedValue({
      review,
      temperature: 1,
      canApprove: true,
      suggestions: [{ section: 0, line: 0, afterWords: [1] }],
    });
    sendLyricsAction.mockResolvedValue({
      review,
      temperature: 1,
      canApprove: true,
    });

    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const splitBtn = el.querySelector('.lrp__split');
    expect(splitBtn).not.toBeNull();
    splitBtn.click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'splitLine',
      section: 0,
      line: 0,
      afterWord: 1,
    });
  });

  it('click en "Unir con el siguiente renglón" llama sendLyricsAction con el payload exacto de mergeLines', async () => {
    const review = baseReview();
    review.sections[0].lines = [
      { text: 'primer renglon', conflict: false, vocalization: false, score: 1, sources: {} },
      { text: 'segundo renglon', conflict: false, vocalization: false, score: 1, sources: {} },
    ];
    review.vocalizations = [];
    getLyricsReview.mockResolvedValue({
      review,
      temperature: 1,
      canApprove: true,
      suggestions: [],
    });
    sendLyricsAction.mockResolvedValue({ review, temperature: 1, canApprove: true });

    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const mergeBtn = el.querySelector('.lrp__merge');
    expect(mergeBtn).not.toBeNull();
    mergeBtn.click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'mergeLines',
      section: 0,
      line: 0,
    });
  });

  it('"Agregar como vocalización" llama sendLyricsAction con el payload exacto de acceptVocalization', async () => {
    sendLyricsAction.mockResolvedValue(resolvedResult());
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.lrp__voc-accept').click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'acceptVocalization',
      index: 0,
      section: 0,
      afterLine: 0,
    });
  });

  it('"Descartar" llama sendLyricsAction con el payload exacto de rejectVocalization', async () => {
    sendLyricsAction.mockResolvedValue(resolvedResult());
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.lrp__voc-reject').click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'rejectVocalization',
      index: 0,
    });
  });

  it('muestra un mensaje de error si falla la carga inicial, sin crashear', async () => {
    getLyricsReview.mockRejectedValueOnce(new Error('No se pudo cargar la revisión de letra'));

    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const errorEl = el.querySelector('.lrp__error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toBe('No se pudo cargar la revisión de letra');
    expect(el.querySelector('.lrp__approve')).toBeNull();
  });
});
