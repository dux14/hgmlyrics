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
  const render = (online) => {
    if (!online) {
      chip.hidden = false;
      chip.textContent = 'Sin conexión';
      offlineSince = performance.now();
      return;
    }
    if (offlineSince && performance.now() - offlineSince > 2000) {
      chip.hidden = false;
      chip.textContent = 'Conexión restaurada';
      setTimeout(() => {
        chip.hidden = true;
      }, 3500);
    } else {
      chip.hidden = true;
    }
    offlineSince = 0;
  };
  subscribe(render);
  if (isOffline()) render(false);
  return chip;
}
