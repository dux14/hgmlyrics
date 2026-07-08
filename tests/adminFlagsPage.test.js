import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks de dependencias
// ---------------------------------------------------------------------------

vi.mock('../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'test-token' })),
}));

vi.mock('../src/router.js', () => ({
  navigate: vi.fn(),
}));

vi.mock('../src/lib/icons.js', () => ({
  icon: (name) => `<svg data-icon="${name}"></svg>`,
}));

vi.mock('../src/components/ConfirmDialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

// ---------------------------------------------------------------------------
// Import del componente (después de los mocks)
// ---------------------------------------------------------------------------

const { renderAdminFlagsPage, __resetProfilesCache } =
  await import('../src/components/AdminFlagsPage.js');
const { confirmDialog } = await import('../src/components/ConfirmDialog.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  __resetProfilesCache();
});

// ---------------------------------------------------------------------------
// Datos de muestra
// ---------------------------------------------------------------------------

const SAMPLE_USERS = [
  { id: 'p1', username: 'samu', displayName: 'Samuel', email: 'samu@x.com' },
  { id: 'p2', username: 'mari', displayName: 'Mari', email: 'mari@x.com' },
  { id: 'p3', username: 'juan', displayName: null, email: 'juan@x.com' },
];

const SAMPLE_FLAGS = [
  {
    key: 'voz_tono',
    description: 'Modo voz',
    enabledGlobal: false,
    users: [{ email: 'samu@x.com', username: 'samu' }],
  },
  {
    key: 'afinador_shortcut',
    description: 'Shortcut afinador',
    enabledGlobal: true,
    users: [],
  },
];

function mockFetch({ flags = SAMPLE_FLAGS, users = SAMPLE_USERS, onAction } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts = {}) => {
    if (url === '/api/admin/feature-flags' && (!opts.method || opts.method === 'GET')) {
      return { ok: true, json: async () => ({ flags }) };
    }
    if (url === '/api/admin/profiles') {
      return { ok: true, json: async () => ({ users }) };
    }
    if (url === '/api/admin/feature-flags') {
      const body = opts.body ? JSON.parse(opts.body) : {};
      if (onAction) {
        const res = onAction(opts.method, body);
        if (res) return res;
      }
      return { ok: true, json: async () => ({ success: true }) };
    }
    return { ok: false, json: async () => ({}) };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderAdminFlagsPage — carga', () => {
  it('muestra skeleton y luego renderiza una .ff-item por flag', async () => {
    mockFetch();
    const container = makeContainer();
    renderAdminFlagsPage(container);

    // Skeleton visible antes de resolver (o al menos no revienta).
    await flush();

    const items = container.querySelectorAll('.ff-item');
    expect(items.length).toBe(SAMPLE_FLAGS.length);
  });

  it('cada item muestra key, descripción y switch global', async () => {
    mockFetch();
    const container = makeContainer();
    renderAdminFlagsPage(container);
    await flush();

    const first = container.querySelectorAll('.ff-item')[0];
    expect(first.textContent).toContain('voz_tono');
    expect(first.textContent).toContain('Modo voz');
    const globalSwitch = first.querySelector('.ff-global');
    expect(globalSwitch).not.toBeNull();
    expect(globalSwitch.checked).toBe(false);

    const second = container.querySelectorAll('.ff-item')[1];
    expect(second.querySelector('.ff-global').checked).toBe(true);
  });
});

