/**
 * PrayerPage.js — Oración del artista
 *
 * Sección inmersiva con el texto fijo de la oración. Presentacional:
 * sin estado, sin red. Estética theme-aware en prayer.css.
 */

import { icon } from '../lib/icons.js';
import '../styles/prayer.css';

/** Estrofas de la oración, en orden. Texto fijo — no editar a la ligera. */
const STANZAS = [
  'Mi buen Dios, deseo encontrarme contigo en este rato que voy a dedicar a buscarte en la belleza. Quiero poner todos mis talentos a Tu servicio, para que a través de ellos brille Tu luz en el mundo.',
  'Conciénciame, Dios verdadero, de que todo lo recibido es tuyo. Dame la fuerza de Tu Espíritu y un deseo ardiente de vivirte en los dones que me has regalado.',
  'Concédeme un corazón agradecido y responsable que viva siempre en el asombro de Tu gratuidad. Que brille Tu belleza en cada obra que hagas nacer en mí, para que todo sea verdadero reflejo del Dios vivo que realmente eres.',
  'Haz que todo lo que escriba, cante, baile, interprete, moldee o pinte, participe del gozo de Tu presencia. Que disfrutes con nosotros de este tiempo y seamos tu delicia.',
  'Condúcenos a Ti a través de Tu amada creación, para que con la fuerza de Tu Espíritu ampliemos en el mundo Tu Abrazo eterno, por Jesucristo, Tu hijo amado, nuestro Pobre Loco y Señor.',
];

/**
 * Render the prayer page into a container (replaces its content).
 * @param {HTMLElement} container
 */
export function renderPrayerPage(container) {
  const stanzasHtml = STANZAS.map((s) => `<p class="prayer__stanza">${s}</p>`).join('');

  container.innerHTML = `
    <section class="prayer" aria-label="Oración del artista">
      <div class="prayer__glow" aria-hidden="true"></div>
      <header class="prayer__header">
        <span class="prayer__badge" aria-hidden="true">${icon('sun', { size: 26 })}</span>
        <h1 class="prayer__title">Oración del artista</h1>
      </header>
      <div class="prayer__body">
        ${stanzasHtml}
      </div>
      <footer class="prayer__footer">
        <span class="prayer__divider" aria-hidden="true"></span>
        <p class="prayer__amen">Amén.</p>
      </footer>
    </section>
  `;
}
