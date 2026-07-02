import { describe, it, expect, vi, beforeEach } from 'vitest';

// BottomNav importa GoToSheet (que usa el router); mockear para no cargar supabase.
vi.mock('../src/components/GoToSheet.js', () => ({
  openGoToSheet: vi.fn(),
  closeGoToSheet: vi.fn(),
  isGoToSheetOpen: vi.fn(),
}));

vi.mock('../src/router.js', () => ({
  navigate: vi.fn(),
  getCurrentPath: vi.fn(() => '/'),
}));

import { activeTab, renderBottomNav } from '../src/components/BottomNav.js';
import { openGoToSheet, closeGoToSheet, isGoToSheetOpen } from '../src/components/GoToSheet.js';
import { navigate, getCurrentPath } from '../src/router.js';

describe('activeTab — rutas de inicio', () => {
  it('/ → inicio', () => expect(activeTab('/')).toBe('inicio'));
  it('"" → inicio', () => expect(activeTab('')).toBe('inicio'));
});

describe('activeTab — rutas de buscar', () => {
  it('/buscar → buscar', () => expect(activeTab('/buscar')).toBe('buscar'));
  it('/buscar?q=x → buscar (ignora querystring)', () =>
    expect(activeTab('/buscar?q=x')).toBe('buscar'));
});

describe('activeTab — rutas de herramientas', () => {
  it('/herramientas → herramientas', () => expect(activeTab('/herramientas')).toBe('herramientas'));
  it('/afinador → herramientas', () => expect(activeTab('/afinador')).toBe('herramientas'));
  it('/recomendador → herramientas', () => expect(activeTab('/recomendador')).toBe('herramientas'));
  it('/estudio → herramientas', () => expect(activeTab('/estudio')).toBe('herramientas'));
});

describe('activeTab — rutas sin tab activo (null)', () => {
  it('/perfil → null (el perfil vive ahora en el header)', () =>
    expect(activeTab('/perfil')).toBeNull());
  it('/song/123 → null', () => expect(activeTab('/song/123')).toBeNull());
  it('/oracion → null', () => expect(activeTab('/oracion')).toBeNull());
  it('/admin → null', () => expect(activeTab('/admin')).toBeNull());
  it('ruta desconocida → null', () => expect(activeTab('/desconocida/ruta')).toBeNull());
});

describe('renderBottomNav — tab menú (estilo Spotify)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isGoToSheetOpen.mockReturnValue(false);
  });

  function menuTab(container) {
    return container.querySelector('.bottom-nav__item[data-tab="menu"]');
  }

  it('monta 4 items; el tab menú arranca con aria-expanded="false"', () => {
    const container = document.createElement('div');
    renderBottomNav(container);
    const items = container.querySelectorAll('.bottom-nav__item');
    expect(items.length).toBe(4);
    expect(menuTab(container).getAttribute('aria-expanded')).toBe('false');
  });

  it('click en menú cerrado abre la hoja y refleja estado abierto', () => {
    const container = document.createElement('div');
    renderBottomNav(container);
    const a = menuTab(container);

    a.click();

    expect(openGoToSheet).toHaveBeenCalledTimes(1);
    expect(openGoToSheet).toHaveBeenCalledWith(getCurrentPath(), {
      onClose: expect.any(Function),
    });
    expect(a.classList.contains('bottom-nav__item--close')).toBe(true);
    expect(a.getAttribute('aria-expanded')).toBe('true');
    expect(a.querySelector('span')).toBeNull();
  });

  it('ejecutar la onClose capturada restaura el tab menú', () => {
    const container = document.createElement('div');
    renderBottomNav(container);
    const a = menuTab(container);

    a.click();
    const { onClose } = openGoToSheet.mock.calls[0][1];
    onClose();

    expect(a.classList.contains('bottom-nav__item--close')).toBe(false);
    expect(a.getAttribute('aria-expanded')).toBe('false');
    expect(a.querySelector('span')?.textContent).toBe('Menú');
  });

  it('click en menú abierto llama closeGoToSheet y no vuelve a llamar openGoToSheet', () => {
    isGoToSheetOpen.mockReturnValue(true);
    const container = document.createElement('div');
    renderBottomNav(container);
    const a = menuTab(container);

    a.click();

    expect(closeGoToSheet).toHaveBeenCalledTimes(1);
    expect(openGoToSheet).not.toHaveBeenCalled();
  });

  it('click en otro tab llama closeGoToSheet antes de navigate', () => {
    const container = document.createElement('div');
    renderBottomNav(container);
    const buscar = container.querySelector('.bottom-nav__item[data-tab="buscar"]');

    buscar.click();

    expect(closeGoToSheet).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/buscar');
  });
});
