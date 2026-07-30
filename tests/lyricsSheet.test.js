import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLyricsReview, sendLyricsAction, approveLyrics } from '../src/lib/pipelineApi.js';

vi.mock('../src/lib/pipelineApi.js', () => ({
  getLyricsReview: vi.fn(),
  sendLyricsAction: vi.fn(),
  approveLyrics: vi.fn(),
}));

vi.mock('../src/lib/toast.js', () => ({
  showToast: vi.fn(),
}));

// jsdom no implementa matchMedia; se fuerza reduce-motion para que las
// acciones de red no esperen la animación de colapso (~220ms) en cada test.
window.matchMedia = () => ({
  matches: true,
  media: '(prefers-reduced-motion: reduce)',
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
});

const { LyricsSheet } = await import('../src/components/pipeline/lyrics/LyricsSheet.js');
const { showToast } = await import('../src/lib/toast.js');

/** Flush de microtasks + un tick de macrotask. */
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
    ...overrides,
  };
}

function baseReview() {
  return {
    version: 2,
    language: 'es',
    sections: [
      {
        type: 'chorus',
        label: null,
        startMs: 0,
        endMs: 1000,
        lines: [line('primera linea'), line('segunda linea')],
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

describe('LyricsSheet', () => {
  beforeEach(() => {
    getLyricsReview.mockResolvedValue(pendingResult());
    sendLyricsAction.mockResolvedValue({ review: baseReview(), canApprove: true });
  });

  it('dos acciones simultáneas mandan un solo PUT', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const addBtn = el.querySelector('.sheet__add-section');
    addBtn.click();
    addBtn.click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledTimes(1);
  });

  it('una acción que cambia una sección deja intactos los nodos DOM de las otras', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const sectionsBefore = el.querySelectorAll('.sheet-section');
    const secondSectionBefore = sectionsBefore[1];

    sendLyricsAction.mockResolvedValueOnce({
      review: {
        ...baseReview(),
        sections: [
          { ...baseReview().sections[0], label: 'Coro nuevo' },
          baseReview().sections[1],
        ],
      },
      canApprove: true,
    });

    const nameInput = sectionsBefore[0].querySelector('.sheet-section__name');
    nameInput.value = 'Coro nuevo';
    nameInput.dispatchEvent(new Event('blur'));
    await flush();

    const sectionsAfter = el.querySelectorAll('.sheet-section');
    expect(sectionsAfter[1]).toBe(secondSectionBefore);
  });

  it('tras partir, el textarea abierto es el del renglón siguiente con selectionStart en 0', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const firstLine = el.querySelectorAll('.sheet-line')[0];
    firstLine.querySelector('.sheet-line__text').click();
    const textarea = firstLine.querySelector('.sheet-line__edit-input');
    textarea.value = 'primera\nlinea';
    textarea.selectionStart = 7;

    sendLyricsAction.mockResolvedValueOnce({
      review: {
        ...baseReview(),
        sections: [
          {
            ...baseReview().sections[0],
            lines: [line('primera'), line('linea'), line('segunda linea')],
          },
          baseReview().sections[1],
        ],
      },
      canApprove: false,
    });

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    const lines = el.querySelectorAll('.sheet-line');
    const openTextarea = lines[1].querySelector('.sheet-line__edit-input');
    expect(openTextarea).toBeTruthy();
    expect(openTextarea.selectionStart).toBe(0);
  });

  it('tras unir hacia arriba el caret cae en la longitud del texto de arriba', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const secondLine = el.querySelectorAll('.sheet-line')[1];
    secondLine.querySelector('.sheet-line__text').click();
    const textarea = secondLine.querySelector('.sheet-line__edit-input');
    textarea.selectionStart = 0;
    textarea.selectionEnd = 0;

    sendLyricsAction.mockResolvedValueOnce({
      review: {
        ...baseReview(),
        sections: [
          {
            ...baseReview().sections[0],
            lines: [line('primera linea segunda linea')],
          },
          baseReview().sections[1],
        ],
      },
      canApprove: false,
    });

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );
    await flush();

    const openTextarea = el.querySelector('.sheet-line .sheet-line__edit-input');
    expect(openTextarea).toBeTruthy();
    expect(openTextarea.selectionStart).toBe('primera linea'.length);
  });

  it('una acción de estructura con texto sucio llama a persistText antes que sendLyricsAction', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const firstLine = el.querySelectorAll('.sheet-line')[0];
    firstLine.querySelector('.sheet-line__text').click();
    const textarea = firstLine.querySelector('.sheet-line__edit-input');
    textarea.value = 'primera linea editada';

    sendLyricsAction.mockResolvedValue({ review: baseReview(), canApprove: true });

    // Dispara una acción de estructura (borrar sección) sin blur previo: el
    // texto sigue sucio en el textarea.
    const menuToggle = el.querySelector('.sheet-section__menu-toggle');
    menuToggle.click();
    el.querySelector('[data-action="delete"]').click();
    await flush();

    expect(sendLyricsAction.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(sendLyricsAction.mock.calls[0][1].type).toBe('setLineText');
    expect(sendLyricsAction.mock.calls[1][1].type).toBe('deleteSection');
  });

  it('un fallo de acción dispara resync y muestra el toast', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    sendLyricsAction.mockRejectedValueOnce(new Error('boom'));
    getLyricsReview.mockResolvedValueOnce(pendingResult({ canApprove: true }));

    el.querySelector('.sheet__add-section').click();
    await flush();

    expect(showToast).toHaveBeenCalled();
    expect(getLyricsReview).toHaveBeenCalledTimes(2);
  });

  it('el approve sigue pasando por la confirmación obligatoria y nunca se dispara directo', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.sheet__approve').click();
    await flush();

    expect(approveLyrics).not.toHaveBeenCalled();
    expect(el.querySelector('.lps')).toBeTruthy();
  });

  it('"Agregar sección" manda insertSection con at igual a la cantidad de secciones', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.sheet__add-section').click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', { type: 'insertSection', at: 2 });
  });

  it('el selector de idioma manda setLanguage', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const select = el.querySelector('.sheet__language-select');
    select.value = 'en';
    select.dispatchEvent(new Event('change'));
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', { type: 'setLanguage', language: 'en' });
  });

  it('con canApprove en falso el botón de aprobar está deshabilitado', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: false }));
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    expect(el.querySelector('.sheet__approve').disabled).toBe(true);
  });

  it('persistText serializa: nunca dos PUT de texto en vuelo al mismo tiempo', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    let inFlight = 0;
    let maxInFlight = 0;
    const deferreds = [];
    sendLyricsAction.mockImplementation((_songId, action) => {
      if (action.type !== 'setLineText') {
        return Promise.resolve({ review: baseReview(), canApprove: true });
      }
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) => {
        deferreds.push(() => {
          inFlight -= 1;
          resolve({ review: baseReview(), canApprove: true });
        });
      });
    });

    const lines = el.querySelectorAll('.sheet-line');
    lines[0].querySelector('.sheet-line__text').click();
    const ta0 = lines[0].querySelector('.sheet-line__edit-input');
    ta0.value = 'primera editada';
    ta0.dispatchEvent(new Event('blur'));

    // La segunda edición se abre sin esperar a la primera: persistText NO usa
    // state.busy, así que la hoja sigue editable mientras el primer PUT
    // sigue en vuelo.
    lines[1].querySelector('.sheet-line__text').click();
    const ta1 = lines[1].querySelector('.sheet-line__edit-input');
    ta1.value = 'segunda editada';
    ta1.dispatchEvent(new Event('blur'));
    await flush();

    // El segundo blur no debe haber disparado su PUT todavía: solo el
    // primero está en vuelo.
    expect(deferreds.length).toBe(1);
    expect(maxInFlight).toBe(1);

    deferreds[0]();
    await flush();

    // Recién ahora, con el primero resuelto, sale el segundo — nunca
    // solapados.
    expect(deferreds.length).toBe(2);
    expect(maxInFlight).toBe(1);

    deferreds[1]();
    await flush();
  });

  it('unlockControls no rehabilita un botón "Unir" que seguía sin destino válido', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    // Primer renglón de la primera sección: sin vecino arriba.
    const firstLine = el.querySelectorAll('.sheet-line')[0];
    firstLine.querySelector('.sheet-line__text').click();
    const textarea = firstLine.querySelector('.sheet-line__edit-input');
    textarea.setSelectionRange(0, 0);
    textarea.dispatchEvent(new Event('select'));

    const mergeBtn = firstLine.querySelector('[data-action="merge"]');
    expect(mergeBtn.disabled).toBe(true);

    // Una acción de estructura AJENA a esa sección (agregar una sección al
    // final) dispara lock/unlock global sin tocar la huella de la sección 0.
    sendLyricsAction.mockResolvedValueOnce({
      review: { ...baseReview(), sections: [...baseReview().sections, baseReview().sections[1]] },
      canApprove: true,
    });
    el.querySelector('.sheet__add-section').click();
    await flush();

    expect(mergeBtn.disabled).toBe(true);
  });

  it('tras Borrar, el foco no cae a body', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    sendLyricsAction.mockResolvedValueOnce({
      review: {
        ...baseReview(),
        sections: [
          { ...baseReview().sections[0], lines: [line('segunda linea')] },
          baseReview().sections[1],
        ],
      },
      canApprove: false,
    });

    // Borra el primer renglón (no el último de su sección), así la fila
    // sigue en el DOM (reusada para el renglón que quedó en su lugar).
    const firstLine = el.querySelectorAll('.sheet-line')[0];
    firstLine.querySelector('.sheet-line__text').click();
    firstLine.querySelector('[data-action="delete"]').click();
    await flush();

    expect(document.activeElement).not.toBe(document.body);
  });

  // Auditoría de cobertura tests/lyricsReviewPanel.test.js (Task 5): la
  // confirmación previa al approve (LyricsPreviewStep) ya tenía su propia
  // suite (tests/lyricsPreviewStep.test.js) para el marcado y los callbacks
  // genéricos, pero la orquestación puntual de LyricsSheet (pausar el
  // audio, mover el foco, no apilar confirmaciones, bloquear el resto de la
  // hoja) no tenía equivalente tras la reescritura.
  it('confirmar en el preview llama approveLyrics y onApproved', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    approveLyrics.mockResolvedValue({ success: true });
    const onApproved = vi.fn();
    const el = await LyricsSheet({ songId: 'song-1', onApproved });
    document.body.appendChild(el);

    el.querySelector('.sheet__approve').click();
    el.querySelector('.lps__confirm').click();
    await flush();

    expect(approveLyrics).toHaveBeenCalledWith('song-1');
    expect(onApproved).toHaveBeenCalled();
  });

  it('volver a editar desde el preview cierra la confirmación sin aprobar', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.sheet__approve').click();
    el.querySelector('.lps__back').click();

    expect(el.querySelector('.lps')).toBeNull();
    expect(approveLyrics).not.toHaveBeenCalled();
  });

  it('clicks repetidos en Aprobar letra no apilan varias confirmaciones', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const approveBtn = el.querySelector('.sheet__approve');
    approveBtn.click();
    approveBtn.click();

    expect(el.querySelectorAll('.lps').length).toBe(1);
  });

  it('con el preview abierto, la hoja queda bloqueada: editar un renglón no despacha nada', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.sheet__approve').click();
    expect(el.querySelector('.lps')).toBeTruthy();

    el.querySelector('.sheet-line__text').click();
    await flush();

    expect(el.querySelector('.lps')).toBeTruthy();
    expect(el.querySelector('.sheet-line__edit-input')).toBeNull();
    expect(sendLyricsAction).not.toHaveBeenCalled();
  });

  it('abrir la confirmación mueve el foco dentro de ella', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.sheet__approve').click();

    expect(document.activeElement).toBe(el.querySelector('.lps'));
  });

  it('el audio del preview se pausa al volver a editar', async () => {
    getLyricsReview.mockResolvedValue(
      pendingResult({ canApprove: true, vocalsUrl: 'https://example.com/vocals.mp3' }),
    );
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.sheet__approve').click();
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
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.sheet__approve').click();
    const audio = el.querySelector('.lps__audio');
    const pauseSpy = vi.spyOn(audio, 'pause');

    el.querySelector('.lps__confirm').click();
    await flush();

    expect(pauseSpy).toHaveBeenCalled();
  });

  it('el selector de idioma refleja el valor del documento cargado', async () => {
    getLyricsReview.mockResolvedValue(
      pendingResult({ review: { ...baseReview(), language: 'en' } }),
    );
    const el = await LyricsSheet({ songId: 'song-2' });
    document.body.appendChild(el);

    expect(el.querySelector('.sheet__language-select').value).toBe('en');
  });

  it('muestra un mensaje de error si falla la carga inicial, sin crashear', async () => {
    getLyricsReview.mockRejectedValueOnce(new Error('No se pudo cargar la revisión de letra'));

    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const errorEl = el.querySelector('.sheet__error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toBe('No se pudo cargar la revisión de letra');
    expect(el.querySelector('.sheet__approve')).toBeNull();
  });

  it('el estado de error trae un botón Reintentar que invoca onRetry', async () => {
    getLyricsReview.mockRejectedValueOnce(new Error('boom'));
    const onRetry = vi.fn();

    const el = await LyricsSheet({ songId: 'song-1', onRetry });
    document.body.appendChild(el);

    const retryBtn = el.querySelector('.sheet__error-retry');
    expect(retryBtn).not.toBeNull();
    retryBtn.click();

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
