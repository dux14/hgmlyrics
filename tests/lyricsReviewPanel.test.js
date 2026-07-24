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

function line(text, overrides = {}) {
  return {
    text,
    startMs: null,
    endMs: null,
    words: [],
    confidence: null,
    vocalization: false,
    breath: false,
    manualStartMs: null,
    ...overrides,
  };
}

/** Doc v2: dos secciones, la primera con dos renglones (uno con confidence
 * conocida) y la segunda con un renglón — suficiente para ejercitar
 * cruce de sección en moveLine. */
function baseReview() {
  return {
    version: 2,
    sections: [
      {
        type: 'chorus',
        label: null,
        startMs: 0,
        endMs: 1000,
        lines: [
          line('y en la noche oscura brillara', { confidence: 0.837 }),
          line('una linea larga de prueba', { confidence: null }),
        ],
      },
      {
        type: 'verse',
        label: null,
        startMs: 1000,
        endMs: 2000,
        lines: [line('otra linea')],
      },
    ],
  };
}

function pendingResult(overrides = {}) {
  return { review: baseReview(), canApprove: false, suggestions: [], ...overrides };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('LyricsReviewPanel', () => {
  beforeEach(() => {
    getLyricsReview.mockResolvedValue(pendingResult());
    sendLyricsAction.mockResolvedValue({
      review: baseReview(),
      canApprove: true,
    });
  });

  it('renderiza el select de tipo de sección con clase por tipo y el tipo actual preseleccionado', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);
    const select = el.querySelector('.section-chorus');
    expect(select).not.toBeNull();
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('chorus');
    expect(select.selectedOptions[0].textContent).toBe('CORO');
  });

  it('(a) muestra la confianza por renglón: porcentaje redondeado, o — cuando es null', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);
    const confEls = el.querySelectorAll('.lrp__conf');
    expect(confEls.length).toBe(3);
    expect(confEls[0].textContent).toBe('84%');
    expect(confEls[1].textContent).toBe('—');
  });

  it('(b) click en la tijera de sugerencia despacha splitLine', async () => {
    getLyricsReview.mockResolvedValue(
      pendingResult({ suggestions: [{ section: 0, line: 1, afterWords: [1] }] }),
    );
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const splitBtn = el.querySelector('.lrp__split');
    expect(splitBtn).not.toBeNull();
    splitBtn.click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'splitLine',
      section: 0,
      line: 1,
      afterWord: 1,
    });
  });

  it('muestra la propuesta de texto y aceptarla dispara editLine', async () => {
    getLyricsReview.mockResolvedValue(
      pendingResult({
        canApprove: true,
        textSuggestions: [
          { section: 0, line: 0, text: 'y en la noche oscura brillará', score: 0.58 },
        ],
      }),
    );
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const proposal = el.querySelector('.lrp__suggest');
    expect(proposal).not.toBeNull();
    expect(proposal.textContent).toContain('y en la noche oscura brillará');

    proposal.querySelector('.lrp__suggest-accept').click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'editLine',
      section: 0,
      line: 0,
      text: 'y en la noche oscura brillará',
    });
  });

  // BLOCKER review tanda C: performAction hace `state = {...state, ...result}`
  // — si el PUT de una acción que reordena índices (acá deleteLine) no trae
  // suggestions/textSuggestions recalculadas, el spread conserva las del
  // último GET (indexadas contra el documento VIEJO) y `render()` las pinta
  // sobre la fila equivocada del documento NUEVO. Este test reproduce el
  // escenario real completo: borrar un renglón corre la textSuggestion de la
  // línea 1 a la línea 0, y aceptarla ahí debe escribir el texto correcto en
  // esa fila (no arrastrar la propuesta vieja).
  it('aceptar una propuesta después de deleteLine (reordena índices) escribe el texto correcto en el renglón correcto', async () => {
    // Documento inicial: sección 0 con 2 renglones; el segundo (índice 1)
    // tiene una propuesta de texto.
    getLyricsReview.mockResolvedValue(
      pendingResult({
        textSuggestions: [
          { section: 0, line: 1, text: 'texto correcto de la semilla', score: 0.6 },
        ],
      }),
    );
    // El PUT de deleteLine borra el renglón 0: el que era línea 1 pasa a ser
    // línea 0. El backend (ya con el fix) recalcula la propuesta contra el
    // documento resultante — ahora apunta a section:0/line:0.
    const afterDelete = {
      version: 2,
      sections: [
        {
          type: 'chorus',
          label: null,
          startMs: 0,
          endMs: 1000,
          lines: [line('una linea larga de prueba', { confidence: null })],
        },
        {
          type: 'verse',
          label: null,
          startMs: 1000,
          endMs: 2000,
          lines: [line('otra linea')],
        },
      ],
    };
    sendLyricsAction.mockResolvedValue({
      review: afterDelete,
      canApprove: true,
      suggestions: [],
      textSuggestions: [{ section: 0, line: 0, text: 'texto correcto de la semilla', score: 0.6 }],
    });

    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    // Borra el primer renglón de la sección 0 (window.confirm mockeado en true).
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const firstRow = el.querySelector('[data-section="0"].lrp__line-row');
    firstRow.querySelector('.lrp__line-delete').click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'deleteLine',
      section: 0,
      line: 0,
    });

    // Tras el render con el resultado del PUT, la propuesta debe aparecer en
    // la fila que ahora es section:0/line:0 (el renglón sobreviviente).
    const proposalRow = el.querySelector('[data-section="0"][data-line="0"].lrp__line-row');
    expect(proposalRow.textContent).toContain('texto correcto de la semilla');

    proposalRow.querySelector('.lrp__suggest-accept').click();
    await flush();

    // El accept debe escribir sobre section:0/line:0 (el renglón que la fila
    // representa en el documento NUEVO), con el texto correcto — no sobre un
    // índice viejo ni con un texto stale de antes del borrado.
    expect(sendLyricsAction).toHaveBeenLastCalledWith('song-1', {
      type: 'editLine',
      section: 0,
      line: 0,
      text: 'texto correcto de la semilla',
    });
  });

  it('(c) "Unir con el siguiente renglón" despacha mergeLines', async () => {
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

  it('(d) editar renglón: lápiz muestra un textarea, "Guardar" despacha setLineText', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const editBtn = el.querySelector('.lrp__line-edit');
    expect(editBtn).not.toBeNull();
    editBtn.click();

    const input = el.querySelector('.lrp__edit-input');
    expect(input).not.toBeNull();
    expect(input.value).toBe('y en la noche oscura brillara');
    input.value = 'texto corregido';

    const saveBtn = el.querySelector('.lrp__edit-save');
    saveBtn.click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'setLineText',
      section: 0,
      line: 0,
      text: 'texto corregido',
    });
  });

  it('(e) el select de tipo de sección despacha setSectionType', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const select = el.querySelector('.lrp__type-select');
    select.value = 'bridge';
    select.dispatchEvent(new Event('change'));
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'setSectionType',
      section: 0,
      sectionType: 'bridge',
    });
  });

  it('(f) el botón de vocalización despacha toggleVocalization', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const vocBtn = el.querySelector('.lrp__line-voc');
    expect(vocBtn).not.toBeNull();
    vocBtn.click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'toggleVocalization',
      section: 0,
      line: 0,
    });
  });

  it('(g) mover abajo el último renglón de una sección cruza a la siguiente sección con toLine 0', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    // Última línea de la sección 0 (índice 1) — segunda de sus dos filas.
    const lastLineRow = el.querySelectorAll('[data-section="0"].lrp__line-row');
    const downBtn = lastLineRow[lastLineRow.length - 1].querySelector('.lrp__line-down');
    expect(downBtn.disabled).toBe(false);
    downBtn.click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'moveLine',
      fromSection: 0,
      fromLine: 1,
      toSection: 1,
      toLine: 0,
    });
  });

  it('(g) mover arriba el primer renglón de una sección cruza a fin de la sección anterior', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const firstLineOfSecondSection = el.querySelector('[data-section="1"].lrp__line-row');
    const upBtn = firstLineOfSecondSection.querySelector('.lrp__line-up');
    expect(upBtn.disabled).toBe(false);
    upBtn.click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'moveLine',
      fromSection: 1,
      fromLine: 0,
      toSection: 0,
      toLine: 2,
    });
  });

  it('(g) mover abajo un renglón que no es el último de la sección se queda dentro de la misma sección', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const rows = el.querySelectorAll('[data-section="0"].lrp__line-row');
    const downBtn = rows[0].querySelector('.lrp__line-down');
    downBtn.click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'moveLine',
      fromSection: 0,
      fromLine: 0,
      toSection: 0,
      toLine: 1,
    });
  });

  it('(g) el primer renglón de la primera sección no puede moverse arriba (botón deshabilitado)', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const firstRow = el.querySelector('[data-section="0"].lrp__line-row');
    const upBtn = firstRow.querySelector('.lrp__line-up');
    expect(upBtn.disabled).toBe(true);
  });

  it('(g) el último renglón de la última sección no puede moverse abajo (botón deshabilitado)', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const lastLineRow = el.querySelectorAll('[data-section="1"].lrp__line-row');
    const downBtn = lastLineRow[lastLineRow.length - 1].querySelector('.lrp__line-down');
    expect(downBtn.disabled).toBe(true);
  });

  it('(h) borrar renglón despacha deleteLine tras confirmar', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const deleteBtn = el.querySelector('.lrp__line-delete');
    deleteBtn.click();
    await flush();

    expect(confirmSpy).toHaveBeenCalled();
    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'deleteLine',
      section: 0,
      line: 0,
    });
    confirmSpy.mockRestore();
  });

  it('(h) borrar renglón NO despacha nada si se cancela la confirmación', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.lrp__line-delete').click();
    await flush();

    expect(sendLyricsAction).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('(i) "Aprobar letra" está habilitado exactamente cuando canApprove es true', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: false }));
    let el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);
    expect(el.querySelector('.lrp__approve').disabled).toBe(true);

    document.body.innerHTML = '';
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);
    expect(el.querySelector('.lrp__approve').disabled).toBe(false);
  });

  it('click en Aprobar letra abre la confirmación y, al confirmar, llama approveLyrics y onApproved', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    approveLyrics.mockResolvedValue({ success: true });
    const onApproved = vi.fn();
    const el = await LyricsReviewPanel({ songId: 'song-1', onApproved });
    document.body.appendChild(el);

    el.querySelector('.lrp__approve').click();
    expect(el.querySelector('.lps')).toBeTruthy();
    expect(approveLyrics).not.toHaveBeenCalled();

    el.querySelector('.lps__confirm').click();
    await flush();

    expect(approveLyrics).toHaveBeenCalledWith('song-1');
    expect(onApproved).toHaveBeenCalled();
  });

  it('Aprobar abre la confirmación y no llama al backend hasta confirmar', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    approveLyrics.mockResolvedValue({ success: true });

    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.append(el);

    el.querySelector('.lrp__approve').click();
    await vi.waitFor(() => expect(el.querySelector('.lps')).toBeTruthy());
    expect(approveLyrics).not.toHaveBeenCalled();

    el.querySelector('.lps__confirm').click();
    await vi.waitFor(() => expect(approveLyrics).toHaveBeenCalledTimes(1));
  });

  it('con el preview abierto, el panel queda bloqueado: togglear vocalización no lo destruye ni despacha la acción', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.lrp__approve').click();
    expect(el.querySelector('.lps')).toBeTruthy();

    el.querySelector('.lrp__line-voc').click();
    await flush();

    expect(el.querySelector('.lps')).toBeTruthy();
    expect(sendLyricsAction).not.toHaveBeenCalled();
  });

  it('clicks repetidos en Aprobar letra no apilan varias confirmaciones', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const approveBtn = el.querySelector('.lrp__approve');
    approveBtn.click();
    approveBtn.click();

    expect(el.querySelectorAll('.lps').length).toBe(1);
  });

  it('el audio del preview se pausa al volver a editar', async () => {
    getLyricsReview.mockResolvedValue(
      pendingResult({ canApprove: true, vocalsUrl: 'https://example.com/vocals.mp3' }),
    );
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.lrp__approve').click();
    const audio = el.querySelector('.lps__audio');
    const pauseSpy = vi.spyOn(audio, 'pause');

    el.querySelector('.lps__back').click();

    expect(pauseSpy).toHaveBeenCalled();
  });

  it('el audio del preview se pausa al confirmar el approve', async () => {
    getLyricsReview.mockResolvedValue(
      pendingResult({ canApprove: true, vocalsUrl: 'https://example.com/vocals.mp3' }),
    );
    approveLyrics.mockResolvedValue({ success: true });
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.lrp__approve').click();
    const audio = el.querySelector('.lps__audio');
    const pauseSpy = vi.spyOn(audio, 'pause');

    el.querySelector('.lps__confirm').click();
    await flush();

    expect(pauseSpy).toHaveBeenCalled();
  });

  it('abrir la confirmación mueve el foco dentro de ella', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.lrp__approve').click();

    expect(document.activeElement).toBe(el.querySelector('.lps'));
  });

  it('volver a editar cierra la confirmación sin aprobar', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));

    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.append(el);

    el.querySelector('.lrp__approve').click();
    await vi.waitFor(() => expect(el.querySelector('.lps')).toBeTruthy());
    el.querySelector('.lps__back').click();

    expect(el.querySelector('.lps')).toBeNull();
    expect(approveLyrics).not.toHaveBeenCalled();
  });

  it('(j) no existen tarjetas .conf ni .voc en el DOM (contrato v1 eliminado)', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);
    expect(el.querySelector('.conf')).toBeNull();
    expect(el.querySelector('.voc')).toBeNull();
  });

  it('marca la clase lrp__line--vocalization cuando el renglón es vocalización', async () => {
    const review = baseReview();
    review.sections[0].lines[0].vocalization = true;
    getLyricsReview.mockResolvedValue(pendingResult());
    getLyricsReview.mockResolvedValue({ review, canApprove: false, suggestions: [] });

    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const firstRow = el.querySelector('[data-section="0"].lrp__line-row');
    expect(firstRow.classList.contains('lrp__line--vocalization')).toBe(true);
  });

  it('renombrar sección: el input de label despacha renameSection on-change', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const input = el.querySelector('.lrp__rename-input');
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('Nombre opcional');
    input.value = 'Coro final';
    input.dispatchEvent(new Event('change'));
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'renameSection',
      section: 0,
      label: 'Coro final',
    });
  });

  it('"Unir con la siguiente sección" solo aparece en secciones no-últimas y llama mergeSections', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const sections = el.querySelectorAll('.lrp__section');
    expect(sections.length).toBe(2);
    expect(sections[0].querySelector('.lrp__section-merge')).not.toBeNull();
    expect(sections[1].querySelector('.lrp__section-merge')).toBeNull();

    const mergeBtns = el.querySelectorAll('.lrp__section-merge');
    expect(mergeBtns.length).toBe(1);

    mergeBtns[0].click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'mergeSections',
      section: 0,
    });
  });

  it('"Dividir aquí" aparece en cada línea no-última de la sección y llama splitSection', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const splitBtns = el.querySelectorAll('.lrp__section-split');
    // Sección 0 tiene 2 renglones -> 1 corte posible; sección 1 tiene 1 -> 0.
    expect(splitBtns.length).toBe(1);

    splitBtns[0].click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'splitSection',
      section: 0,
      afterLine: 0,
    });
  });

  it('doble click rápido en "Unir con la siguiente sección" no dispara doble llamada a sendLyricsAction', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const mergeBtn = el.querySelector('.lrp__section-merge');
    mergeBtn.click();
    mergeBtn.click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledTimes(1);
  });

  it('escapa HTML de una línea con < & " — se renderiza como texto, no como markup', async () => {
    const review = baseReview();
    review.sections[0].lines[0].text = '<script>alert("x")</script> & co';
    getLyricsReview.mockResolvedValue({ review, canApprove: true, suggestions: [] });

    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    expect(el.querySelector('script')).toBeNull();
    const lineEl = el.querySelector('.lrp__line');
    expect(lineEl.textContent).toBe('<script>alert("x")</script> & co');
  });

  it('editar renglón con textarea: Cmd/Ctrl+Enter despacha setLineText una sola vez con el texto multilínea completo', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.lrp__line-edit').click();
    const textarea = el.querySelector('.lrp__edit-input');
    expect(textarea.tagName).toBe('TEXTAREA');
    textarea.value = 'primera parte\nsegunda parte';

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }),
    );
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledTimes(1);
    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'setLineText',
      section: 0,
      line: 0,
      text: 'primera parte\nsegunda parte',
    });
  });

  it('editar renglón: Enter solo (sin modificador) no guarda', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.lrp__line-edit').click();
    const textarea = el.querySelector('.lrp__edit-input');
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await flush();

    expect(sendLyricsAction).not.toHaveBeenCalled();
    expect(el.querySelector('.lrp__edit-input')).not.toBeNull();
  });

  it('editar renglón: Escape cancela sin despachar', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.lrp__line-edit').click();
    const textarea = el.querySelector('.lrp__edit-input');
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await flush();

    expect(sendLyricsAction).not.toHaveBeenCalled();
    expect(el.querySelector('.lrp__edit-input')).toBeNull();
  });

  it('el selector de idioma despacha setLanguage con "en" y refleja el valor del doc', async () => {
    const el = await LyricsReviewPanel({ songId: 'song-1' });
    document.body.appendChild(el);

    const select = el.querySelector('.lrp__language-select');
    expect(select).not.toBeNull();
    expect(select.value).toBe('es');

    select.value = 'en';
    select.dispatchEvent(new Event('change'));
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'setLanguage',
      language: 'en',
    });

    const review = baseReview();
    review.language = 'en';
    getLyricsReview.mockResolvedValue({ review, canApprove: false, suggestions: [] });
    const el2 = await LyricsReviewPanel({ songId: 'song-2' });
    document.body.appendChild(el2);
    expect(el2.querySelector('.lrp__language-select').value).toBe('en');
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
