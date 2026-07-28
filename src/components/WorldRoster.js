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
  el.className = 'wr-overlay';

  // Panel visible con fondo semitransparente
  const panel = document.createElement('div');
  panel.className = 'wr-panel';
  el.appendChild(panel);

  // Encabezado con conteo
  const header = document.createElement('div');
  header.className = 'wr-header';
  panel.appendChild(header);

  // Lista de nombres
  const list = document.createElement('ul');
  list.className = 'wr-list';
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
      li.className = 'wr-entry';
      li.textContent = name;
      list.appendChild(li);
    });
  }

  // Estado inicial vacío
  setRoster([]);

  return { el, setRoster };
}
