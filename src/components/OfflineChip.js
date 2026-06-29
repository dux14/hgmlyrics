import { subscribe, isOffline } from '../lib/offlineState.js';

export function mountOfflineChip(root = document.body) {
  const chip = document.createElement('div');
  chip.className = 'offline-chip';
  chip.setAttribute('role', 'status');
  chip.setAttribute('aria-live', 'polite');
  chip.hidden = true;
  chip.textContent = 'Sin conexión';
  root.appendChild(chip);

  let offlineSince = 0;
  let hideTimer = null;
  const render = (online) => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (!online) {
      chip.hidden = false;
      chip.textContent = 'Sin conexión';
      offlineSince = performance.now();
      return;
    }
    if (offlineSince && performance.now() - offlineSince > 2000) {
      chip.hidden = false;
      chip.textContent = 'Conexión restaurada';
      hideTimer = setTimeout(() => { chip.hidden = true; hideTimer = null; }, 3500);
    } else {
      chip.hidden = true;
    }
    offlineSince = 0;
  };
  subscribe(render);
  if (isOffline()) render(false);
  return chip;
}
