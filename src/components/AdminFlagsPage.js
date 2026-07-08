import { renderAdminSection } from './AdminSection.js';

// TODO(Task 6): mover aquí loadFlags/wireFeatureFlags/buildSelectHtml/loadProfiles
// desde el AdminDashboard.js original.
/** Sub-página admin: gestión de feature flags. */
export function renderAdminFlagsPage(container) {
  const body = renderAdminSection(container, {
    title: 'Feature Flags',
    iconName: 'flag',
  });
  body.innerHTML = `<div id="ff-list" class="ff-list"></div>`;
}