describe('renderAdminFlagsPage — buscador y agregar', () => {
  it('filtra por username/displayName y excluye ya asignados; escribe query vacía = sin resultados', async () => {
    mockFetch();
    const container = makeContainer();
    renderAdminFlagsPage(container);
    await flush();

    const first = container.querySelectorAll('.ff-item')[0]; // samu asignado
    const search = first.querySelector('.ff-search');
    expect(first.querySelectorAll('.ff-results li').length).toBe(0);

    search.value = 'a';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const results = [...first.querySelectorAll('.ff-results li')].map((li) => li.textContent);
    // samu está asignado → no debe aparecer aunque matchee "a"
    expect(results.some((t) => t.includes('samu'))).toBe(false);
    // mari matchea "a" por username/displayName
    expect(results.some((t) => t.includes('Mari') || t.includes('mari'))).toBe(true);
  });

  it('marcar checkboxes actualiza el contador del botón Agregar', async () => {
    mockFetch();
    const container = makeContainer();
    renderAdminFlagsPage(container);
    await flush();

    const second = container.querySelectorAll('.ff-item')[1]; // sin asignados
    const search = second.querySelector('.ff-search');
    search.value = 'a'; // matchea mari, juan? juan no tiene 'a'... usar 'a' matches mari (Mari) and juan? no
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const addBtn = second.querySelector('.ff-add-btn');
    expect(addBtn.disabled).toBe(true);
    expect(addBtn.textContent).toContain('0');

    const checkbox = second.querySelector('.ff-results input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    expect(addBtn.disabled).toBe(false);
    expect(addBtn.textContent).toContain('1');
  });

  it('click en Agregar dispara POST batch con los usuarios marcados', async () => {
    let capturedBody = null;
    mockFetch({
      onAction: (method, body) => {
        if (method === 'POST' && body.action === 'assign') {
          capturedBody = body;
        }
        return null;
      },
    });
    const container = makeContainer();
    renderAdminFlagsPage(container);
    await flush();

    const second = container.querySelectorAll('.ff-item')[1];
    const search = second.querySelector('.ff-search');
    search.value = 'mari';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const checkbox = second.querySelector('.ff-results input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    const addBtn = second.querySelector('.ff-add-btn');
    addBtn.click();
    await flush();

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.action).toBe('assign');
    expect(capturedBody.flagKey).toBe('afinador_shortcut');
    expect(capturedBody.users).toEqual([{ username: 'mari' }]);
  });
});

describe('renderAdminFlagsPage — switch global', () => {
  it('togglear switch es optimista y dispara POST toggle-global', async () => {
    let capturedBody = null;
    mockFetch({
      onAction: (method, body) => {
        if (method === 'POST' && body.action === 'toggle-global') capturedBody = body;
        return null;
      },
    });
    const container = makeContainer();
    renderAdminFlagsPage(container);
    await flush();

    const first = container.querySelectorAll('.ff-item')[0];
    const toggle = first.querySelector('.ff-global');
    expect(toggle.checked).toBe(false);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    // Optimista: ya refleja el nuevo estado sin esperar la red.
    expect(toggle.checked).toBe(true);
    await flush();

    expect(capturedBody).toEqual({ action: 'toggle-global', key: 'voz_tono', enabled: true });
  });

  it('revierte el switch si la respuesta no es ok', async () => {
    mockFetch({
      onAction: (method, body) => {
        if (method === 'POST' && body.action === 'toggle-global') {
          return { ok: false, json: async () => ({ error: 'falló' }) };
        }
        return null;
      },
    });
    const container = makeContainer();
    renderAdminFlagsPage(container);
    await flush();

    const first = container.querySelectorAll('.ff-item')[0];
    const toggle = first.querySelector('.ff-global');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(toggle.checked).toBe(false);
  });
});

describe('renderAdminFlagsPage — quitar chip', () => {
  it('pide confirmación y dispara DELETE de la asignación', async () => {
    let capturedBody = null;
    let capturedMethod = null;
    mockFetch({
      onAction: (method, body) => {
        capturedMethod = method;
        capturedBody = body;
        return null;
      },
    });
    const container = makeContainer();
    renderAdminFlagsPage(container);
    await flush();

    const first = container.querySelectorAll('.ff-item')[0];
    const chipRemove = first.querySelector('.ff-chip button');
    expect(chipRemove).not.toBeNull();

    chipRemove.click();
    await flush();

    expect(confirmDialog).toHaveBeenCalled();
    const call = vi.mocked(confirmDialog).mock.calls[0][0];
    expect(call.title).toBe('Quitar acceso');
    expect(capturedMethod).toBe('DELETE');
    expect(capturedBody.flagKey).toBe('voz_tono');
  });
});

describe('renderAdminFlagsPage — crear flag', () => {
  it('key inválida no dispara fetch de creación', async () => {
    let created = false;
    mockFetch({
      onAction: (method, body) => {
        if (method === 'POST' && body.action === 'create') created = true;
        return null;
      },
    });
    const container = makeContainer();
    renderAdminFlagsPage(container);
    await flush();

    const keyInput = container.querySelector('#ff-new-key');
    const descInput = container.querySelector('#ff-new-desc');
    const form = container.querySelector('.ff-create-form');

    keyInput.value = 'INVALIDO-123';
    descInput.value = 'desc';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(created).toBe(false);
  });

  it('key válida dispara POST create', async () => {
    let capturedBody = null;
    mockFetch({
      onAction: (method, body) => {
        if (method === 'POST' && body.action === 'create') capturedBody = body;
        return null;
      },
    });
    const container = makeContainer();
    renderAdminFlagsPage(container);
    await flush();

    const keyInput = container.querySelector('#ff-new-key');
    const descInput = container.querySelector('#ff-new-desc');
    const form = container.querySelector('.ff-create-form');

    keyInput.value = 'nueva_flag';
    descInput.value = 'Una flag nueva';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(capturedBody).toEqual({
      action: 'create',
      key: 'nueva_flag',
      description: 'Una flag nueva',
    });
  });
});

describe('renderAdminFlagsPage — eliminar flag', () => {
  it('pide confirmación danger y dispara DELETE action:flag', async () => {
    let capturedBody = null;
    let capturedMethod = null;
    mockFetch({
      onAction: (method, body) => {
        if (body.action === 'flag') {
          capturedMethod = method;
          capturedBody = body;
        }
        return null;
      },
    });
    const container = makeContainer();
    renderAdminFlagsPage(container);
    await flush();

    const first = container.querySelectorAll('.ff-item')[0];
    const deleteBtn = first.querySelector('.ff-delete-flag');
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn.className).toContain('btn--danger');

    deleteBtn.click();
    await flush();

    expect(confirmDialog).toHaveBeenCalled();
    const call = vi.mocked(confirmDialog).mock.calls.at(-1)[0];
    expect(call.danger).toBe(true);
    expect(call.title).toBe('Eliminar flag');
    expect(capturedMethod).toBe('DELETE');
    expect(capturedBody).toEqual({ action: 'flag', key: 'voz_tono' });
  });
});
