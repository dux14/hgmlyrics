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

// La fila de chips SATB del hero se eliminó (pivote a modos excluyentes
// Letra/Acordes/Tono, post-QA visual): el selector de voz único ahora vive
// en el panel Voz (#voice-panel), compartido por Acordes ("mi tono") y Tono.
describe('SongView — fila de chips SATB del hero: eliminada', () => {
  it('no se pinta #hero-voice-chips ni el mic viejo del hero, con o sin roster', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));
    expect(container.querySelector('#hero-voice-chips')).toBeNull();
    expect(container.querySelector('.hero-voice-chip')).toBeNull();
  });

  it('sin roster de voces: tampoco se pinta el panel Voz', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft([]));
    expect(container.querySelector('#voice-panel')).toBeNull();
  });

  it('no queda en el DOM ningún residuo del grid viejo de voz', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));
    expect(container.querySelector('#tono-category-row')).toBeNull();
    expect(container.querySelector('#tono-person-row')).toBeNull();
    expect(container.querySelector('#tono-active-voice')).toBeNull();
    expect(container.querySelector('#tono-tune-action')).toBeNull();
    expect(container.textContent).not.toMatch(/Voz activa/);
  });
});

describe('SongView — selector de voz unificado (panel Voz) en modo Tono, preview', () => {
  it('con roster: cambiar a modo Tono muestra el panel Voz con una categoría por chip', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));

    container.querySelector('[data-mode="tono"]').click();

    const panel = container.querySelector('#voice-panel');
    expect(panel).toBeTruthy();
    expect(container.querySelector('#chords-extras').style.display).toBe('flex');
    const chips = [...container.querySelectorAll('#voice-panel-categories [data-category]')];
    expect(chips.map((c) => c.dataset.category)).toEqual(['soprano', 'contralto', 'tenor', 'bass']);
  });

  it('sin voz elegida: la letra se pinta plana (fallback existente)', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));

    container.querySelector('[data-mode="tono"]').click();

    const line = container.querySelector('#lyrics-content .lyrics__line');
    expect(line.classList.contains('lyrics__line--tono')).toBe(false);
    expect(line.textContent.trim()).toBe('Santo es el Señor');
  });

  it('elegir una categoría del panel activa el render tono para esa voz', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));

    container.querySelector('[data-mode="tono"]').click();
    container.querySelector('#voice-panel-categories [data-category="tenor"]').click();

    const line = container.querySelector('#lyrics-content .lyrics__line');
    expect(line.classList.contains('lyrics__line--tono')).toBe(true);
    expect(
      container.querySelector('#voice-panel-categories [data-category="tenor"]').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('elegir otra categoría reemplaza la selección previa (una sola voz activa a la vez)', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));

    container.querySelector('[data-mode="tono"]').click();
    container.querySelector('#voice-panel-categories [data-category="bass"]').click();
    container.querySelector('#voice-panel-categories [data-category="soprano"]').click();

    expect(
      container.querySelector('#voice-panel-categories [data-category="bass"]').getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      container.querySelector('#voice-panel-categories [data-category="soprano"]').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('cerrar el panel (Quitar voz) vuelve a la letra plana sin salir de modo Tono', async () => {
    const container = document.createElement('div');
    await renderSongView(container, buildDraft(fullRoster));

    container.querySelector('[data-mode="tono"]').click();
    container.querySelector('#voice-panel-categories [data-category="tenor"]').click();
    container.querySelector('#voice-panel-toggle').click(); // expande el panel para exponer el cierre
    container.querySelector('#voice-panel-close').click();

    const line = container.querySelector('#lyrics-content .lyrics__line');
    expect(line.classList.contains('lyrics__line--tono')).toBe(false);
    expect(container.querySelector('[data-mode="tono"]').classList).toContain('chord-toggle__btn--active');
  });
});
