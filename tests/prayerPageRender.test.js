import { describe, it, expect, beforeEach } from 'vitest';
import { renderPrayerPage } from '../src/components/PrayerPage.js';

describe('renderPrayerPage', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
  });

  it('monta la oración completa con etiqueta, estrofas y cierre', () => {
    renderPrayerPage(container);

    const root = container.querySelector('.prayer');
    expect(root).not.toBeNull();

    // Etiqueta superior
    expect(container.querySelector('.prayer__label').textContent).toMatch(/Oración del artista/i);

    // 5 estrofas
    const stanzas = container.querySelectorAll('.prayer__stanza');
    expect(stanzas.length).toBe(5);

    // Primera y última estrofa por contenido
    expect(stanzas[0].textContent).toMatch(/Mi buen Dios, deseo encontrarme contigo/);
    expect(stanzas[4].textContent).toMatch(/nuestro Pobre Loco y Señor/);

    // Cierre Amén
    expect(container.querySelector('.prayer__amen').textContent.trim()).toBe('Amén.');
  });

  it('reemplaza el contenido previo del contenedor', () => {
    container.innerHTML = '<p>viejo</p>';
    renderPrayerPage(container);
    expect(container.textContent).not.toMatch(/viejo/);
  });
});
