// Ciclo de vida de carga por región: shell instantáneo + skeleton por región,
// SWR, anti-flash y error+Reintentar. Estandariza lo que estaba copy-pasteado.

const FLASH_DELAY_MS = 150;

/**
 * @param {HTMLElement} regionEl  contenedor de la región async
 * @param {object} opts
 * @param {*} [opts.cached]              data sync disponible (SWR)
 * @param {() => string} opts.skeleton  HTML del skeleton del arquetipo
 * @param {() => Promise<*>} opts.fetcher
 * @param {(data:*) => void} opts.render pinta el contenido real en regionEl
 * @param {() => string} [opts.empty]    HTML de estado vacío
 * @param {() => string} [opts.onError]  HTML de error (incluir [data-retry])
 */
export function renderAsyncRegion(regionEl, opts) {
  const { cached, skeleton, fetcher, render, empty, onError } = opts;

  const isEmpty = (d) => d == null || (Array.isArray(d) && d.length === 0);
  const paint = (data) => {
    regionEl.setAttribute('aria-busy', 'false');
    if (isEmpty(data) && empty) regionEl.innerHTML = empty();
    else render(data);
  };

  // SWR: si hay cache, pinta ya y revalida en silencio.
  if (cached != null) {
    paint(cached);
    fetcher().then((fresh) => { if (!isEmpty(fresh)) paint(fresh); }).catch(() => {});
    return;
  }

  regionEl.setAttribute('aria-busy', 'true');
  let settled = false;
  let mounted = false;
  const timer = setTimeout(() => {
    if (!settled) { regionEl.innerHTML = skeleton(); mounted = true; }
  }, FLASH_DELAY_MS);

  fetcher()
    .then((data) => {
      settled = true;
      clearTimeout(timer);
      if (mounted) regionEl.classList.add('fade-in');
      paint(data);
    })
    .catch((err) => {
      settled = true;
      clearTimeout(timer);
      regionEl.setAttribute('aria-busy', 'false');
      if (!onError) throw err;
      regionEl.innerHTML = onError();
      regionEl.querySelector('[data-retry]')
        ?.addEventListener('click', () => renderAsyncRegion(regionEl, opts));
    });
}
