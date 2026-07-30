/**
 * tonoEditorPitch.test.js — TDD de la acción «traer el tono de la IA» en el
 * modal Voces y tono. La nota traída solo rellena el input: el grupo lo sigue
 * creando «Agregar grupos del rango» (una sola vía de escritura).
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openTonoEditorModal } from '../src/components/editor/TonoEditorModal.js';

const ROSTER = [
  { id: 'v1', name: 'Soprano 1', category: 'soprano' },
  { id: 'v2', name: 'Tenor', category: 'tenor' },
];

// Renglón real de 22ac3453…, recortado (ver plan).
const SYLLABLES = [
  { text: 'Que', midi: 59, note: 'B3' },
  { text: 'es', midi: null, note: null },
  { text: 'ta', midi: 59, note: null },
  { text: 'sea', midi: 60, note: 'C4' },
  { text: 'siem', midi: 60, note: null },
  { text: 'pre', midi: 60, note: null },
];

function pitchPayload(lines) {
  return {
    hasAnalysis: true,
    voicesPresent: ['lead', 'backing'],
    voices: { lead: { lines }, backing: { lines } },
  };
}

function makeLine() {
  return { text: 'Que esta sea siempre', groups: [] };
}

// Selecciona un rango tocando el carácter inicial y el final de la tira.
function selectRange(from, to) {
  document.querySelector(`.char-cell[data-char="${from}"]`).click();
  document.querySelector(`.char-cell[data-char="${to}"]`).click();
}

function bringButtonFor(voiceId) {
  return document.querySelector(`[data-bring-for="${voiceId}"]`);
}

function noteInputFor(voiceId) {
  return document.querySelector(`[data-note-for="${voiceId}"]`);
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('traer el tono de la IA', () => {
  it('rellena el input de la voz con la nota del rango, sin crear el grupo', async () => {
    const line = makeLine();
    openTonoEditorModal(line, {
      voiceRoster: ROSTER,
      onClose: () => {},
      pitchNotesPromise: Promise.resolve(pitchPayload([{ i: 0, syllables: SYLLABLES }])),
      canonicalIndex: 0,
    });
    await flush();

    selectRange(4, 11); // "esta sea"
    bringButtonFor('v1').click();

    expect(noteInputFor('v1').value).toBe('B3');
    expect(line.groups).toEqual([]);
  });

  it('el grupo se crea con «Agregar grupos del rango», con la nota traída', async () => {
    const line = makeLine();
    openTonoEditorModal(line, {
      voiceRoster: ROSTER,
      onClose: () => {},
      pitchNotesPromise: Promise.resolve(pitchPayload([{ i: 0, syllables: SYLLABLES }])),
      canonicalIndex: 0,
    });
    await flush();

    selectRange(4, 11);
    bringButtonFor('v1').click();
    document.querySelector('[data-tono="apply"]').click();

    expect(line.groups).toEqual([{ start: 4, end: 12, voiceId: 'v1', note: 'B3' }]);
  });

  it('avisa cuando el rango contiene más de una nota', async () => {
    const line = makeLine();
    openTonoEditorModal(line, {
      voiceRoster: ROSTER,
      onClose: () => {},
      pitchNotesPromise: Promise.resolve(pitchPayload([{ i: 0, syllables: SYLLABLES }])),
      canonicalIndex: 0,
    });
    await flush();

    selectRange(4, 11);
    bringButtonFor('v1').click();

    const aviso = document.querySelector('.tono-editor__pitch-notice').textContent;
    expect(aviso).toContain('B3 C4');
    expect(aviso).toContain('Se usó la primera');
  });

  it('avisa cuando la nota sale de un renglón distinto al esperado', async () => {
    const otra = { i: 0, syllables: [{ text: 'Otra', midi: 59, note: 'B3' }] };
    const line = makeLine();
    openTonoEditorModal(line, {
      voiceRoster: ROSTER,
      onClose: () => {},
      pitchNotesPromise: Promise.resolve(pitchPayload([otra, { i: 1, syllables: SYLLABLES }])),
      canonicalIndex: 0,
    });
    await flush();

    expect(document.querySelector('.tono-editor__pitch-warning').textContent).toContain(
      'no está alineado',
    );
  });

  it('deshabilita el botón sin tono procesado, con el motivo', async () => {
    openTonoEditorModal(makeLine(), {
      voiceRoster: ROSTER,
      onClose: () => {},
      pitchNotesPromise: Promise.resolve({ hasAnalysis: false, voicesPresent: [], voices: {} }),
      canonicalIndex: 0,
    });
    await flush();

    expect(bringButtonFor('v1').disabled).toBe(true);
    expect(document.querySelector('.tono-editor__pitch-reason').textContent).toContain(
      'todavía no tiene tono procesado',
    );
  });

  it('deshabilita el botón si el renglón cambió desde el análisis', async () => {
    const otra = { i: 0, syllables: [{ text: 'Otra', midi: 59, note: 'B3' }] };
    openTonoEditorModal(makeLine(), {
      voiceRoster: ROSTER,
      onClose: () => {},
      pitchNotesPromise: Promise.resolve(pitchPayload([otra])),
      canonicalIndex: 0,
    });
    await flush();

    expect(bringButtonFor('v1').disabled).toBe(true);
    expect(document.querySelector('.tono-editor__pitch-reason').textContent).toContain(
      'cambió desde el análisis',
    );
  });

  it('deshabilita el botón en una canción sin guardar', async () => {
    openTonoEditorModal(makeLine(), {
      voiceRoster: ROSTER,
      onClose: () => {},
      pitchNotesPromise: null,
      canonicalIndex: 0,
    });
    await flush();

    expect(bringButtonFor('v1').disabled).toBe(true);
    expect(document.querySelector('.tono-editor__pitch-reason').textContent).toContain(
      'Guarda la canción',
    );
  });

  it('sin rango seleccionado el botón está deshabilitado', async () => {
    openTonoEditorModal(makeLine(), {
      voiceRoster: ROSTER,
      onClose: () => {},
      pitchNotesPromise: Promise.resolve(pitchPayload([{ i: 0, syllables: SYLLABLES }])),
      canonicalIndex: 0,
    });
    await flush();

    expect(bringButtonFor('v1').disabled).toBe(true);
  });

  it('el selector de origen cambia la voz del análisis que se lee', async () => {
    const soloLead = { i: 0, syllables: SYLLABLES };
    const soloBacking = {
      i: 0,
      syllables: [{ text: 'Que esta sea siempre', midi: 62, note: 'D4' }],
    };
    const line = makeLine();
    openTonoEditorModal(line, {
      voiceRoster: ROSTER,
      onClose: () => {},
      pitchNotesPromise: Promise.resolve({
        hasAnalysis: true,
        voicesPresent: ['lead', 'backing'],
        voices: { lead: { lines: [soloLead] }, backing: { lines: [soloBacking] } },
      }),
      canonicalIndex: 0,
    });
    await flush();

    const select = document.querySelector('[data-pitch-origin]');
    expect(select.value).toBe('lead');
    select.value = 'backing';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    selectRange(0, 19);
    bringButtonFor('v1').click();
    expect(noteInputFor('v1').value).toBe('D4');
  });

  it('funciona como antes cuando no le pasan tono (compatibilidad)', () => {
    const line = makeLine();
    openTonoEditorModal(line, { voiceRoster: ROSTER, onClose: () => {} });

    selectRange(0, 2);
    noteInputFor('v1').value = 'A3';
    noteInputFor('v1').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-tono="apply"]').click();

    expect(line.groups).toEqual([{ start: 0, end: 3, voiceId: 'v1', note: 'A3' }]);
  });
});
