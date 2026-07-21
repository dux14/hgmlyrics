import { describe, expect, it } from 'vitest';
import {
  buildReviewDoc, applyReviewAction, reviewTemperature, canApprove,
  approvedSnapshot,
} from '../api/_lib/pipeline/lyricsReview.js';

const dbSections = [
  { type: 'chorus', lines: [
    { text: 'Nadie me ama como tu me amas' },
    { text: 'y en la noche oscura brillara' },
  ] },
];
const canonical = { secciones: [
  { tipo: 'chorus', lineas: [
    { texto: 'Nadie me ama como tú me amas' },
    { texto: 'y en la noche oscura brillará tu luz' },
  ] },
] };
const transcription = {
  text: 'nadie me ama como tu me amas y en la noche oscura brillara tu luz oooh oh',
  words: [], // timestamps omitidos en estos tests
  perLine: [
    { transIndex: 0, dbIndex: 0, score: 1.0 },
    { transIndex: 1, dbIndex: 1, score: 0.78 },
    { transIndex: 2, dbIndex: null, score: 0.0 }, // segmento extra (vocalizacion)
  ],
  transLines: ['nadie me ama como tu me amas', 'y en la noche oscura brillara tu luz', 'oooh oh'],
};

describe('buildReviewDoc', () => {
  it('marca conflicto donde DB y canonica difieren y adjunta las 3 fuentes', () => {
    const doc = buildReviewDoc({ dbSections, canonical, transcription });
    const line2 = doc.sections[0].lines[1];
    expect(line2.conflict).toBe(true);
    expect(line2.sources.db).toBe('y en la noche oscura brillara');
    expect(line2.sources.canonical).toBe('y en la noche oscura brillará tu luz');
  });
  it('propone vocalizaciones desde segmentos sin match', () => {
    const doc = buildReviewDoc({ dbSections, canonical, transcription });
    expect(doc.vocalizations).toHaveLength(1);
    expect(doc.vocalizations[0].text).toBe('oooh oh');
    expect(doc.vocalizations[0].accepted).toBe(null);
  });
  it('sin canonica trabaja con 2 fuentes y lo marca', () => {
    const doc = buildReviewDoc({ dbSections, canonical: null, transcription });
    expect(doc.hasCanonical).toBe(false);
  });
});

describe('applyReviewAction', () => {
  const doc = () => buildReviewDoc({ dbSections, canonical, transcription });
  it('resolve con canonical fija el texto y quita el conflicto', () => {
    const d = applyReviewAction(doc(), { type: 'resolve', section: 0, line: 1, choice: 'canonical' });
    expect(d.sections[0].lines[1].conflict).toBe(false);
    expect(d.sections[0].lines[1].text).toBe('y en la noche oscura brillará tu luz');
  });
  it('splitLine divide el renglon en el indice de palabra dado', () => {
    const d = applyReviewAction(doc(), { type: 'splitLine', section: 0, line: 0, afterWord: 4 });
    expect(d.sections[0].lines[0].text).toBe('Nadie me ama como tu');
    expect(d.sections[0].lines[1].text).toBe('me amas');
  });
  it('mergeLines une dos renglones contiguos', () => {
    const split = applyReviewAction(doc(), { type: 'splitLine', section: 0, line: 0, afterWord: 4 });
    const merged = applyReviewAction(split, { type: 'mergeLines', section: 0, line: 0 });
    expect(merged.sections[0].lines[0].text).toBe('Nadie me ama como tu me amas');
  });
  it('acceptVocalization la convierte en renglon vocalization tras la linea ancla', () => {
    const d = applyReviewAction(doc(), { type: 'acceptVocalization', index: 0, section: 0, afterLine: 1 });
    expect(d.sections[0].lines[2].vocalization).toBe(true);
    expect(d.vocalizations[0].accepted).toBe(true);
  });
});

describe('temperatura y aprobacion', () => {
  it('temperatura sube al resolver y canApprove exige 0 conflictos y 0 vocalizaciones sin decidir', () => {
    let d = buildReviewDoc({ dbSections, canonical, transcription });
    expect(canApprove(d)).toBe(false);
    d = applyReviewAction(d, { type: 'resolve', section: 0, line: 1, choice: 'canonical' });
    expect(reviewTemperature(d)).toBeGreaterThan(0.9);
    d = applyReviewAction(d, { type: 'rejectVocalization', index: 0 });
    expect(canApprove(d)).toBe(true);
  });
  it('approvedSnapshot produce sections para songs.sections + hash estable', () => {
    let d = buildReviewDoc({ dbSections, canonical, transcription });
    d = applyReviewAction(d, { type: 'resolve', section: 0, line: 1, choice: 'canonical' });
    d = applyReviewAction(d, { type: 'rejectVocalization', index: 0 });
    const snap = approvedSnapshot(d);
    expect(snap.sections[0].lines[1].text).toBe('y en la noche oscura brillará tu luz');
    expect(typeof snap.hash).toBe('string');
    expect(approvedSnapshot(d).hash).toBe(snap.hash); // determinista
  });
});
