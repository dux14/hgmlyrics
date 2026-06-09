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

// Stub loopbackTest and tonePlayer (require AudioContext / real audio).
vi.mock('../src/lib/loopbackTest.js', () => ({
  runLoopbackTest: vi.fn(),
}));
vi.mock('../src/lib/tonePlayer.js', () => ({
  createTonePlayer: vi.fn(() => ({ play: vi.fn(), stop: vi.fn(), close: vi.fn() })),
}));

const { bodySong, sanitizeFreeNote, bodyFreeNote, bodyCalibrar } =
  await import('../src/components/Tuner.js');

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

describe('sanitizeFreeNote', () => {
  it('acepta notas válidas C1–B6', () => {
    expect(sanitizeFreeNote('D4')).toBe('D4');
    expect(sanitizeFreeNote('F#3')).toBe('F#3');
    expect(sanitizeFreeNote('C1')).toBe('C1');
    expect(sanitizeFreeNote('B6')).toBe('B6');
  });
  it('rechaza fuera de rango, bemoles y basura', () => {
    expect(sanitizeFreeNote('C0')).toBeNull();
    expect(sanitizeFreeNote('C7')).toBeNull();
    expect(sanitizeFreeNote('Bb3')).toBeNull();
    expect(sanitizeFreeNote('')).toBeNull();
    expect(sanitizeFreeNote(null)).toBeNull();
    expect(sanitizeFreeNote('<img>')).toBeNull();
  });
});

describe('bodyFreeNote', () => {
  it('renderiza 12 chips de nota, stepper de octava, nota grande y CTA', () => {
    const html = bodyFreeNote({ pc: 'D', octave: 4 });
    for (const pc of ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']) {
      expect(html).toContain(`data-pc="${pc}"`);
    }
    expect(html).toContain('id="free-oct-down"');
    expect(html).toContain('id="free-oct-up"');
    expect(html).toContain('D4');
    expect(html).toContain('293.7'); // Hz de D4
    expect(html).toContain('id="free-tune"');
  });
  it('marca el chip activo', () => {
    const html = bodyFreeNote({ pc: 'A', octave: 3 });
    expect(html).toMatch(/data-pc="A"[^>]*data-active="true"/);
  });
  it('no usa emojis', () => {
    expect(bodyFreeNote({ pc: 'C', octave: 4 })).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe('bodyCalibrar', () => {
  it('muestra el offset actual, el boton de auto-test y el control de A4', () => {
    const html = bodyCalibrar({ calCents: 0 });
    expect(html).toContain('id="cal-run"'); // "Probar afinador"
    expect(html).toContain('id="cal-a4"'); // slider de A4
    expect(html).toContain('id="cal-reset"'); // restablecer
    expect(html).toContain('440'); // A4 por defecto
  });

  it('refleja un offset aplicado', () => {
    const html = bodyCalibrar({ calCents: 12 });
    expect(html).toContain('+12');
  });

  it('no usa emojis', () => {
    expect(bodyCalibrar({ calCents: 0 })).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
