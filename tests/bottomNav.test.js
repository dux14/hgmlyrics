import { describe, it, expect, vi } from 'vitest';

// BottomNav importa GoToSheet (que usa el router); mockear para no cargar supabase.
vi.mock('../src/components/GoToSheet.js', () => ({ openGoToSheet: vi.fn() }));

import { activeTab } from '../src/components/BottomNav.js';

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
