/** Toast transitorio compartido (patrón .toast ya existente en styles). */
export function showToast(message, { type = 'success', duration = 2500 } = {}) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle('toast--error', type === 'error');
  toast.classList.add('visible');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}
