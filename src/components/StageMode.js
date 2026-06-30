import { icon } from '../lib/icons.js';
import { createWakeLock } from '../lib/wakeLock.js';
import { requestStageFullscreen, exitStageFullscreen } from '../lib/fullscreen.js';

/** Transicion pura del chrome: el toque tiene un solo significado. */
export function nextChromeVisible(prev) {
  return !prev;
}

let session = null; // { songViewEl, chrome, fab, wl, handlers } | null

function buildChrome() {
  const chrome = document.createElement('div');
  chrome.className = 'stage-chrome stage-chrome--visible';
  chrome.innerHTML = `
    <div class="stage-chrome__top">
      <button class="stage-chrome__btn stage-chrome__exit" id="stage-exit" type="button" aria-label="Salir del modo escenario">${icon('close', { size: 24 })}</button>
      <span class="stage-chrome__wakelock" id="stage-wakelock" hidden>${icon('sun', { size: 18 })}<span>Pantalla activa</span></span>
    </div>
    <div class="stage-chrome__bottom">
      <button class="stage-chrome__btn stage-chrome__font" id="stage-font-down" type="button" aria-label="Reducir tamano de letra">A−</button>
      <button class="stage-chrome__btn stage-chrome__font" id="stage-font-up" type="button" aria-label="Aumentar tamano de letra">A+</button>
      <div class="stage-chrome__autoscroll" id="stage-autoscroll-slot"></div>
    </div>`;
  return chrome;
}

function setChromeVisible(chrome, visible) {
  chrome.classList.toggle('stage-chrome--visible', visible);
}

export function enterStage(songViewEl) {
  if (session || !songViewEl) return; // idempotente

  songViewEl.classList.add('song-view--stage');
  document.body.classList.add('stage-active');

  const chrome = buildChrome();
  document.body.appendChild(chrome);
  let chromeVisible = true;

  // A−/A+ reenvian al Lector (reuso, sin tocar sus closures).
  chrome.querySelector('#stage-font-down').addEventListener('click', () =>
    songViewEl.querySelector('#font-decrease')?.click()
  );
  chrome.querySelector('#stage-font-up').addEventListener('click', () =>
    songViewEl.querySelector('#font-increase')?.click()
  );
  chrome.querySelector('#stage-exit').addEventListener('click', () => exitStage());

  // Re-parentar el FAB de autoscroll existente a la barra inferior.
  const fab = document.querySelector('.autoscroll-fab');
  if (fab) {
    fab.classList.add('autoscroll-fab--stage');
    chrome.querySelector('#stage-autoscroll-slot').appendChild(fab);
  }

  // Toque para mostrar/ocultar chrome.
  // Guard: ignora toques sobre el propio chrome (que vive fuera de songViewEl).
  const onTap = (e) => {
    if (chrome.contains(e.target)) return;
    chromeVisible = nextChromeVisible(chromeVisible);
    setChromeVisible(chrome, chromeVisible);
  };
  songViewEl.addEventListener('click', onTap);

  // Esc sale.
  const onKey = (e) => {
    if (e.key === 'Escape') exitStage();
  };
  document.addEventListener('keydown', onKey);

  // Wake Lock + re-adquisicion al volver de background.
  const wl = createWakeLock();
  wl.acquire();
  if (wl.supported) chrome.querySelector('#stage-wakelock').hidden = false;
  const onVis = () => {
    if (document.visibilityState === 'visible') wl.acquire();
  };
  document.addEventListener('visibilitychange', onVis);

  // Navegar (atras del navegador / cambio de hash) sale del escenario.
  const onNav = () => exitStage();
  window.addEventListener('hashchange', onNav);
  window.addEventListener('popstate', onNav);

  // Fullscreen nativo como mejora progresiva.
  requestStageFullscreen(document.documentElement);

  session = { songViewEl, chrome, fab, wl, onTap, onKey, onVis, onNav };
}

export function exitStage() {
  if (!session) return; // idempotente
  const { songViewEl, chrome, fab, wl, onTap, onKey, onVis, onNav } = session;

  songViewEl.removeEventListener('click', onTap);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('visibilitychange', onVis);
  window.removeEventListener('hashchange', onNav);
  window.removeEventListener('popstate', onNav);

  wl.release();
  exitStageFullscreen();

  // Devolver el FAB a body con su comportamiento normal.
  if (fab) {
    fab.classList.remove('autoscroll-fab--stage');
    document.body.appendChild(fab);
  }

  chrome.remove();
  songViewEl.classList.remove('song-view--stage');
  document.body.classList.remove('stage-active');

  session = null;
}
