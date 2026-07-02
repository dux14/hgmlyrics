import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/authStore.js', () => ({
  getSession: vi.fn(),
  getProfile: vi.fn(),
  refreshProfile: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../router.js', () => ({ navigate: vi.fn() }));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn(() => '') }));
vi.mock('../lib/imageCompress.js', () => ({ compressImageToLimit: vi.fn() }));
vi.mock('../styles/profile.css', () => ({}));
vi.mock('./vocal-range/waveRange.js', () => ({ createWaveRange: vi.fn(() => null) }));

import { voiceLabel, buildProfileHeader, renderProfileEdit } from './Profile.js';

describe('voiceLabel', () => {
  it('mapea tenor a etiqueta y clase de color', () => {
    expect(voiceLabel('tenor', '')).toEqual({ text: 'Tenor', cls: 'voice-pill--tenor' });
  });
  it('sin voz devuelve null', () => {
    expect(voiceLabel('', '')).toBeNull();
  });
});

describe('buildProfileHeader', () => {
  const base = {
    displayName: 'Ana',
    username: 'ana',
    avatarUrl: '',
    voiceType: 'tenor',
    vocalRangeLow: 'C3',
    vocalRangeHigh: 'A5',
    instrumentRoles: ['Guitarra', 'Piano'],
  };

  it('renderiza el badge de voz para tenor', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    expect(el.querySelector('.pf-vbadge--tenor')).toBeTruthy();
  });
  it('muestra chips de instrumentos', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    expect(el.querySelectorAll('.pf-chip').length).toBe(2);
  });
  it('muestra el host de onda cuando hay rango', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    expect(el.querySelector('.pf-wave-host')).toBeTruthy();
    expect(el.textContent).toContain('C3');
    expect(el.textContent).toContain('A5');
  });
  it('atajo a Favoritos apunta a #/favoritos', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    expect(el.querySelector('a[href="#/favoritos"]')).toBeTruthy();
  });
  it('atajo a Amigos apunta a #/amigos', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    expect(el.querySelector('a[href="#/amigos"]')).toBeTruthy();
  });
  it('botón primario Editar perfil tiene clase pf-edit-primary y href #/perfil/editar', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    const btn = el.querySelector('a.pf-edit-primary');
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('href')).toBe('#/perfil/editar');
  });
  it('fila Panel de admin aparece solo si profile.isAdmin es true', () => {
    const adminEl = document.createElement('div');
    adminEl.innerHTML = buildProfileHeader({ ...base, isAdmin: true });
    expect(adminEl.querySelector('a[href="#/admin"]')).toBeTruthy();
    expect(adminEl.textContent).toContain('Panel de admin');

    const normalEl = document.createElement('div');
    normalEl.innerHTML = buildProfileHeader(base);
    expect(normalEl.querySelector('a[href="#/admin"]')).toBeNull();
  });
  it('Cerrar sesión tiene id pf-logout con tilde correcta', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    const btn = el.querySelector('#pf-logout');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Cerrar sesión');
  });
  it('fila Licencias apunta a #/licencias', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    expect(el.querySelector('a[href="#/licencias"]')).toBeTruthy();
  });
  it('perfil minimo sin rango ni instrumentos no renderiza esas tarjetas', () => {
    const minimal = { username: 'x', displayName: 'X' };
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(minimal);
    expect(el.querySelector('.pf-wave-host')).toBeNull();
    expect(el.querySelectorAll('.pf-chip').length).toBe(0);
  });

  it('SEC-X1: avatarUrl con payload XSS no crea atributo onerror ejecutable', () => {
    const profile = {
      ...base,
      avatarUrl: '" onerror="alert(1)" x="',
    };
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(profile);

    // No debe existir ningún <img> con atributo onerror en el DOM
    expect(el.querySelector('img[onerror]')).toBeNull();

    // La imagen debe existir pero sin el atributo onerror
    const img = el.querySelector('#avatar-preview');
    expect(img).not.toBeNull();
    expect(img.hasAttribute('onerror')).toBe(false);
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('renderProfileEdit', () => {
  const base = {
    displayName: 'Ana',
    username: 'ana',
    avatarUrl: '',
    voiceType: 'tenor',
    vocalRangeLow: 'C3',
    vocalRangeHigh: 'A5',
    instrumentRoles: ['Guitarra', 'Piano'],
    isPublic: true,
  };

  it('renderiza el form con los campos clave y la action bar', async () => {
    const { getProfile } = await import('../lib/authStore.js');
    getProfile.mockReturnValue(base);
    const c = document.createElement('div');
    await renderProfileEdit(c);
    await flush();
    expect(c.querySelector('#profile-form')).toBeTruthy();
    expect(c.querySelector('#display-input')).toBeTruthy();
    expect(c.querySelector('#public-input')).toBeTruthy();
    expect(c.querySelector('.pf-actbar')).toBeTruthy();
    expect(c.querySelector('a[href="#/perfil"]')).toBeTruthy();
    // Prellenado: el valor del input refleja el perfil
    expect(c.querySelector('#display-input').value).toBe(base.displayName);
    // Visibilidad: el checkbox refleja isPublic del perfil
    expect(c.querySelector('#public-input').checked).toBe(base.isPublic);
  });
});
