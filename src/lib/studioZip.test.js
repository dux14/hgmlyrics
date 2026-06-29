import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { zipFilename, buildTrackList, buildZipBlob, songBaseName, buildSectionTrackList } from './studioZip.js';

describe('zipFilename', () => {
  it('usa el nombre original sin extensión + label + .mp3', () => {
    expect(zipFilename('colombia.mp3', 'Batería')).toBe('colombia - Batería.mp3');
  });
  it('quita la extensión aunque sea .wav o .m4a', () => {
    expect(zipFilename('cancion.wav', 'Voz líder')).toBe('cancion - Voz líder.mp3');
  });
  it('sin extensión, usa el nombre tal cual', () => {
    expect(zipFilename('demo', 'Coros')).toBe('demo - Coros.mp3');
  });
  it('sanea caracteres ilegales de nombre de archivo en ambas partes', () => {
    expect(zipFilename('a/b:c?.mp3', 'X*Y')).toBe('a_b_c_ - X_Y.mp3');
  });
  it('cae a "audio" si el nombre original es vacío o no string', () => {
    expect(zipFilename('', 'Bajo')).toBe('audio - Bajo.mp3');
    expect(zipFilename(undefined, 'Bajo')).toBe('audio - Bajo.mp3');
  });
});

describe('songBaseName', () => {
  it('sanitiza y quita la extensión', () => {
    expect(songBaseName({ input_meta: { filename: 'colombia.mp3' } })).toBe('colombia');
  });
  it('sanea caracteres ilegales y quita extensión .wav', () => {
    expect(songBaseName({ input_meta: { filename: 'a/b:c.wav' } })).toBe('a_b_c');
  });
  it('sin filename → "audio"', () => {
    expect(songBaseName({})).toBe('audio');
    expect(songBaseName({ input_meta: {} })).toBe('audio');
  });
});

describe('buildTrackList', () => {
  const labels = {
    vocals: 'Voz',
    drums: 'Batería',
    bass: 'Bajo',
    guitar: 'Guitarra',
    piano: 'Piano',
    other: 'Otros',
    lead: 'Voz líder',
    backing: 'Coros',
  };
  it('incluye solo las pistas presentes, con nombres formateados', () => {
    const job = {
      input_meta: { filename: 'colombia.mp3' },
      stems: { drums: 'u/drums', bass: 'u/bass' },
      voices: { lead: 'u/lead', backing: null },
    };
    expect(buildTrackList(job, labels)).toEqual([
      { url: 'u/drums', filename: 'colombia - Batería.mp3' },
      { url: 'u/bass', filename: 'colombia - Bajo.mp3' },
      { url: 'u/lead', filename: 'colombia - Voz líder.mp3' },
    ]);
  });
  it('sin stems ni voices → lista vacía', () => {
    expect(buildTrackList({ input_meta: { filename: 'x.mp3' } }, labels)).toEqual([]);
  });
  it('sin filename → cae a "audio"', () => {
    const job = { stems: { other: 'u/o' } };
    expect(buildTrackList(job, labels)).toEqual([{ url: 'u/o', filename: 'audio - Otros.mp3' }]);
  });

  it('genderVoices completo: incluye ambos modelos en orden chorus.male, chorus.female, aufr33.male, aufr33.female', () => {
    const job = {
      input_meta: { filename: 'colombia.mp3' },
      genderVoices: {
        chorus: { male: 'u/ch-male', female: 'u/ch-female' },
        aufr33: { male: 'u/a-male', female: 'u/a-female' },
      },
    };
    expect(buildTrackList(job, labels)).toEqual([
      { url: 'u/ch-male', filename: 'colombia - Voz masculina (Opción A).mp3' },
      { url: 'u/ch-female', filename: 'colombia - Voz femenina (Opción A).mp3' },
      { url: 'u/a-male', filename: 'colombia - Voz masculina (Opción B).mp3' },
      { url: 'u/a-female', filename: 'colombia - Voz femenina (Opción B).mp3' },
    ]);
  });

  it('genderVoices parcial: solo incluye pistas con url truthy', () => {
    const job = {
      input_meta: { filename: 'colombia.mp3' },
      genderVoices: {
        chorus: { male: 'u/ch-male', female: null },
        aufr33: { male: undefined, female: 'u/a-female' },
      },
    };
    expect(buildTrackList(job, labels)).toEqual([
      { url: 'u/ch-male', filename: 'colombia - Voz masculina (Opción A).mp3' },
      { url: 'u/a-female', filename: 'colombia - Voz femenina (Opción B).mp3' },
    ]);
  });

  it('stems + voices + genderVoices: género aparece al final', () => {
    const job = {
      input_meta: { filename: 'colombia.mp3' },
      stems: { drums: 'u/drums' },
      voices: { lead: 'u/lead' },
      genderVoices: {
        chorus: { male: 'u/ch-male', female: null },
      },
    };
    expect(buildTrackList(job, labels)).toEqual([
      { url: 'u/drums', filename: 'colombia - Batería.mp3' },
      { url: 'u/lead', filename: 'colombia - Voz líder.mp3' },
      { url: 'u/ch-male', filename: 'colombia - Voz masculina (Opción A).mp3' },
    ]);
  });

  it('sin genderVoices → comportamiento idéntico al actual', () => {
    const job = {
      input_meta: { filename: 'colombia.mp3' },
      stems: { drums: 'u/drums', bass: 'u/bass' },
      voices: { lead: 'u/lead', backing: null },
    };
    expect(buildTrackList(job, labels)).toEqual([
      { url: 'u/drums', filename: 'colombia - Batería.mp3' },
      { url: 'u/bass', filename: 'colombia - Bajo.mp3' },
      { url: 'u/lead', filename: 'colombia - Voz líder.mp3' },
    ]);
  });
});

