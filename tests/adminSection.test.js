import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks de dependencias
// ---------------------------------------------------------------------------

vi.mock('../src/router.js', () => ({
  navigate: vi.fn(),
}));

vi.mock('../src/lib/icons.js', () => ({
  icon: (name) => `<svg data-icon="${name}"></svg>`,
}));

// ---------------------------------------------------------------------------
// Import del componente (después de los mocks)
// ---------------------------------------------------------------------------

const { renderAdminSection } = await import('../src/components/AdminSection.js');
const { navigate } = await import('../src/router.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

beforeEach(() => {
  vi.mocked(navigate).mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderAdminSection', () => {
  it('renderiza la cabecera con el título y un botón .btn--back con texto "Volver"', () => {
    const container = makeContainer();
    renderAdminSection(container, { title: 'Feature Flags', iconName: 'flag' });

    expect(container.querySelector('.admin-section__title').textContent).toContain('Feature Flags');
    const backBtn = container.querySelector('.btn--back');
    expect(backBtn).not.toBeNull();
    expect(backBtn.textContent).toContain('Volver');
  });

  it('click en .btn--back navega a /admin por defecto', () => {
    const container = makeContainer();
    renderAdminSection(container, { title: 'Mundo Virtual', iconName: 'globe' });

    container.querySelector('.btn--back').click();
    expect(navigate).toHaveBeenCalledWith('/admin');
  });

  it('respeta un onBack personalizado', () => {
    const container = makeContainer();
    const onBack = vi.fn();
    renderAdminSection(container, { title: 'Mundo Virtual', iconName: 'globe', onBack });

    container.querySelector('.btn--back').click();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('devuelve el nodo .admin-section__body para que el caller monte contenido', () => {
    const container = makeContainer();
    const body = renderAdminSection(container, { title: 'Feature Flags', iconName: 'flag' });

    expect(body).not.toBeNull();
    expect(body.classList.contains('admin-section__body')).toBe(true);

    body.innerHTML = '<div id="probe"></div>';
    expect(container.querySelector('#probe')).not.toBeNull();
  });
});
