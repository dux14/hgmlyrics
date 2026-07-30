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
});