describe('songBaseName con title', () => {
  it('usa input_meta.title si existe, saneado', () => {
    expect(songBaseName({ input_meta: { filename: 'a.mp3', title: 'Mi Tema' } })).toBe('Mi Tema');
  });
  it('cae a filename si no hay title', () => {
    expect(songBaseName({ input_meta: { filename: 'colombia.mp3' } })).toBe('colombia');
  });
  it('sanea el title', () => {
    expect(songBaseName({ input_meta: { filename: 'a.mp3', title: 'a/b:c' } })).toBe('a_b_c');
  });
});

describe('buildSectionTrackList', () => {
  const labels = {
    vocals: 'Voz', instrumental: 'Instrumental', drums: 'Batería', bass: 'Bajo',
    guitar: 'Guitarra', piano: 'Piano', other: 'Otros', lead: 'Voz líder', backing: 'Coros',
  };
  it('voiceInstrumental: solo pistas de stems', () => {
    const job = {
      input_meta: { filename: 'colombia.mp3' },
      stems: { vocals: 'u/v', drums: 'u/d' },
      voices: { lead: 'u/l' },
    };
    expect(buildSectionTrackList(job, labels, 'voiceInstrumental')).toEqual([
      { url: 'u/v', filename: 'colombia - Voz.mp3' },
      { url: 'u/d', filename: 'colombia - Batería.mp3' },
    ]);
  });
  it('leadBacking: solo voces', () => {
    const job = { input_meta: { filename: 'c.mp3' }, voices: { lead: 'u/l', backing: 'u/b' }, stems: { vocals: 'u/v' } };
    expect(buildSectionTrackList(job, labels, 'leadBacking')).toEqual([
      { url: 'u/l', filename: 'c - Voz líder.mp3' },
      { url: 'u/b', filename: 'c - Coros.mp3' },
    ]);
  });
  it('gender: incluye ambos modelos', () => {
    const job = {
      input_meta: { filename: 'c.mp3' },
      genderVoices: { chorus: { male: 'u/cm', female: 'u/cf' }, aufr33: { male: 'u/am', female: 'u/af' } },
    };
    expect(buildSectionTrackList(job, labels, 'gender')).toEqual([
      { url: 'u/cm', filename: 'c - Voz masculina (Opción A).mp3' },
      { url: 'u/cf', filename: 'c - Voz femenina (Opción A).mp3' },
      { url: 'u/am', filename: 'c - Voz masculina (Opción B).mp3' },
      { url: 'u/af', filename: 'c - Voz femenina (Opción B).mp3' },
    ]);
  });
  it('structure: lista vacía (no genera audio)', () => {
    expect(buildSectionTrackList({ input_meta: { filename: 'c.mp3' } }, labels, 'structure')).toEqual([]);
  });
});

describe('buildZipBlob', () => {
  const labels = { drums: 'Batería', lead: 'Voz líder' };
  it('descarga las pistas, zippea y devuelve blob/count/base', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    const job = {
      input_meta: { filename: 'colombia.mp3' },
      stems: { drums: 'u/drums' },
      voices: { lead: 'u/lead' },
    };
    const { blob, count, base } = await buildZipBlob(job, labels);
    expect(count).toBe(2);
    expect(base).toBe('colombia');
    expect(blob.type).toBe('application/zip');
  });
  it('sin pistas → lanza', async () => {
    await expect(buildZipBlob({ input_meta: {} }, labels)).rejects.toThrow('No hay pistas');
  });
  it('reporta onProgress(k, total) una vez por pista descargada', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    const job = {
      input_meta: { filename: 'colombia.mp3' },
      stems: { drums: 'u/drums', bass: 'u/bass' },
      voices: { lead: 'u/lead' },
    };
    const calls = [];
    await buildZipBlob(job, { drums: 'Batería', bass: 'Bajo', lead: 'Voz líder' }, (k, total) =>
      calls.push([k, total]),
    );
    expect(calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});
