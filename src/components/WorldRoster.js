/**
 * WorldRoster.js — Panel de presencia del mundo virtual.
 *
 * Muestra la lista de usuarios conectados en una superposición sobre el canvas.
 * Actualizable sin re-montar mediante setRoster().
 *
 * Uso:
 *   const roster = WorldRoster();
 *   container.appendChild(roster.el);
 *   roster.setRoster([{ uid: 'abc', name: 'Ana' }, ...]);
 */

/**
 * @typedef {{ uid: string, name: string }} RosterEntry
 */

/**
 * Crea el componente de roster.
 * @returns {{ el: HTMLElement, setRoster: (entries: RosterEntry[]) => void }}
 */
export function WorldRoster() {
  // Contenedor exterior: no intercepta clicks en el canvas
  const el = document.createElement('div');
  el.style.cssText = [
    'position:absolute',
    'top:12px',
    'right:12px',
    'pointer-events:none',
    'z-index:10',
  ].join(';');

  // Panel visible con fondo semitransparente
  const panel = document.createElement('div');
  panel.style.cssText = [
    'background:rgba(0,0,0,0.55)',
    'border:1px solid rgba(255,255,255,0.15)',
    'border-radius:6px',
    'padding:8px 12px',
    'min-width:140px',
    'pointer-events:auto',
    'font-family:sans-serif',
    'font-size:12px',
    'color:#e0e0e0',
  ].join(';');
  el.appendChild(panel);

  // Encabezado con conteo
  const header = document.createElement('div');
  header.style.cssText = 'font-weight:600;margin-bottom:6px;color:#90caf9;';
  panel.appendChild(header);

  // Lista de nombres
  const list = document.createElement('ul');
  list.style.cssText = 'list-style:none;margin:0;padding:0;';
  panel.appendChild(list);

  /**
   * Re-renderiza la lista a partir de entries.
   * Usa textContent (no innerHTML) para evitar XSS con nombres de usuario.
   * @param {RosterEntry[]} entries
   */
  function setRoster(entries) {
    header.textContent = `En línea (${entries.length})`;
    list.replaceChildren();
    entries.forEach(({ name }) => {
      const li = document.createElement('li');
      li.style.cssText =
        'padding:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;';
      li.textContent = name;
      list.appendChild(li);
    });
  }

  // Estado inicial vacío
  setRoster([]);

  return { el, setRoster };
}
