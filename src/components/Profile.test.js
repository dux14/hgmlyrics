import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/authStore.js', () => ({
  getSession: vi.fn(),
  getProfile: vi.fn(),
  refreshProfile: vi.fn(),
}));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn(() => '') }));
vi.mock('../lib/imageCompress.js', () => ({ compressImageToLimit: vi.fn() }));
vi.mock('../styles/profile.css', () => ({}));

import { voiceLabel, buildProfileHeader, buildRangeBars } from './Profile.js';

describe('voiceLabel', () => {
  it('mapea tenor a etiqueta y clase de color', () => {
    expect(voiceLabel('tenor', '')).toEqual({ text: 'Tenor', cls: 'voice-pill--tenor' });
  });
  it('sin voz devuelve null', () => {
    expect(voiceLabel('', '')).toBeNull();
  });
});

describe('buildRangeBars', () => {
  it('devuelve 7 barras', () => {
    expect(buildRangeBars().length).toBe(7);
  });
  it('marca las 5 centrales como activas y los extremos inactivos', () => {
    const bars = buildRangeBars();
    expect(bars[0].on).toBe(false);
    expect(bars[6].on).toBe(false);
    expect(bars.slice(1, 6).every((b) => b.on)).toBe(true);
  });
  it('marca la barra 2 como grave (lo) y la 6 como aguda (hi)', () => {
    const bars = buildRangeBars();
    expect(bars[1].lo).toBe(true);
    expect(bars[5].hi).toBe(true);
  });
  it('cada barra trae una altura porcentual', () => {
    expect(buildRangeBars().every((b) => /^\d+%$/.test(b.h))).toBe(true);
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
  it('muestra la viz de rango con 7 barras cuando hay rango', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    expect(el.querySelectorAll('.pf-range i').length).toBe(7);
    expect(el.textContent).toContain('C3');
    expect(el.textContent).toContain('A5');
  });
  it('atajo a Favoritos apunta a #/favoritos', () => {
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(base);
    expect(el.querySelector('a[href="#/favoritos"]')).toBeTruthy();
  });

  it('perfil minimo sin rango ni instrumentos no renderiza esas tarjetas', () => {
    const minimal = { username: 'x', displayName: 'X' };
    const el = document.createElement('div');
    el.innerHTML = buildProfileHeader(minimal);
    expect(el.querySelector('.pf-range')).toBeNull();
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
