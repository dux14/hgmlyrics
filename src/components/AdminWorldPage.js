import { renderAdminSection } from './AdminSection.js';
import { mountAdminWorldPanel } from './AdminWorldPanel.js';
import '../styles/admin-world.css';

/** Sub-página admin: administración de mapas/tilesets del mundo virtual. */
export function renderAdminWorldPage(container) {
  const body = renderAdminSection(container, {
    title: 'Mundo Virtual',
    iconName: 'globe',
  });
  mountAdminWorldPanel(body);
}
