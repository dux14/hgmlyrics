// Escapa para contenido de texto/atributo en innerHTML.
export function escapeHtml(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Valida que una URL sea http(s) absoluta; si no, devuelve ''.
export function safeUrl(value) {
  try {
    const u = new URL(String(value), globalThis.location?.origin);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}
