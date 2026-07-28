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
  return `<div class="sk-row" aria-hidden="true">${skelThumb()}<div class="sk-rtx">${skelLine({ w: '70%' })}${skelLine({ w: '45%', h: 11 })}</div></div>`;
}

export function skelCard() {
  return `<div class="sk-card" aria-hidden="true">${skelBlock({ h: 120, radius: 12 })}${skelLine({ w: '80%' })}${skelLine({ w: '55%', h: 11 })}</div>`;
}

export function skelGrid(n = 6) {
  const tiles = Array.from({ length: n }, () =>
    box('sk-tile', 'aspect-ratio:1;border-radius:12px'),
  ).join('');
  return `<div class="sk-grid" aria-hidden="true">${tiles}</div>`;
}

const rows = (n) => Array.from({ length: n }, () => skelRow()).join('');
const para = (widths) =>
  `<div class="sk-para" aria-hidden="true">${widths.map((w) => skelLine({ w, h: 12 })).join('')}</div>`;

export function skelTracklist({ rows: n = 4 } = {}) {
  return `<div class="sk-arch" aria-hidden="true">${skelBlock({ h: 150, radius: 16 })}${skelLine({ w: '62%', h: 22 })}${skelLine({ w: '40%', h: 12 })}<div class="sk-gap"></div>${rows(n)}</div>`;
}

export function skelSongDetail() {
  return `<div class="sk-arch" aria-hidden="true">${skelLine({ w: '60%', h: 22 })}${skelLine({ w: '38%', h: 12 })}<div class="sk-actions">${skelBlock({ w: '120px', h: 44, radius: 22 })}${skelCircle({ size: 44 })}${skelCircle({ size: 44 })}</div>${para(['95%', '88%', '70%', '30%', '95%', '88%', '60%'])}</div>`;
}

export function skelRowList({ rows: n = 4 } = {}) {
  return `<div class="sk-arch" aria-hidden="true">${skelLine({ w: '45%', h: 22 })}${skelLine({ w: '28%', h: 12 })}<div class="sk-gap"></div>${rows(n)}</div>`;
}

export function skelProfile() {
  // Sección superior centrada: avatar grande (~104px), nombre, usuario, badge de voz
  const top = `<div style="display:flex;flex-direction:column;align-items:center;margin-bottom:20px">${skelCircle({ size: 104 })}${skelLine({ w: '52%', h: 23 })}${skelLine({ w: '36%', h: 14 })}${skelBlock({ w: '90px', h: 22, radius: 11 })}</div>`;
  // Botón primario "Editar perfil" (pastilla centrada)
  const editBtn = `<div style="display:flex;justify-content:center;margin-bottom:16px">${skelBlock({ w: '148px', h: 40, radius: 20 })}</div>`;
  // Tarjeta de rango vocal: título, onda canvas (~110px), etiqueta
  const rangeCard = `<div style="margin-bottom:12px">${skelLine({ w: '42%', h: 13 })}${skelBlock({ h: 110, radius: 10 })}${skelLine({ w: '75%', h: 12 })}</div>`;
  // Tarjeta de instrumentos: título + chips en fila horizontal
  const instrCard = `<div style="margin-bottom:16px">${skelLine({ w: '40%', h: 13 })}<div style="display:flex;gap:8px">${skelBlock({ w: '72px', h: 28, radius: 14 })}${skelBlock({ w: '72px', h: 28, radius: 14 })}${skelBlock({ w: '64px', h: 28, radius: 14 })}</div></div>`;
  // Etiqueta "Cuenta" (línea estrecha) + 3 filas de acceso con icono 38px
  const accRow = `<div class="sk-row">${skelCircle({ size: 38 })}<div class="sk-rtx">${skelLine({ w: '50%' })}</div></div>`;
  return `<div class="sk-arch" aria-hidden="true">${top}${editBtn}${rangeCard}${instrCard}${skelLine({ w: '28%', h: 11 })}${accRow}${accRow}${accRow}</div>`;
}

export function skelLongText() {
  return `<div class="sk-arch" aria-hidden="true">${skelBlock({ h: 110, radius: 14 })}${skelLine({ w: '72%', h: 22 })}${skelLine({ w: '34%', h: 12 })}${para(['95%', '95%', '88%', '70%'])}</div>`;
}
