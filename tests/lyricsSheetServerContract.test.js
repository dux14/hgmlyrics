/**
 * lyricsSheetServerContract.test.js — el viaje completo de una acción de la
 * hoja viva contra el REDUCER REAL del servidor.
 *
 * Existe por H1b (31-jul-2026): el cliente mandaba `setLineText` con texto
 * vacío y el servidor lo rechazaba con 422, y CI seguía verde porque cada
 * mitad del contrato se probaba contra un doble que cooperaba —
 * `tests/pipelineLyricsReview.test.js` afirmaba que el servidor debía
 * rechazar el vacío y `tests/sheetLine.test.js` que el cliente debía
 * mandarlo, con `persistText: vi.fn(async () => {})`. Ninguna suite
 * ejercitaba el viaje.
 *
 * Acá `sendLyricsAction` no devuelve un resultado inventado: aplica la acción
 * con `applyReviewAction` (el mismo módulo que corre en la función de Vercel)
 * y traduce el RangeError al error que `putGate` devuelve como 422. Un payload
 * que el servidor no acepte sale como toast, y el test lo caza.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLyricsReview, sendLyricsAction, approveLyrics } from '../src/lib/pipelineApi.js';
import { applyReviewAction } from '../api/_lib/pipeline/lyricsReview.js';

vi.mock('../src/lib/pipelineApi.js', () => ({
  getLyricsReview: vi.fn(),
  sendLyricsAction: vi.fn(),
  approveLyrics: vi.fn(),
}));

vi.mock('../src/lib/toast.js', () => ({
  showToast: vi.fn(),
}));

vi.mock('../src/components/pipeline/lyrics/SheetAudio.js', () => ({
  SheetAudio: vi.fn(),
}));

// jsdom no implementa matchMedia; reduce-motion evita esperar la animación de
// colapso en cada acción (mismo criterio que tests/lyricsSheet.test.js).
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

/** Servidor real en memoria: mismo reducer, misma traducción de error que
 * `putGate` (RangeError -> 422 con mensaje). Devuelve el documento vivo, así
 * que las acciones encadenadas ven el estado que dejó la anterior. */
function mountServer() {
  const server = { doc: baseReview(), calls: [] };
  getLyricsReview.mockImplementation(async () => ({
    review: server.doc,
    canApprove: false,
    suggestions: [],
  }));
  sendLyricsAction.mockImplementation(async (_songId, action) => {
    server.calls.push(action);
    try {
      server.doc = applyReviewAction(server.doc, action);
    } catch (err) {
      // putGate (api/songs/[id]/pipeline/lyrics.js) traduce RangeError a 422;
      // pipelineApi lo entrega al componente como Error.
      throw new Error(`422 ${err.message}`, { cause: err });
    }
    return { review: server.doc, canApprove: true };
  });
  return server;
}

/** Abre el renglón `idx` de la hoja y devuelve su textarea. */
function openLine(el, idx) {
  const row = el.querySelectorAll('.sheet-line')[idx];
  row.querySelector('.sheet-line__text').click();
  return { row, textarea: row.querySelector('.sheet-line__edit-input') };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('hoja viva contra el validador real del servidor', () => {
  let server;

  beforeEach(() => {
    server = mountServer();
    approveLyrics.mockResolvedValue({});
  });

  it('vaciar un renglón y cerrar: el servidor lo acepta y el renglón queda sin texto (H1b)', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const { textarea } = openLine(el, 0);
    textarea.value = '';
    textarea.dispatchEvent(new Event('blur'));
    await flush();

    expect(showToast).not.toHaveBeenCalled();
    expect(server.doc.sections[0].lines[0].text).toBe('');
    expect(el.querySelectorAll('.sheet-line')[0].textContent).toContain('Sin texto');
  });

  it('con el renglón ya vacío, la acción del botón llega al servidor y se aplica', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const { textarea } = openLine(el, 0);
    textarea.value = '';
    textarea.dispatchEvent(new Event('blur'));
    await flush();

    const { row } = openLine(el, 0);
    row.querySelector('[data-action="delete"]').click();
    await flush();

    expect(showToast).not.toHaveBeenCalled();
    expect(server.calls.map((a) => a.type)).toEqual(['setLineText', 'deleteLine']);
    expect(server.doc.sections[0].lines.map((l) => l.text)).toEqual(['segunda linea']);
  });

  // Barrido de la barra: cada botón emite un payload que el reducer real
  // acepta. Un `type` desconocido o un índice mal armado sale como toast.
  const acciones = [
    { boton: 'duplicate', lineIdx: 0, esperado: 'duplicateLine' },
    { boton: 'voc', lineIdx: 0, esperado: 'toggleVocalization' },
    { boton: 'delete', lineIdx: 0, esperado: 'deleteLine' },
    { boton: 'merge', lineIdx: 0, esperado: 'mergeLines' },
    { boton: 'move-down', lineIdx: 0, esperado: 'moveLine' },
    { boton: 'move-up', lineIdx: 1, esperado: 'moveLine' },
  ];

  it.each(acciones)('el botón $boton produce una acción que el servidor aplica', async (caso) => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const { row, textarea } = openLine(el, caso.lineIdx);
    // Unir usa el caret para decidir arriba/abajo; con caret al final apunta
    // al renglón siguiente, que existe en ambos casos del barrido.
    textarea.selectionStart = textarea.value.length;
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
    row.querySelector(`[data-action="${caso.boton}"]`).click();
    await flush();

    expect(showToast).not.toHaveBeenCalled();
    expect(server.calls.at(-1).type).toBe(caso.esperado);
  });

  it('Enter parte el renglón vía setLineText y el servidor devuelve las dos piezas', async () => {
    const el = await LyricsSheet({ songId: 'song-1' });
    document.body.appendChild(el);

    const { textarea } = openLine(el, 0);
    textarea.value = 'primera\nlinea';
    textarea.selectionStart = 7;
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    expect(showToast).not.toHaveBeenCalled();
    expect(server.doc.sections[0].lines.map((l) => l.text)).toEqual([
      'primera',
      'linea',
      'segunda linea',
    ]);
  });
});
