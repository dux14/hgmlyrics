/**
 * chordNotation.test.js — Conversión de acordes anglo → latina (capa de display)
 * y persistencia del setting global.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  toLatin,
  displayChord,
  displayNote,
  parseChordRoot,
  getChordNotation,
  setChordNotation,
} from '../src/lib/chordNotation.js';

describe('toLatin', () => {
  it('convierte raíces simples', () => {
    expect(toLatin('C')).toBe('Do');
    expect(toLatin('D')).toBe('Re');
    expect(toLatin('E')).toBe('Mi');
    expect(toLatin('F')).toBe('Fa');
    expect(toLatin('G')).toBe('Sol');
    expect(toLatin('A')).toBe('La');
    expect(toLatin('B')).toBe('Si');
  });

  it('preserva sufijos menor/séptima', () => {
    expect(toLatin('Em')).toBe('Mim');
    expect(toLatin('Dm7')).toBe('Rem7');
  });

  it('preserva accidentales sostenido/bemol', () => {
    expect(toLatin('G#')).toBe('Sol#');
    expect(toLatin('Bb')).toBe('Sib');
  });

  it('convierte raíz y bajo tras la barra', () => {
    expect(toLatin('D/F#')).toBe('Re/Fa#');
  });

  it('combina accidental + sufijo compuesto', () => {
    expect(toLatin('C#m7b5')).toBe('Do#m7b5');
  });

  it('otros sufijos comunes se preservan intactos', () => {
    expect(toLatin('Csus4')).toBe('Dosus4');
    expect(toLatin('Gdim')).toBe('Soldim');
    expect(toLatin('Aaug')).toBe('Laaug');
    expect(toLatin('Fadd9')).toBe('Faadd9');
    expect(toLatin('G7')).toBe('Sol7');
  });

  it('entrada vacía o rara no crashea', () => {
    expect(toLatin('')).toBe('');
    expect(toLatin(null)).toBe('');
    expect(toLatin(undefined)).toBe('');
    expect(toLatin('N.C.')).toBe('N.C.');
    expect(toLatin('H')).toBe('H');
  });
});

describe('parseChordRoot (FIX 6 — parseo de raíz compartido)', () => {
  it('separa raíz, accidental y resto', () => {
    expect(parseChordRoot('Dm7')).toEqual({ root: 'D', accidental: '', rest: 'm7' });
    expect(parseChordRoot('G#')).toEqual({ root: 'G', accidental: '#', rest: '' });
    expect(parseChordRoot('Bb/D')).toEqual({ root: 'B', accidental: 'b', rest: '/D' });
  });

  it('entrada irreconocible → null', () => {
    expect(parseChordRoot('')).toBeNull();
    expect(parseChordRoot('H')).toBeNull();
    expect(parseChordRoot(null)).toBeNull();
  });
});

describe('displayNote (FIX 2 — notación en notas científicas)', () => {
  it('latin traduce preservando accidental y octava', () => {
    expect(displayNote('G4', 'latin')).toBe('Sol4');
    expect(displayNote('D#4', 'latin')).toBe('Re#4');
    expect(displayNote('Bb3', 'latin')).toBe('Sib3');
  });

  it('anglo (u otro valor) es passthrough', () => {
    expect(displayNote('G4', 'anglo')).toBe('G4');
    expect(displayNote('G4', 'lo-que-sea')).toBe('G4');
  });

  it('entrada irreconocible pasa intacta', () => {
    expect(displayNote('xx', 'latin')).toBe('xx');
    expect(displayNote(null, 'latin')).toBe('');
  });
});

describe('displayChord', () => {
  it('notation latin traduce', () => {
    expect(displayChord('G', 'latin')).toBe('Sol');
  });

  it('notation anglo es passthrough', () => {
    expect(displayChord('G', 'anglo')).toBe('G');
  });

  it('notation desconocida cae a anglo (passthrough)', () => {
    expect(displayChord('G', 'lo-que-sea')).toBe('G');
  });
});

describe('getChordNotation / setChordNotation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('default es anglo (A-B-C)', () => {
    expect(getChordNotation()).toBe('anglo');
  });

  it('persiste latin explícito', () => {
    setChordNotation('latin');
    expect(getChordNotation()).toBe('latin');
  });

  it('persiste anglo tras elegir latin', () => {
    setChordNotation('latin');
    setChordNotation('anglo');
    expect(getChordNotation()).toBe('anglo');
  });

  it('valor inválido guardado cae a default anglo al leer', () => {
    localStorage.setItem('hkn-chord-notation', 'algo-raro');
    expect(getChordNotation()).toBe('anglo');
  });
});
