import { describe, it, expect, vi } from 'vitest';

// Stub CSS import (jsdom can't parse CSS modules).
vi.mock('../src/styles/tuner.css', () => ({}));

// Stub supabase (requires env vars not available in test).
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  },
}));

// Stub store to avoid idb-keyval and auth side-effects.
vi.mock('../src/lib/store.js', () => ({
  fetchSongDetail: vi.fn(),
}));

// Stub pitch detector (requires AudioContext).
vi.mock('../src/lib/pitch.js', () => ({
  createPitchDetector: vi.fn(),
}));

const { bodySong } = await import('../src/components/Tuner.js');

const song = { title: 'Santo', key: 'D major' };

describe('bodySong', () => {
  it('sin objetivo: no muestra bloque objetivo ni marca target', () => {
    const html = bodySong(song, null);
    expect(html).toContain('tuner-scale');
    expect(html).not.toContain('tuner-objective');
    expect(html).not.toContain('data-target="true"');
  });

  it('con objetivo D3: muestra "Objetivo" con D3 y marca el <li> de la nota D', () => {
    const html = bodySong(song, 'D3');
    expect(html).toContain('tuner-objective');
    expect(html).toContain('D3');
    // El <li data-pc="D"> debe quedar marcado como objetivo (pitch-class "D").
    expect(html).toMatch(/<li data-pc="D"[^>]*data-target="true"/);
    expect(html).toContain('Se pone verde al coincidir');
  });

  it('v3 (sin key) con nota objetivo: afina contra la nota, no muestra estado vacío', () => {
    const html = bodySong({ title: 'Santo' }, 'D3');
    expect(html).not.toContain('tuner-empty');
    expect(html).toContain('tuner-objective');
    expect(html).toContain('D3');
    expect(html).toContain('tuner-readout'); // hay gauge/lectura para afinar
    expect(html).not.toContain('tuner-scale'); // v3 no define escala de canción
  });

  it('sin key y sin nota objetivo: estado vacío (nada que afinar)', () => {
    const html = bodySong({ title: 'x' }, null);
    expect(html).toContain('tuner-empty');
  });
});
