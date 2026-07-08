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
    // Notación por defecto de la app es anglo (getChordNotation → 'anglo').
    expect(chip.textContent.replace(/\s+/g, ' ').trim()).toBe('A B3');
    expect(chip.getAttribute('aria-label')).toContain('Contralto');
  });

  it('cada chip trae la nota (firstNoteForVoice, notación actual) en un <b>', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));
    const chip = container.querySelector('#hero-voice-chips [data-category="tenor"]');
    const noteEl = chip.querySelector('b');
    expect(noteEl).toBeTruthy();
    expect(noteEl.textContent).toBe('B3');
  });

  it('fila del hero termina en un único botón #hero-tuner-mic', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));
    const mics = container.querySelectorAll('#hero-tuner-mic');
    expect(mics.length).toBe(1);
    expect(mics[0].closest('#hero-voice-chips')).toBeTruthy();
    // Es el último elemento de la fila (cierra la fila de chips).
    expect(container.querySelector('#hero-voice-chips').lastElementChild).toBe(mics[0]);
  });

  it('no queda en el DOM el grid de tarjetas de voz ni el texto "Voz activa"', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));
    expect(container.querySelector('#tono-category-row')).toBeNull();
    expect(container.querySelector('#tono-person-row')).toBeNull();
    expect(container.querySelector('#tono-active-voice')).toBeNull();
    expect(container.querySelector('#tono-tune-action')).toBeNull();
    expect(container.textContent).not.toMatch(/Voz activa/);
  });
});

describe('SongView — interacción de chips SATB', () => {
  it('tap en un chip inactivo: lo marca activo (is-active) y cambia a modo tono', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));

    // Arranca en modo Letra.
    expect(container.querySelector('[data-mode="lyrics"]').classList).toContain(
      'chord-toggle__btn--active',
    );

    const chip = container.querySelector('#hero-voice-chips [data-category="tenor"]');
    chip.click();

    // Cambió a modo Tono.
    expect(container.querySelector('[data-mode="tono"]').classList).toContain(
      'chord-toggle__btn--active',
    );
    // El chip del hero queda activo.
    expect(chip.classList.contains('is-active')).toBe(true);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('tap sobre el chip ya activo: deselecciona (quita is-active) y se queda en modo tono', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));

    const chip = container.querySelector('#hero-voice-chips [data-category="tenor"]');
    chip.click(); // selecciona
    chip.click(); // deselecciona

    expect(chip.classList.contains('is-active')).toBe(false);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    // Se queda en modo Tono (estado "sin voz activa" ya válido hoy).
    expect(container.querySelector('[data-mode="tono"]').classList).toContain(
      'chord-toggle__btn--active',
    );
  });

  it('activar otro chip desactiva el anterior (una sola voz activa a la vez)', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));

    container.querySelector('#hero-voice-chips [data-category="bass"]').click();
    container.querySelector('#hero-voice-chips [data-category="soprano"]').click();

    expect(
      container
        .querySelector('#hero-voice-chips [data-category="bass"]')
        .classList.contains('is-active'),
    ).toBe(false);
    expect(
      container
        .querySelector('#hero-voice-chips [data-category="soprano"]')
        .classList.contains('is-active'),
    ).toBe(true);
  });
});
