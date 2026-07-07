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

vi.mock('../src/lib/store.js', () => ({
  getSongById: vi.fn(),
  filterByAlbum: vi.fn(),
  fetchSongDetail: vi.fn(),
  getAdjacentSongs: vi.fn(),
}));

vi.mock('../src/router.js', () => ({
  navigate: vi.fn(),
}));

// voz_tono activo — mismo estilo que songViewRender.test.js (paridad preview).
vi.mock('../src/lib/authStore.js', () => ({
  isAdmin: vi.fn().mockReturnValue(false),
  isFeatureEnabled: vi.fn((key) => key === 'voz_tono'),
}));

const { renderSongView } = await import('../src/components/SongView.js');

function buildDraft(voiceRoster) {
  return {
    isPreview: true,
    title: 'Santo',
    schemaVersion: 3,
    voiceRoster,
    sections: [
      {
        type: 'verse',
        label: 'V',
        lines: [
          {
            text: 'Santo es el Señor',
            groups: (voiceRoster || []).map((v) => ({
              voiceId: v.id,
              start: 0,
              end: 5,
              note: 'B3',
            })),
          },
        ],
      },
    ],
  };
}

const fullRoster = [
  { id: 'sop1', name: 'Soprano', category: 'soprano' },
  { id: 'alt1', name: 'Contralto', category: 'contralto' },
  { id: 'ten1', name: 'Tenor', category: 'tenor' },
  { id: 'bas1', name: 'Bajo', category: 'bass' },
];

describe('SongView — chips SATB del hero (T5)', () => {
  it('sin roster de voces: no se pintan chips (tonoAvailable false)', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft([]));
    expect(container.querySelector('#hero-voice-chips')).toBeNull();
  });

  it('con roster completo: un chip por categoría en orden canónico', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));
    const chips = [...container.querySelectorAll('#hero-voice-chips [data-category]')];
    expect(chips.map((c) => c.dataset.category)).toEqual([
      'soprano',
      'contralto',
      'tenor',
      'bass',
    ]);
  });

  it('ninguna voz activa al montar: todos los chips con aria-pressed=false', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));
    const chips = [...container.querySelectorAll('#hero-voice-chips [data-category]')];
    expect(chips.every((c) => c.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('roster parcial: solo se pintan chips de las categorías presentes', async () => {
    const container = document.createElement('div');
    await renderSongView(
      container,
      buildDraft([
        { id: 'ten1', name: 'Tenor', category: 'tenor' },
        { id: 'bas1', name: 'Bajo', category: 'bass' },
      ]),
    );
    const chips = [...container.querySelectorAll('#hero-voice-chips [data-category]')];
    expect(chips.map((c) => c.dataset.category)).toEqual(['tenor', 'bass']);
  });

  it('contralto usa inicial "A" con label accesible completo', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));
    const chip = container.querySelector('#hero-voice-chips [data-category="contralto"]');
    expect(chip.textContent.trim()).toBe('A');
    expect(chip.getAttribute('aria-label')).toContain('Contralto');
  });
});

describe('SongView — interacción de chips SATB (T5)', () => {
  it('tap en un chip: activa la voz, cambia a modo tono y sincroniza el grid de tono', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));

    // Arranca en modo Letra.
    expect(container.querySelector('[data-mode="lyrics"]').classList).toContain(
      'chord-toggle__btn--active',
    );

    container.querySelector('#hero-voice-chips [data-category="tenor"]').click();

    // Cambió a modo Tono.
    expect(container.querySelector('[data-mode="tono"]').classList).toContain(
      'chord-toggle__btn--active',
    );
    // El chip del hero queda activo.
    expect(
      container
        .querySelector('#hero-voice-chips [data-category="tenor"]')
        .getAttribute('aria-pressed'),
    ).toBe('true');
    // Sincroniza con el grid de tono-filters (misma activeCategory).
    expect(
      container
        .querySelector('#tono-category-row [data-category="tenor"]')
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('tap sobre el chip ya activo: deselecciona y se queda en modo tono', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));

    const chip = container.querySelector('#hero-voice-chips [data-category="tenor"]');
    chip.click(); // selecciona
    chip.click(); // deselecciona

    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(
      container
        .querySelector('#tono-category-row [data-category="tenor"]')
        .getAttribute('aria-pressed'),
    ).toBe('false');
    // Se queda en modo Tono (estado "sin voz activa" ya válido hoy).
    expect(container.querySelector('[data-mode="tono"]').classList).toContain(
      'chord-toggle__btn--active',
    );
  });

  it('seleccionar categoría desde el grid de tono-filters sincroniza el chip del hero', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));

    container.querySelector('#hero-voice-chips [data-category="bass"]').click();
    container.querySelector('#tono-category-row [data-category="soprano"]').click();

    expect(
      container.querySelector('#hero-voice-chips [data-category="bass"]').getAttribute(
        'aria-pressed',
      ),
    ).toBe('false');
    expect(
      container
        .querySelector('#hero-voice-chips [data-category="soprano"]')
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
