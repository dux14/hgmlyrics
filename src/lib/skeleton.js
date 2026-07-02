// Primitivas de skeleton: devuelven HTML string sobre la clase .skeleton
// (shimmer definido en base-utilities.css). Sin DOM ni efectos → testeable.

const box = (cls, style) =>
  `<div class="skeleton ${cls}" style="${style}" aria-hidden="true"></div>`;

export function skelLine({ w = '100%', h = 14 } = {}) {
  return box('sk-line', `width:${w};height:${h}px`);
}

export function skelBlock({ w = '100%', h = 120, radius = 14 } = {}) {
  return box('sk-block', `width:${w};height:${h}px;border-radius:${radius}px`);
}

export function skelCircle({ size = 48 } = {}) {
  return box('sk-circle', `width:${size}px;height:${size}px;border-radius:50%`);
}

export function skelThumb({ size = 46, radius = 9 } = {}) {
  return box('sk-thumb', `width:${size}px;height:${size}px;border-radius:${radius}px`);
}

export function skelRow() {
  return `<div class="sk-row" aria-hidden="true">${skelThumb()}<div class="sk-row-tx">${skelLine({ w: '70%' })}${skelLine({ w: '45%', h: 11 })}</div></div>`;
}

export function skelCard() {
  return `<div class="sk-card" aria-hidden="true">${skelBlock({ h: 120, radius: 12 })}${skelLine({ w: '80%' })}${skelLine({ w: '55%', h: 11 })}</div>`;
}

export function skelGrid(n = 6) {
  const tiles = Array.from({ length: n }, () => box('sk-tile', 'aspect-ratio:1;border-radius:12px')).join('');
  return `<div class="sk-grid" aria-hidden="true">${tiles}</div>`;
}
