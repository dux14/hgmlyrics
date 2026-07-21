// Stub de la Task D2; la Task D3/D4/D5 monta la vista real.

/**
 * @param {HTMLElement} container
 * @param {string} songId
 */
export function renderSongPartituraView(container, songId) {
  container.innerHTML = '';
  const section = document.createElement('section');
  section.style.padding = '16px';
  section.dataset.songId = songId;
  section.innerHTML = `
    <h1>Partitura vocal</h1>
    <p>En construcción.</p>
  `;
  container.appendChild(section);
}
