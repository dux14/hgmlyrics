// Usuarios reconocidos como fundadores (badge de corona en su avatar).
// 'samu' es temporal para pruebas; se quita en un commit posterior.
export const FOUNDER_USERNAMES = ['mari', 'samu'];

export function isFounder(username) {
  if (!username) return false;
  return FOUNDER_USERNAMES.includes(String(username).toLowerCase());
}

// Markup del badge (referencia al sprite de index.html). aria-hidden: decorativo.
export function founderCrownHtml() {
  return '<svg class="avatar-crown" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#founder-crown"/></svg>';
}
