import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/authStore.js', () => ({
  getSession: vi.fn(),
  getProfile: vi.fn(),
  refreshProfile: vi.fn(),
}));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn(() => '') }));
vi.mock('../lib/imageCompress.js', () => ({ compressImageToLimit: vi.fn() }));

import { voiceLabel, buildProfileHeader } from './Profile.js';

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

  it('renderiza la píldora de voz con color de cuerda', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    expect(el.querySelector('.voice-pill--tenor')).toBeTruthy();
  });
  it('quick-button de favoritos NO contiene icono de corazón', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    const fav = el.querySelector('a[href="#/favoritos"]');
    expect(fav.querySelector('svg')).toBeFalsy();
  });
  it('muestra chips de instrumentos', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    expect(el.querySelectorAll('.profile-chip').length).toBe(2);
  });
  it('muestra la mini-viz de rango cuando hay rango', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    expect(el.querySelector('.range-viz')).toBeTruthy();
    expect(el.textContent).toContain('C3');
    expect(el.textContent).toContain('A5');
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
