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

// Stub authStore — enable voz_tono for preview parity tests.
vi.mock('../src/lib/authStore.js', () => ({
  isAdmin: vi.fn().mockReturnValue(false),
  isFeatureEnabled: vi.fn((key) => key === 'voz_tono'),
}));

const { renderSections, renderVoicePanel } = await import('../src/components/SongView.js');

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

describe('renderSections — identidad visual por tipo de sección', () => {
  it('type conocido (coro) produce la clase del tipo', () => {
    const html = renderSections(
      [{ type: 'chorus', label: 'Coro', lines: [{ text: 'la la' }] }],
      { viewMode: 'lyrics' },
    );
    expect(html).toContain('lyrics__section--chorus');
  });

  it('sinónimo en español (estribillo) normaliza a chorus', () => {
    const html = renderSections(
      [{ type: 'estribillo', label: 'Coro', lines: [{ text: 'la la' }] }],
      { viewMode: 'lyrics' },
    );
    expect(html).toContain('lyrics__section--chorus');
  });

  it('type desconocido cae al fallback verse', () => {
    const html = renderSections(
      [{ type: 'algo-raro', label: 'X', lines: [{ text: 'la la' }] }],
      { viewMode: 'lyrics' },
    );
    expect(html).toContain('lyrics__section--verse');
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

describe('renderSections — visibleVoices (OptionsSheet T4)', () => {
  it('voz activa oculta en visibleVoices: sin nota flotante ni coloreado, texto base atenuado', () => {
    const html = renderSections(sections, {
      viewMode: 'tono',
      activeVoiceId: 'sop1',
      activeCategory: 'soprano',
      visibleVoices: new Set(), // sop1 apagada
    });
    expect(html).not.toContain('voice-text--soprano');
    expect(html).not.toContain('float-label');
    expect(html).not.toContain('>B3<');
    expect(html).toContain('lyrics__tono-dim');
  });

  it('voz activa visible en visibleVoices: se comporta como sin filtro', () => {
    const html = renderSections(sections, {
      viewMode: 'tono',
      activeVoiceId: 'sop1',
      activeCategory: 'soprano',
      visibleVoices: new Set(['sop1']),
    });
    expect(html).toContain('float-label voice-text--soprano');
    expect(html).toContain('>B3<');
  });

  it('sin visibleVoices (back-compat) no filtra nada', () => {
    const html = renderSections(sections, {
      viewMode: 'tono',
      activeVoiceId: 'sop1',
      activeCategory: 'soprano',
    });
    expect(html).toContain('float-label voice-text--soprano');
  });

  it('chordsVoiceId oculto en modo Acordes+Voz cae a rieles sin nota de voz', () => {
    const mixSections = [
      {
        type: 'verse',
        label: 'E1',
        lines: [
          {
            text: 'Santo',
            groups: [{ start: 0, end: 5, voiceId: 'ten1', note: 'D4' }],
            chords: [{ pos: 0, ch: 'G' }],
          },
        ],
      },
    ];
    const html = renderSections(mixSections, {
      viewMode: 'chords',
      chordsVoiceId: 'ten1',
      chordsCategory: 'tenor',
      visibleVoices: new Set(), // ten1 apagada
    });
    expect(html).toContain('mix-seg');
    expect(html).not.toContain('>D4<');
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

  it('línea spoken dentro de la combinada sigue siendo spoken (no mix)', () => {
    const withSpoken = [{ type: 'verse', label: 'X', lines: [{ text: 'hablado', spoken: true }] }];
    const html = renderSections(withSpoken, { viewMode: 'chords', chordsVoiceId: 'v1' });
    expect(html).toContain('lyrics__line--spoken');
    expect(html).not.toContain('lyrics__line--mix');
  });

  it('timing-guide dentro de la combinada sigue siendo guide (no mix)', () => {
    const withGuide = [{ type: 'verse', label: 'X', lines: [{ text: '4 TIEMPOS' }] }];
    const html = renderSections(withGuide, { viewMode: 'chords', chordsVoiceId: 'v1' });
    expect(html).toContain('timing-guide');
    expect(html).not.toContain('lyrics__line--mix');
  });
});

describe('renderVoicePanel', () => {
  const song = {
    voiceRoster: [
      { id: 'v1', name: 'Tenor', category: 'tenor' },
      { id: 'v2', name: 'Bajo', category: 'bass' },
    ],
    sections: [],
  };
  it('renderiza caja plegada con chips de categoría y cierre', () => {
    const html = renderVoicePanel(song);
    expect(html).toContain('voice-panel');
    expect(html).toContain('data-category="tenor"');
    expect(html).toContain('data-category="bass"');
    expect(html).toContain('Solo acordes');
    expect(html).toContain('hidden'); // cuerpo plegado por defecto
    expect(html).toContain('aria-controls="voice-panel-body"');
  });
  it('no usa emojis', () => {
    expect(renderVoicePanel(song)).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe('preview del editor — paridad de voz', () => {
  it('renderSongView en modo preview incluye chips de voz del hero y panel Voz', async () => {
    const { renderSongView } = await import('../src/components/SongView.js');
    const container = document.createElement('div');
    const draft = {
      isPreview: true,
      title: 'Test',
      schemaVersion: 3,
      voiceRoster: [{ id: 'v1', name: 'Tenor', category: 'tenor' }],
      sections: [
        {
          type: 'verse',
          label: 'V',
          lines: [
            {
              text: 'hola mundo',
              chords: [{ pos: 0, ch: 'D' }],
              groups: [{ voiceId: 'v1', start: 0, end: 4, note: 'B3' }],
            },
          ],
        },
      ],
    };
    await renderSongView(container, draft);
    expect(container.querySelector('#hero-voice-chips')).not.toBeNull();
    expect(container.querySelector('#voice-panel')).not.toBeNull();
  });
});
