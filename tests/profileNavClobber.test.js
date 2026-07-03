import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bug de navegación #3: renderProfile pinta en un regionEl (contrato de
// renderAsyncRegion). Si el usuario navega fuera de /perfil (p. ej. a /admin o
// /licencias) ANTES de que resuelva refreshProfile, el fetch tardío del perfil
// NO debe reemplazar la pantalla nueva. Pintar en la región (que queda
// desprendida tras navegar) hace el render tardío invisible en vez de clobberear.

vi.mock('../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => null),
  getProfile: vi.fn(() => null),
  refreshProfile: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../src/router.js', () => ({ navigate: vi.fn() }));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Profile — navegación: un fetch tardío del perfil no clobberea la pantalla nueva', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('navegar a /admin antes de que resuelva refreshProfile deja intacta la pantalla nueva', async () => {
    const authStore = await import('../src/lib/authStore.js');

    let resolveRefresh;
    const refreshP = new Promise((r) => {
      resolveRefresh = r;
    });
    authStore.refreshProfile.mockImplementation(() => refreshP);

    // Sin cache al inicio (fuerza la rama async); perfil disponible tras refresh.
    let current = null;
    authStore.getProfile.mockImplementation(() => current);

    const container = document.createElement('div');
    document.body.appendChild(container);

    const { renderProfile } = await import('../src/components/Profile.js');
    renderProfile(container); // arranca fetch async (refreshProfile pendiente)

    // El usuario navega a /admin: el router reemplaza el contenido compartido.
    container.innerHTML = '<div id="admin-page">Panel de admin</div>';

    // El perfil resuelve tarde, con la URL ya en /admin.
    current = { username: 'ana', displayName: 'Ana' };
    resolveRefresh();
    await flush();

    expect(container.querySelector('#admin-page')).not.toBeNull();
  });
});
