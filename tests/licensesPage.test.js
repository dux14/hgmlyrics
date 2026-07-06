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

  it('incluye los modelos del pipeline Partitura vocal (P1/P2)', () => {
    renderLicenses(container);
    const text = container.textContent;

    expect(text).toContain('torchcrepe');
    expect(text).toContain('CREPE');
    expect(text).toContain('WhisperX');
    expect(text).toContain('pyphen');
    expect(text).toContain('librosa');
  });

  it('incluye las librerias de render/export del pipeline Partitura (P3)', () => {
    renderLicenses(container);
    const text = container.textContent;

    expect(text).toContain('music21');
    expect(text).toContain('pretty_midi');
    expect(text).toContain('cairosvg');
  });

  it('incluye la nota de monetizacion', () => {
    renderLicenses(container);
    expect(container.textContent).toContain('monetizada');
    expect(container.textContent).toContain('NC');
  });

  it('no incluye el boton de volver (rediseno: navegacion via bottom-nav)', () => {
    renderLicenses(container);
    const btn = container.querySelector('#back-btn');
    expect(btn).toBeNull();
  });

  it('reemplaza el contenido previo del container', () => {
    container.innerHTML = '<p>viejo</p>';
    renderLicenses(container);
    expect(container.textContent).not.toMatch(/viejo/);
  });

  it('incluye la seccion de creditos y referencias', () => {
    renderLicenses(container);
    const text = container.textContent;
    expect(text).toContain('Créditos y referencias');
    expect(text).toContain('Mariana Medina');
    expect(text).toContain('Hakuna Group Music');
  });

  it('los enlaces de creditos tienen atributos de seguridad correctos', () => {
    renderLicenses(container);
    const links = [...container.querySelectorAll('a[href*="canva.site"], a[href*="hakuna.org"]')];
    expect(links).toHaveLength(2);
    links.forEach((a) => {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    });
  });
});
