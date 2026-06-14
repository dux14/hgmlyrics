import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderLicenses } from '../src/components/LicensesPage.js';

vi.mock('../src/router.js', () => ({ navigate: vi.fn() }));

describe('renderLicenses', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
  });

  it('puebla el container con los nombres de modelos clave', () => {
    renderLicenses(container);
    const text = container.textContent;

    expect(text).toContain('SongFormer');
    expect(text).toContain('Demucs');
    expect(text).toContain('BS-RoFormer');
    expect(text).toContain('MedleyVox');
  });

  it('incluye la nota de monetizacion', () => {
    renderLicenses(container);
    expect(container.textContent).toContain('monetizada');
    expect(container.textContent).toContain('NC');
  });

  it('incluye el boton de volver', () => {
    renderLicenses(container);
    const btn = container.querySelector('#back-btn');
    expect(btn).not.toBeNull();
  });

  it('reemplaza el contenido previo del container', () => {
    container.innerHTML = '<p>viejo</p>';
    renderLicenses(container);
    expect(container.textContent).not.toMatch(/viejo/);
  });
});
