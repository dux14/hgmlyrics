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

// Fake de SheetAudio (S3b-ii): expone las mismas spies que el contrato real
// (open/close/isOpen/seek/onTime/destroy) más `emitTime(sec)`, que dispara
// los callbacks registrados vía onTime — así los tests de audio no dependen
// de MultiTrackPlayer ni de <audio> real.
vi.mock('../src/components/pipeline/lyrics/SheetAudio.js', () => ({
  SheetAudio: vi.fn(),
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
const { SheetAudio } = await import('../src/components/pipeline/lyrics/SheetAudio.js');

function makeFakeAudio() {
  let open = false;
  const timeCbs = new Set();
  return {
    el: document.createElement('div'),
    open: vi.fn(() => {
      open = true;
    }),
    close: vi.fn(() => {
      open = false;
    }),
    isOpen: () => open,
    seek: vi.fn(),
    onTime: vi.fn((cb) => {
      timeCbs.add(cb);
      return () => timeCbs.delete(cb);
    }),
    destroy: vi.fn(),
    emitTime(sec) {
      for (const cb of [...timeCbs]) cb(sec);
    },
  };
}

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
        sections: [{ ...baseReview().sections[0], label: 'Coro nuevo' }, baseReview().sections[1]],
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

  it('el approve sigue pasando por el modo lectura y nunca se dispara directo', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.sheet__approve').click();
    await flush();

    expect(approveLyrics).not.toHaveBeenCalled();
    expect(el.querySelector('.sheet__confirm')).toBeTruthy();
  });

  it('"Aprobar letra" sin blur previo persiste el texto sucio antes de entrar a lectura', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const firstLine = el.querySelectorAll('.sheet-line')[0];
    firstLine.querySelector('.sheet-line__text').click();
    const textarea = firstLine.querySelector('.sheet-line__edit-input');
    textarea.value = 'primera linea recien tecleada';
    // Sin blur: el textarea sigue enfocado y con texto sucio sin persistir.

    sendLyricsAction.mockResolvedValueOnce({
      review: {
        ...baseReview(),
        sections: [
          {
            ...baseReview().sections[0],
            lines: [line('primera linea recien tecleada'), line('segunda linea')],
          },
          baseReview().sections[1],
        ],
      },
      canApprove: true,
    });

    // Click directo en "Aprobar letra", sin desenfocar el renglón antes.
    el.querySelector('.sheet__approve').click();
    await flush();

    // El PUT de texto salió (persistText, vía flushAllLines) antes de que
    // apareciera cualquier PUT de la acción de aprobar (approveLyrics es una
    // llamada aparte, todavía no disparada acá — el modo lectura es solo
    // confirmación).
    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'setLineText',
      section: 0,
      line: 0,
      text: 'primera linea recien tecleada',
    });
    expect(approveLyrics).not.toHaveBeenCalled();

    // La hoja en modo lectura YA muestra el texto recién tecleado — no el
    // que había antes del último tecleo.
    expect(el.querySelector('.sheet__confirm')).toBeTruthy();
    expect(el.textContent).toContain('primera linea recien tecleada');
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

    expect(sendLyricsAction).toHaveBeenCalledWith('song-1', {
      type: 'setLanguage',
      language: 'en',
    });
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
  // confirmación previa al approve, hoy la misma hoja en modo lectura
  // (S3b-ii, retira LyricsPreviewStep) — ver el describe "modo lectura" más
  // abajo para el marcado y la orquestación puntual (mover el foco, no
  // apilar transiciones, bloquear el resto de la hoja).
  it('confirmar en modo lectura llama approveLyrics y onApproved', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    approveLyrics.mockResolvedValue({ success: true });
    const onApproved = vi.fn();
    const el = await LyricsSheet({ songId: 'song-1', onApproved });
    document.body.appendChild(el);

    // enterReadOnly() es async (espera flushAllLines() antes de repintar en
    // lectura, ver el fix de "Aprobar letra puede confirmar una letra
    // desactualizada"): un `await flush()` tras el click es necesario para
    // que `.sheet__confirm` ya exista en el DOM.
    el.querySelector('.sheet__approve').click();
    await flush();
    el.querySelector('.sheet__confirm').click();
    await flush();

    expect(approveLyrics).toHaveBeenCalledWith('song-1');
    expect(onApproved).toHaveBeenCalled();
  });

  it('volver a editar sale de lectura sin aprobar', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.sheet__approve').click();
    await flush();
    el.querySelector('.sheet__back').click();

    expect(el.querySelector('.sheet__confirm')).toBeNull();
    expect(el.querySelector('.sheet__approve')).toBeTruthy();
    expect(approveLyrics).not.toHaveBeenCalled();
  });

  it('clicks repetidos en Aprobar letra no apilan varias transiciones', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const approveBtn = el.querySelector('.sheet__approve');
    approveBtn.click();
    approveBtn.click();
    await flush();

    expect(el.querySelectorAll('.sheet__confirm').length).toBe(1);
  });

  it('con la hoja en lectura, tocar un renglón no despacha nada de edición', async () => {
    getLyricsReview.mockResolvedValue(pendingResult({ canApprove: true }));
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    el.querySelector('.sheet__approve').click();
    await flush();
    expect(el.querySelector('.sheet__confirm')).toBeTruthy();

    el.querySelector('.sheet-line__text').click();
    await flush();

    expect(el.querySelector('.sheet-line__edit-input')).toBeNull();
    expect(sendLyricsAction).not.toHaveBeenCalled();
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

describe('mover renglones con los chevrones', () => {
  beforeEach(() => {
    getLyricsReview.mockResolvedValue(pendingResult());
  });

  it('mover abajo dentro de la sección manda moveLine con el índice siguiente', async () => {
    sendLyricsAction.mockResolvedValue({ review: baseReview(), canApprove: false });
    const el = await LyricsSheet({ songId: 'abc' });
    document.body.appendChild(el);
    await flush();

    el.querySelectorAll('.sheet-line__text')[0].click();
    await flush();
    el.querySelector('[data-action="move-down"]').click();
    await flush();

    expect(sendLyricsAction).toHaveBeenCalledWith('abc', {
      type: 'moveLine',
      fromSection: 0,
      fromLine: 0,
      toSection: 0,
      toLine: 1,
    });
  });

  it('el primer renglón de una sección sube cruzando al final de la anterior', async () => {
    sendLyricsAction.mockResolvedValue({ review: baseReview(), canApprove: false });
    const el = await LyricsSheet({ songId: 'abc' });
    document.body.appendChild(el);
    await flush();

    el.querySelectorAll('.sheet-section')[1].querySelectorAll('.sheet-line__text')[0].click();
    await flush();
    el.querySelectorAll('.sheet-section')[1].querySelector('[data-action="move-up"]').click();
    await flush();

    const call = sendLyricsAction.mock.calls.at(-1)[1];
    expect(call.type).toBe('moveLine');
    expect(call.fromSection).toBe(1);
    expect(call.fromLine).toBe(0);
    expect(call.toSection).toBe(0);
    expect(call.toLine).toBe(baseReview().sections[0].lines.length);
  });

  it('el grip es un botón accesible por teclado', async () => {
    const el = await LyricsSheet({ songId: 'abc' });
    document.body.appendChild(el);
    await flush();

    const grip = el.querySelector('.sheet-line__grip');
    expect(grip.tagName).toBe('BUTTON');
    expect(grip.getAttribute('aria-label')).toBeTruthy();
    expect(grip.hasAttribute('aria-hidden')).toBe(false);
  });

  it('tocar el grip no abre la edición del renglón', async () => {
    const el = await LyricsSheet({ songId: 'abc' });
    document.body.appendChild(el);
    await flush();

    el.querySelector('.sheet-line__grip').click();
    await flush();

    expect(el.querySelector('.sheet-line--editing')).toBeNull();
  });
});

describe('LyricsSheet — audio (S3b-ii)', () => {
  let audio;

  function timedReview() {
    return {
      version: 2,
      language: 'es',
      sections: [
        {
          type: 'chorus',
          label: null,
          startMs: 0,
          endMs: 10000,
          lines: [line('primera linea'), line('segunda linea')],
        },
        {
          type: 'instrumental',
          label: null,
          startMs: 20000,
          endMs: 30000,
          lines: [],
        },
        {
          type: 'verse',
          label: null,
          startMs: 30000,
          endMs: 40000,
          lines: [line('otra linea')],
        },
      ],
    };
  }

  function timedTimings() {
    return [
      { i: 0, startMs: 1000, interpolated: false },
      { i: 1, startMs: 9000, interpolated: true },
      { i: 2, startMs: 32000, interpolated: false },
    ];
  }

  function timedPendingResult(overrides = {}) {
    return {
      review: timedReview(),
      canApprove: false,
      suggestions: [],
      timings: timedTimings(),
      ...overrides,
    };
  }

  beforeEach(() => {
    audio = makeFakeAudio();
    SheetAudio.mockReturnValue(audio);
    getLyricsReview.mockResolvedValue(timedPendingResult());
    sendLyricsAction.mockResolvedValue({
      review: timedReview(),
      canApprove: true,
      timings: timedTimings(),
    });
  });

  it('el tiempo del transporte mueve el resaltado sin repintar secciones', async () => {
    const el = await LyricsSheet({ songId: 's1', vocalsUrl: 'https://x/v.mp3' });
    document.body.appendChild(el);

    const antes = el.querySelectorAll('.sheet-line').length;

    // 15 s cae en la ventana del renglón interpolado (startMs 9000, hasta el
    // siguiente en 32000): sección 0, renglón 1.
    audio.emitTime(15);
    const sounding = el.querySelectorAll('.sheet-line.is-sounding');
    expect(sounding).toHaveLength(1);
    expect(sounding[0]).toBe(el.querySelectorAll('.sheet-line')[1]);

    // 25 s cae dentro del tramo instrumental (20000–30000): la banda suena,
    // ningún renglón.
    audio.emitTime(25);
    expect(el.querySelectorAll('.sheet-line.is-sounding')).toHaveLength(0);
    expect(el.querySelectorAll('.sheet-instrumental.is-sounding')).toHaveLength(1);

    expect(el.querySelectorAll('.sheet-line').length).toBe(antes);
  });

  it('listenFrom abre el transporte y salta al startMs interpolado del renglón', async () => {
    const el = await LyricsSheet({ songId: 's1', vocalsUrl: 'https://x/v.mp3' });
    document.body.appendChild(el);

    el.querySelectorAll('.sheet-line')[1].querySelector('.sheet-line__text').click();
    el.querySelector('[data-action="listen"]').click();

    expect(audio.open).toHaveBeenCalled();
    expect(audio.seek).toHaveBeenCalledWith(9000);
  });

  it('listenFrom salta igual con un renglón de tiempo real', async () => {
    const el = await LyricsSheet({ songId: 's1', vocalsUrl: 'https://x/v.mp3' });
    document.body.appendChild(el);

    el.querySelectorAll('.sheet-line')[0].querySelector('.sheet-line__text').click();
    el.querySelector('[data-action="listen"]').click();

    expect(audio.seek).toHaveBeenCalledWith(1000);
  });

  it('una acción de estructura reconstruye el timeline con los timings del PUT', async () => {
    const el = await LyricsSheet({ songId: 's1', vocalsUrl: 'https://x/v.mp3' });
    document.body.appendChild(el);

    // El PUT devuelve timings corridos: ahora 15 s cae en el renglón 0
    // (antes, con los timings iniciales, caía en el renglón 1).
    sendLyricsAction.mockResolvedValueOnce({
      review: timedReview(),
      canApprove: true,
      timings: [
        { i: 0, startMs: 15000, interpolated: false },
        { i: 1, startMs: 20000, interpolated: false },
        { i: 2, startMs: 25000, interpolated: false },
      ],
    });

    el.querySelector('.sheet__add-section').click();
    await flush();

    audio.emitTime(15);
    const lines = el.querySelectorAll('.sheet-line');
    expect(lines[0].classList.contains('is-sounding')).toBe(true);
    expect(lines[1].classList.contains('is-sounding')).toBe(false);
  });

  it('sin vocalsUrl no se ofrece escuchar', async () => {
    const el = await LyricsSheet({ songId: 's1', vocalsUrl: null });
    document.body.appendChild(el);

    expect(el.querySelector('.sheet-status-strip__listen')).toBeNull();
    expect(el.querySelector('[data-action="listen"]')).toBeNull();
  });

  it('desmontar la hoja destruye el transporte', async () => {
    const el = await LyricsSheet({ songId: 's1', vocalsUrl: 'https://x/v.mp3' });
    document.body.appendChild(el);

    el.destroy();

    expect(audio.destroy).toHaveBeenCalled();
  });

  describe('modo lectura (confirmación previa al approve)', () => {
    beforeEach(() => {
      getLyricsReview.mockResolvedValue(timedPendingResult({ canApprove: true }));
    });

    it('el modo lectura no ofrece controles de edición', async () => {
      const el = await LyricsSheet({ songId: 's1', vocalsUrl: 'https://x/v.mp3' });
      document.body.appendChild(el);

      el.querySelector('.sheet__approve').click();
      await flush();

      expect(el.querySelector('.sheet-separator__add')).toBeNull();
      expect(el.querySelector('.sheet-section__menu')).toBeNull();
      expect(el.querySelector('.sheet__add-section').hidden).toBe(true);

      el.querySelectorAll('.sheet-line')[0].click();
      expect(el.querySelector('textarea')).toBeNull();
    });

    it('en lectura el transporte arranca abierto y el toque salta el audio', async () => {
      const el = await LyricsSheet({ songId: 's1', vocalsUrl: 'https://x/v.mp3' });
      document.body.appendChild(el);

      el.querySelector('.sheet__approve').click();
      await flush();

      expect(audio.open).toHaveBeenCalled();

      el.querySelectorAll('.sheet-line')[1].querySelector('.sheet-line__text').click();
      expect(audio.seek).toHaveBeenCalledWith(9000);
    });

    it('volver a editar conserva el documento y devuelve los controles', async () => {
      const el = await LyricsSheet({ songId: 's1', vocalsUrl: 'https://x/v.mp3' });
      document.body.appendChild(el);
      const antes = el.querySelectorAll('.sheet-line').length;

      el.querySelector('.sheet__approve').click();
      await flush();
      el.querySelector('.sheet__back').click();

      expect(el.querySelectorAll('.sheet-line').length).toBe(antes);
      expect(el.querySelector('.sheet-section__menu')).not.toBeNull();
    });

    it('volver a editar cierra el transporte de voz', async () => {
      const el = await LyricsSheet({ songId: 's1', vocalsUrl: 'https://x/v.mp3' });
      document.body.appendChild(el);

      el.querySelector('.sheet__approve').click(); // a lectura, el transporte abre
      await flush();
      expect(audio.open).toHaveBeenCalled();

      el.querySelector('.sheet__back').click(); // vuelve a editar

      expect(audio.close).toHaveBeenCalled();
      expect(el.querySelector('.sheet-status-strip__listen')?.getAttribute('aria-pressed')).toBe(
        'false',
      );
    });

    it('aprobar de verdad sale del modo lectura', async () => {
      approveLyrics.mockResolvedValue({ success: true });
      const onApproved = vi.fn();
      const el = await LyricsSheet({ songId: 's1', vocalsUrl: 'https://x/v.mp3', onApproved });
      document.body.appendChild(el);

      el.querySelector('.sheet__approve').click();
      await flush();
      el.querySelector('.sheet__confirm').click();
      await flush();

      expect(onApproved).toHaveBeenCalled();
    });
  });
});
