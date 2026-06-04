import { describe, it, expect, vi } from 'vitest';

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
  getSongById: vi.fn(),
  filterByAlbum: vi.fn(),
  fetchSongDetail: vi.fn(),
  getAdjacentSongs: vi.fn(),
}));

// Stub router to avoid hash-router DOM side-effects.
vi.mock('../src/router.js', () => ({
  navigate: vi.fn(),
}));

const { renderSections } = await import('../src/components/SongView.js');

const sections = [
  {
    type: 'verse',
    label: 'E1',
    lines: [
      {
        text: 'Santo es el Señor',
        groups: [{ start: 0, end: 5, voiceId: 'sop1', note: 'B3' }],
        chords: [{ pos: 0, ch: 'D' }],
      },
    ],
  },
];

describe('renderSections (modo Letra)', () => {
  it('texto blanco plano: sin coloreado de voz, sin badge +N, sin acordes', () => {
    const html = renderSections(sections, { viewMode: 'lyrics' });
    expect(html).toContain('Santo es el Señor');
    expect(html).not.toContain('voice-text--soprano');
    expect(html).not.toContain('voice-badge-extra');
    expect(html).not.toContain('chord-label');
  });
});

describe('renderSections (modo Acordes)', () => {
  it('acorde flotante + letra atenuada', () => {
    const html = renderSections(sections, { viewMode: 'chords' });
    expect(html).toContain('float-label chord-label');
    expect(html).toContain('>D<');
    expect(html).toContain('lyrics__letra-dim');
  });
});

describe('renderSections (modo Tono)', () => {
  it('voz activa coloreada + nota flotante', () => {
    const html = renderSections(sections, {
      viewMode: 'tono',
      activeVoiceId: 'sop1',
      activeCategory: 'soprano',
    });
    expect(html).toContain('voice-text--soprano');
    expect(html).toContain('float-label voice-text--soprano');
    expect(html).toContain('>B3<');
    expect(html).toContain('lyrics__tono-dim');
  });

  it('sin voz activa → no intenta render de tono', () => {
    const html = renderSections(sections, { viewMode: 'tono', activeVoiceId: null });
    expect(html).not.toContain('float-label');
  });
});

const spokenSections = [
  {
    type: 'verse',
    label: 'Santo',
    lines: [
      { text: 'Por eso con los ángeles, diciendo:', spoken: true },
      { text: 'Santo, Santo, Santo' },
    ],
  },
];

describe('renderSections — líneas spoken', () => {
  it('marca la línea spoken con lyrics__line--spoken en modo lyrics', () => {
    const html = renderSections(spokenSections, { viewMode: 'lyrics' });
    expect(html).toContain('lyrics__line--spoken');
    expect(html).toContain('Por eso con los');
  });

  it('mantiene spoken en modo chords', () => {
    const html = renderSections(spokenSections, { viewMode: 'chords' });
    expect(html).toContain('lyrics__line--spoken');
  });

  it('mantiene spoken en modo tono aunque haya voz activa', () => {
    const html = renderSections(spokenSections, { viewMode: 'tono', activeVoiceId: 'tenor' });
    expect(html).toContain('lyrics__line--spoken');
  });

  it('no marca como spoken una línea normal', () => {
    const html = renderSections(spokenSections, { viewMode: 'lyrics' });
    const normal = html.split('lyrics__line--spoken')[1] || '';
    expect(normal).toContain('Santo, Santo, Santo');
    expect(normal).not.toContain('lyrics__line--spoken');
  });
});

describe('renderSections — vista combinada (chordsVoiceId)', () => {
  const sections = [
    {
      type: 'verse',
      label: 'Santo',
      lines: [
        {
          text: 'San to el Señor',
          chords: [{ pos: 0, ch: 'D' }],
          groups: [{ voiceId: 'v1', start: 0, end: 6, note: 'B3' }],
        },
      ],
    },
  ];

  it('con viewMode chords + chordsVoiceId renderiza línea mix con rieles', () => {
    const html = renderSections(sections, {
      viewMode: 'chords',
      chordsVoiceId: 'v1',
      chordsCategory: 'tenor',
    });
    expect(html).toContain('lyrics__line--mix');
    expect(html).toContain('mix-rail--chord');
    expect(html).toContain('voice-text--tenor');
  });

  it('sin chordsVoiceId el modo chords queda EXACTAMENTE como antes', () => {
    const html = renderSections(sections, { viewMode: 'chords' });
    expect(html).toContain('lyrics__line--chords');
    expect(html).not.toContain('mix-seg');
  });

  it('línea vacía en combinada produce línea en blanco (no se omite)', () => {
    const withEmpty = [{ type: 'verse', label: 'X', lines: [{ text: '' }] }];
    const html = renderSections(withEmpty, { viewMode: 'chords', chordsVoiceId: 'v1' });
    expect(html).toContain('&nbsp;');
  });
});
