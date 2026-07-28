import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks de dependencias
// ---------------------------------------------------------------------------

vi.mock('../src/lib/store.js', () => ({
  getState: vi.fn(() => ({ songs: [] })),
}));

vi.mock('../src/router.js', () => ({
  navigate: vi.fn(),
}));

vi.mock('../src/lib/icons.js', () => ({
  icon: (name) => `<svg data-icon="${name}"></svg>`,
}));

// ---------------------------------------------------------------------------
// Import del componente (después de los mocks)
// ---------------------------------------------------------------------------

const { renderAdminDashboard, renderAdminEditList } =
  await import('../src/components/AdminDashboard.js');
const { navigate } = await import('../src/router.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderAdminDashboard — hub', () => {
  it('renderiza 4 tarjetas de navegación', () => {
    const container = makeContainer();
    renderAdminDashboard(container);
    const cards = container.querySelectorAll('.admin-hub__card');
    expect(cards.length).toBe(4);
  });

  it.each([
    ['Crear canción', '/admin/create'],
    ['Modificar canción', '/admin/edit'],
    ['Voces en off', '/admin/voz/nueva'],
    ['Mundo Virtual', '/admin/mundo'],
  ])('la tarjeta "%s" navega a %s al hacer click', (text, path) => {
    const container = makeContainer();
    renderAdminDashboard(container);
    vi.mocked(navigate).mockClear();

    const card = [...container.querySelectorAll('.admin-hub__card')].find((c) =>
      c.textContent.includes(text),
    );
    expect(card).toBeTruthy();
    card.click();
    expect(navigate).toHaveBeenCalledWith(path);
  });
});

describe('renderAdminEditList — botón volver', () => {
  it('usa .btn--back en vez del glifo "←" crudo', () => {
    const container = makeContainer();
    renderAdminEditList(container);
    const backBtn = container.querySelector('.btn--back');
    expect(backBtn).not.toBeNull();
    expect(container.innerHTML).not.toContain('←');
  });

  it('el botón volver navega a /admin', () => {
    const container = makeContainer();
    renderAdminEditList(container);
    vi.mocked(navigate).mockClear();
    container.querySelector('.btn--back').click();
    expect(navigate).toHaveBeenCalledWith('/admin');
  });
});
