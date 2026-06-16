import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks de dependencias
// ---------------------------------------------------------------------------

vi.mock('../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'test-token' })),
  isAdmin: vi.fn(() => false),
}));

vi.mock('../src/lib/store.js', () => ({
  getState: vi.fn(() => ({ songs: [] })),
}));

vi.mock('../src/router.js', () => ({
  navigate: vi.fn(),
}));

vi.mock('../src/lib/icons.js', () => ({
  icon: (name) => `<svg data-icon="${name}"></svg>`,
}));

vi.mock('../src/components/AdminWorldPanel.js', () => ({
  mountAdminWorldPanel: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import del componente (después de los mocks)
// ---------------------------------------------------------------------------
// Importamos solo buildSelectHtml y loadFlags indirectamente a través del render.
// renderAdminDashboard invoca loadFlags que llama a fetch.

const { renderAdminDashboard } = await import('../src/components/AdminDashboard.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Datos de muestra
// ---------------------------------------------------------------------------

const SAMPLE_USERS = [
  { id: 'p1', username: 'samu', displayName: 'Samuel' },
  { id: 'p2', username: 'mari', displayName: 'Mari' },
  { id: 'p3', username: 'juan', displayName: null },
];

const SAMPLE_FLAGS = [
  {
    key: 'voz_tono',
    description: 'Modo voz',
    enabledGlobal: false,
    users: [{ email: null, username: 'samu' }],
  },
  {
    key: 'afinador_shortcut',
    description: 'Shortcut',
    enabledGlobal: false,
    users: [],
  },
];

function mockFetch({ flags = SAMPLE_FLAGS, users = SAMPLE_USERS } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (url === '/api/admin/feature-flags') {
      return { ok: true, json: async () => ({ flags }) };
    }
    if (url === '/api/admin/profiles') {
      return { ok: true, json: async () => ({ users }) };
    }
    return { ok: false };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderAdminDashboard — estructura base', () => {
  beforeEach(() => {
    // Silenciar las llamadas a fetch del mount (loadFlags + loadProfiles)
    mockFetch();
  });

  it('monta el panel con botones de crear y modificar', () => {
    const container = makeContainer();
    renderAdminDashboard(container);
    expect(container.querySelector('#btn-create')).not.toBeNull();
    expect(container.querySelector('#btn-edit')).not.toBeNull();
    expect(container.querySelector('#ff-list')).not.toBeNull();
  });
});

describe('renderAdminDashboard — agregador por select', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renderiza un <select class="ff-select"> por cada flag', async () => {
    mockFetch();
    const container = makeContainer();
    renderAdminDashboard(container);

    // Esperar a que loadFlags resuelva sus fetch
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const selects = container.querySelectorAll('.ff-select');
    expect(selects.length).toBe(SAMPLE_FLAGS.length);
  });

  it('excluye usuarios ya asignados del select de esa flag', async () => {
    mockFetch();
    const container = makeContainer();
    renderAdminDashboard(container);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Primera flag tiene 'samu' asignado → no debe aparecer en su select
    const ffItems = container.querySelectorAll('.ff-item');
    const firstFlagSelect = ffItems[0].querySelector('.ff-select');
    const optionValues = [...firstFlagSelect.options].map((o) => o.value);
    expect(optionValues).not.toContain('samu');
    // mari y juan sí deben estar disponibles
    expect(optionValues).toContain('mari');
    expect(optionValues).toContain('juan');
  });

  it('no excluye usuarios de flags que no los tienen asignados', async () => {
    mockFetch();
    const container = makeContainer();
    renderAdminDashboard(container);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Segunda flag no tiene asignados → debe tener todos los usuarios
    const ffItems = container.querySelectorAll('.ff-item');
    const secondFlagSelect = ffItems[1].querySelector('.ff-select');
    const optionValues = [...secondFlagSelect.options].map((o) => o.value);
    expect(optionValues).toContain('samu');
    expect(optionValues).toContain('mari');
    expect(optionValues).toContain('juan');
  });

  it('deshabilita select/botón cuando todos los usuarios están asignados', async () => {
    // Flag con todos los usuarios asignados
    const allAssigned = [
      {
        key: 'voz_tono',
        description: 'Modo voz',
        enabledGlobal: false,
        users: [
          { email: null, username: 'samu' },
          { email: null, username: 'mari' },
          { email: null, username: 'juan' },
        ],
      },
    ];
    mockFetch({ flags: allAssigned });
    const container = makeContainer();
    renderAdminDashboard(container);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const select = container.querySelector('.ff-select');
    const addBtn = container.querySelector('.ff-add');
    expect(select.disabled).toBe(true);
    expect(addBtn.disabled).toBe(true);
  });

  it('el label del select usa "DisplayName (@username)" si hay displayName', async () => {
    mockFetch({ flags: [{ key: 'voz_tono', description: '', enabledGlobal: false, users: [] }] });
    const container = makeContainer();
    renderAdminDashboard(container);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const select = container.querySelector('.ff-select');
    // Samuel tiene displayName → debe aparecer como "Samuel (@samu)"
    const samuOption = [...select.options].find((o) => o.value === 'samu');
    expect(samuOption).not.toBeNull();
    expect(samuOption.textContent).toContain('Samuel');
    expect(samuOption.textContent).toContain('@samu');
  });

  it('el label del select usa "@username" si no hay displayName', async () => {
    mockFetch({ flags: [{ key: 'voz_tono', description: '', enabledGlobal: false, users: [] }] });
    const container = makeContainer();
    renderAdminDashboard(container);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const select = container.querySelector('.ff-select');
    // juan no tiene displayName
    const juanOption = [...select.options].find((o) => o.value === 'juan');
    expect(juanOption).not.toBeNull();
    expect(juanOption.textContent.trim()).toBe('@juan');
  });

  it('mantiene el botón Quitar para usuarios ya asignados', async () => {
    mockFetch();
    const container = makeContainer();
    renderAdminDashboard(container);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Primera flag tiene 'samu' asignado → debe tener botón Quitar
    const ffItems = container.querySelectorAll('.ff-item');
    const removeBtn = ffItems[0].querySelector('.ff-remove');
    expect(removeBtn).not.toBeNull();
    expect(removeBtn.dataset.username).toBe('samu');
  });
});
