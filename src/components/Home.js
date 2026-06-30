import { navigate } from '../router.js';
import { getState, getAlbums } from '../lib/store.js';
import { createSongCard } from './SongList.js';
import { isAuthenticated } from '../lib/authStore.js';
import { icon } from '../lib/icons.js';
import { escapeHtml } from '../lib/escape.js';
import { resolveCoverUrl } from './songRow.js';

export function selectRecent(songs, limit = 6) {
  return [...(songs || [])]
    .sort((a, b) => (b.year || 0) - (a.year || 0) || (b.albumOrder || 0) - (a.albumOrder || 0))
    .slice(0, limit);
}

export function renderHome(container) {
  const { songs } = getState();
  const albums = getAlbums().slice(0, 6);
  const recent = selectRecent(songs, 6);

  container.innerHTML = `
    <div class="home fade-in">
      <section class="home__module" aria-labelledby="home-recent">
        <h2 class="home__kicker syn" id="home-recent">Adoración reciente</h2>
        <div class="home__strip" id="home-recent-strip"></div>
      </section>
      <section class="home__module" aria-labelledby="home-albums">
        <h2 class="home__kicker syn" id="home-albums">Álbumes</h2>
        <div class="home__albums">
          ${albums
            .map(
              (a) => `<button class="home__album">
                <img class="home__album-cover" src="${escapeHtml(resolveCoverUrl(a))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
                <span class="home__album-name">${escapeHtml(a.name)}</span>
              </button>`,
            )
            .join('')}
        </div>
      </section>
      <section class="home__module">
        <button class="home__teaser" data-nav="/oracion">
          <span class="home__teaser-ic">${icon('flame', { size: 22 })}</span>
          <span class="home__teaser-tx">
            <span class="home__teaser-t">Oración del artista</span>
            <span class="home__teaser-s">Una palabra para hoy</span>
          </span>
          ${icon('chevron-up', { size: 16, className: 'home__teaser-arr' })}
        </button>
      </section>
      <section class="home__module home__quick">
        <button class="home__quick-card" data-nav="/favoritos">
          ${icon('heart', { size: 20 })}<span>Favoritos</span>
        </button>
        <button class="home__quick-card" data-nav="/lista/nueva">
          ${icon('list', { size: 20 })}<span>Tus listas</span>
        </button>
      </section>
    </div>
  `;

  const strip = container.querySelector('#home-recent-strip');
  recent.forEach((song, i) => strip.appendChild(createSongCard(song, i)));

  container.querySelectorAll('.home__album').forEach((el) =>
    el.addEventListener('click', () => navigate('/buscar')),
  );
  container.querySelectorAll('[data-nav]').forEach((el) =>
    el.addEventListener('click', () => navigate(el.dataset.nav)),
  );

  if (!isAuthenticated()) {
    container.querySelector('.home__quick')?.setAttribute('data-guest', 'true');
  }
}
