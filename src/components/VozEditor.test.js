import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../router.js', () => ({ navigate: vi.fn() }));
vi.mock('../lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'token123' })),
}));
vi.mock('../lib/voiceover.js', () => ({
  splitVoiceover: vi.fn((body) => {
    const idx = body.indexOf('\n---\n');
    if (idx !== -1) {
      return { scripture: body.slice(0, idx).trim(), reflection: body.slice(idx + 5).trim() };
    }
    return { scripture: body, reflection: '' };
  }),
}));
vi.mock('../lib/liturgicalColor.js', () => ({
  liturgicalPalette: vi.fn(() => ({
    bg: '#1a3a2a',
    accent: '#4caf82',
    text: '#d4f0e5',
    label: 'Tiempo Ordinario',
  })),
  coverGradient: vi.fn(() => 'linear-gradient(135deg, #1a3a2a, #4caf82)'),
}));
vi.mock('../lib/escape.js', () => ({
  escapeHtml: (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
}));
vi.mock('../lib/icons.js', () => ({
  icon: (name) => `<svg data-icon="${name}"></svg>`,
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { renderVozEditor } from './VozEditor.js';

describe('VozEditor', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockFetch.mockReset();
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('renderiza el formulario de nueva voz en off (sin wordId)', async () => {
    await renderVozEditor(container, null);
    expect(container.querySelector('#voz-form')).toBeTruthy();
    expect(container.querySelector('#voz-sunday-date')).toBeTruthy();
    expect(container.querySelector('#voz-gospel-ref')).toBeTruthy();
    expect(container.querySelector('#voz-body')).toBeTruthy();
    expect(container.innerHTML).toContain('Nueva voz en off');
  });

  it('tiene botón Guardar borrador y Publicar, sin botón Eliminar en el footer', async () => {
    await renderVozEditor(container, null);
    expect(container.querySelector('#voz-save-draft')).toBeTruthy();
    expect(container.querySelector('#voz-publish')).toBeTruthy();
    expect(container.querySelector('.voz-editor__footer #voz-delete')).toBeNull();
    expect(container.querySelector('.voz-editor__footer-actions .btn--danger')).toBeNull();
  });

  it('no muestra la papelera en modo creación (sin wordId)', async () => {
    await renderVozEditor(container, null);
    expect(container.querySelector('#voz-delete')).toBeNull();
  });

  it('muestra la papelera en la barra superior cuando se edita una voz existente', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'ww1',
        sunday_date: '2026-06-15',
        gospel_ref: 'Jn 14,6',
        liturgical_title: '',
        liturgical_color: 'green',
        voiceover_body: 'Texto',
        gospel_body: '',
        published: false,
      }),
    });
    await renderVozEditor(container, 'ww1');
    const deleteBtn = container.querySelector('.voz-editor__topbar #voz-delete');
    expect(deleteBtn).toBeTruthy();
  });

  it('tiene botón Cargar desde ordo y input fecha', async () => {
    await renderVozEditor(container, null);
    expect(container.querySelector('#voz-load-ordo')).toBeTruthy();
    expect(container.querySelector('#voz-sunday-date')).toBeTruthy();
  });

  it('tiene área de evangelio colapsada (details/summary)', async () => {
    await renderVozEditor(container, null);
    expect(container.querySelector('#voz-gospel-body')).toBeTruthy();
    expect(container.querySelector('details')).toBeTruthy();
  });

  it('existe el segmented Editar / Vista previa', async () => {
    await renderVozEditor(container, null);
    const tabs = container.querySelectorAll('.voz-editor__seg-tab');
    expect(tabs.length).toBe(2);
    expect(container.querySelector('#voz-tab-edit').textContent).toContain('Editar');
    expect(container.querySelector('#voz-tab-preview').textContent).toContain('Vista previa');
  });

  it('al activar Vista previa se muestra el panel de preview y se oculta el de edición', async () => {
    await renderVozEditor(container, null);
    const editPanel = container.querySelector('#voz-panel-edit');
    const previewPanel = container.querySelector('#voz-panel-preview');
    expect(editPanel.hidden).toBe(false);
    expect(previewPanel.hidden).toBe(true);

    container.querySelector('#voz-tab-preview').click();

    expect(editPanel.hidden).toBe(true);
    expect(previewPanel.hidden).toBe(false);
    expect(container.querySelector('#voz-tab-preview').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('#voz-tab-edit').getAttribute('aria-selected')).toBe('false');
  });

  it('el preview usa la jerarquía nueva: título litúrgico en .voz-view__title, sin la cita', async () => {
    await renderVozEditor(container, null);
    container.querySelector('#voz-liturgical-title').value = 'XI Domingo del Tiempo Ordinario';
    container.querySelector('#voz-liturgical-title').dispatchEvent(new Event('input'));
    container.querySelector('#voz-gospel-ref').value = 'Jn 14,6';
    container.querySelector('#voz-gospel-ref').dispatchEvent(new Event('input'));
    const previewContent = container.querySelector('#voz-preview-content');
    const titleEl = previewContent.querySelector('.voz-view__title');
    expect(titleEl).toBeTruthy();
    expect(titleEl.textContent).toContain('XI Domingo del Tiempo Ordinario');
  });

  it('el preview muestra .voz-view__pill cuando hay color litúrgico seleccionado', async () => {
    await renderVozEditor(container, null);
    const greenChip = container.querySelector('.voz-editor__color-chip[data-color="green"]');
    greenChip.click();
    const previewContent = container.querySelector('#voz-preview-content');
    expect(previewContent.querySelector('.voz-view__pill')).toBeTruthy();
  });

  it('renderiza chips de color litúrgico en vez de <select>', async () => {
    await renderVozEditor(container, null);
    expect(container.querySelector('#voz-liturgical-color')).toBeNull();
    const chips = container.querySelectorAll('.voz-editor__color-chip');
    expect(chips.length).toBe(4);
    const colors = [...chips].map((c) => c.dataset.color);
    expect(colors).toEqual(['green', 'purple', 'white', 'red']);
  });

  it('seleccionar un chip de color actualiza liturgical_color y aria-checked', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'ww-new', published: false }),
    });
    await renderVozEditor(container, null);
    const purpleChip = container.querySelector('.voz-editor__color-chip[data-color="purple"]');
    purpleChip.click();
    expect(purpleChip.getAttribute('aria-checked')).toBe('true');
    container
      .querySelector('.voz-editor__color-chip[data-color="green"]')
      .getAttribute('aria-checked');
    expect(
      container
        .querySelector('.voz-editor__color-chip[data-color="green"]')
        .getAttribute('aria-checked'),
    ).toBe('false');

    container.querySelector('#voz-sunday-date').value = '2026-06-15';
    container.querySelector('#voz-gospel-ref').value = 'Jn 14,6';
    container.querySelector('#voz-body').value = 'Voz de prueba';
    container.querySelector('#voz-save-draft').click();
    await new Promise((r) => setTimeout(r, 0));
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.liturgical_color).toBe('purple');
  });

  it('vuelve a hacer click en el mismo chip lo deselecciona (liturgical_color null)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'ww-new', published: false }),
    });
    await renderVozEditor(container, null);
    const greenChip = container.querySelector('.voz-editor__color-chip[data-color="green"]');
    greenChip.click();
    greenChip.click();
    expect(greenChip.getAttribute('aria-checked')).toBe('false');

    container.querySelector('#voz-sunday-date').value = '2026-06-15';
    container.querySelector('#voz-gospel-ref').value = 'Jn 14,6';
    container.querySelector('#voz-body').value = 'Voz de prueba';
    container.querySelector('#voz-save-draft').click();
    await new Promise((r) => setTimeout(r, 0));
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.liturgical_color).toBeNull();
  });

  it('el preview se actualiza al escribir en el textarea', async () => {
    await renderVozEditor(container, null);
    const bodyArea = container.querySelector('#voz-body');
    const previewEl = container.querySelector('#voz-preview-content');
    bodyArea.value = 'Yo soy el camino.\n---\nReflexión sobre la verdad.';
    bodyArea.dispatchEvent(new Event('input'));
    expect(previewEl.innerHTML).toContain('Reflexión');
  });

  it('el preview muestra el separador de reflexión cuando hay reflexión', async () => {
    await renderVozEditor(container, null);
    const bodyArea = container.querySelector('#voz-body');
    bodyArea.value = 'Escritura.\n---\nMi reflexión aquí.';
    bodyArea.dispatchEvent(new Event('input'));
    const previewContent = container.querySelector('#voz-preview-content');
    // El separador usa clase .voz__reflection-sep con icono lucide (sin glifo ✦)
    expect(previewContent.querySelector('.voz__reflection-sep')).toBeTruthy();
    expect(previewContent.querySelector('.voz__reflection-sep').textContent).toContain('Reflexión');
  });

  it('carga voz existente cuando se pasa wordId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'ww1',
        sunday_date: '2026-06-15',
        gospel_ref: 'Jn 14,6',
        liturgical_title: 'XI Domingo',
        liturgical_color: 'green',
        voiceover_body: 'Texto voz en off',
        gospel_body: 'Evangelio',
        published: false,
      }),
    });
    await renderVozEditor(container, 'ww1');
    expect(container.querySelector('#voz-gospel-ref').value).toBe('Jn 14,6');
    expect(container.querySelector('#voz-body').value).toBe('Texto voz en off');
    expect(container.innerHTML).toContain('Editar voz en off');
    expect(
      container
        .querySelector('.voz-editor__color-chip[data-color="green"]')
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('muestra error si se intenta guardar sin fecha', async () => {
    await renderVozEditor(container, null);
    container.querySelector('#voz-sunday-date').value = '';
    container.querySelector('#voz-body').value = 'Texto de voz';
    container.querySelector('#voz-gospel-ref').value = 'Jn 1,1';
    container.querySelector('#voz-save-draft').click();
    const errorEl = container.querySelector('#voz-error');
    expect(errorEl.style.display).not.toBe('none');
  });

  it('muestra error si se intenta guardar sin gospel_ref', async () => {
    await renderVozEditor(container, null);
    container.querySelector('#voz-sunday-date').value = '2026-06-15';
    container.querySelector('#voz-gospel-ref').value = '';
    container.querySelector('#voz-body').value = 'Texto de voz';
    container.querySelector('#voz-save-draft').click();
    const errorEl = container.querySelector('#voz-error');
    expect(errorEl.style.display).not.toBe('none');
  });

  it('muestra error si se intenta guardar sin voiceover_body', async () => {
    await renderVozEditor(container, null);
    container.querySelector('#voz-sunday-date').value = '2026-06-15';
    container.querySelector('#voz-gospel-ref').value = 'Jn 1,1';
    container.querySelector('#voz-body').value = '';
    container.querySelector('#voz-save-draft').click();
    const errorEl = container.querySelector('#voz-error');
    expect(errorEl.style.display).not.toBe('none');
  });

  it('llama a POST /api/weekly-words al guardar borrador nuevo', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'ww-new', published: false }),
    });
    const { navigate } = await import('../router.js');
    await renderVozEditor(container, null);
    container.querySelector('#voz-sunday-date').value = '2026-06-15';
    container.querySelector('#voz-gospel-ref').value = 'Jn 14,6';
    container.querySelector('#voz-body').value = 'Voz de prueba';
    container.querySelector('#voz-save-draft').click();
    // Await microtasks
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/weekly-words',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(navigate).toHaveBeenCalledWith('/voz/ww-new');
  });

  it('llama a POST con published: true al publicar', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'ww-new', published: true }),
    });
    await renderVozEditor(container, null);
    container.querySelector('#voz-sunday-date').value = '2026-06-15';
    container.querySelector('#voz-gospel-ref').value = 'Jn 14,6';
    container.querySelector('#voz-body').value = 'Voz de prueba';
    container.querySelector('#voz-publish').click();
    await new Promise((r) => setTimeout(r, 0));
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.published).toBe(true);
  });

  it('llama a PATCH cuando se edita una voz existente', async () => {
    // First fetch: load existing word
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'ww1',
        sunday_date: '2026-06-15',
        gospel_ref: 'Jn 14,6',
        liturgical_title: '',
        liturgical_color: 'green',
        voiceover_body: 'Texto original',
        gospel_body: '',
        published: false,
      }),
    });
    // Second fetch: PATCH save
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'ww1', published: false }),
    });
    const { navigate } = await import('../router.js');
    await renderVozEditor(container, 'ww1');
    container.querySelector('#voz-save-draft').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/weekly-words/ww1',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(navigate).toHaveBeenCalledWith('/voz/ww1');
  });

  it('el botón Cargar desde ordo autocompleta los campos', async () => {
    await renderVozEditor(container, null);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        gospelRef: 'Mt 5,1-12',
        liturgicalTitle: 'IV Domingo',
        liturgicalColor: 'purple',
        gospelBody: 'Bienaventurados los pobres de espíritu...',
      }),
    });
    container.querySelector('#voz-sunday-date').value = '2026-06-15';
    container.querySelector('#voz-load-ordo').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('#voz-gospel-ref').value).toBe('Mt 5,1-12');
    expect(container.querySelector('#voz-liturgical-title').value).toBe('IV Domingo');
    expect(
      container
        .querySelector('.voz-editor__color-chip[data-color="purple"]')
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(container.querySelector('#voz-gospel-body').value).toContain('Bienaventurados');
  });

  it('muestra mensaje de no disponible cuando ordo retorna 404', async () => {
    await renderVozEditor(container, null);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    container.querySelector('#voz-sunday-date').value = '2026-06-15';
    container.querySelector('#voz-load-ordo').click();
    await new Promise((r) => setTimeout(r, 0));
    const statusEl = container.querySelector('#voz-ordo-status');
    expect(statusEl.textContent).toContain('No disponible');
  });

  it('muestra error si no hay fecha al cargar ordo', async () => {
    await renderVozEditor(container, null);
    container.querySelector('#voz-sunday-date').value = '';
    container.querySelector('#voz-load-ordo').click();
    const errorEl = container.querySelector('#voz-error');
    expect(errorEl.style.display).not.toBe('none');
  });

  it('renderiza el campo de título para búsqueda', async () => {
    await renderVozEditor(container, null);
    const titleInput = container.querySelector('#voz-title');
    expect(titleInput).toBeTruthy();
    expect(titleInput.placeholder).toContain('La vid');
  });

  it('carga el title existente al editar una voz', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'ww1',
        sunday_date: '2026-06-15',
        gospel_ref: 'Jn 14,6',
        liturgical_title: 'XI Domingo',
        liturgical_color: 'green',
        voiceover_body: 'Texto',
        gospel_body: '',
        published: false,
        title: 'La vid y los sarmientos',
      }),
    });
    await renderVozEditor(container, 'ww1');
    expect(container.querySelector('#voz-title').value).toBe('La vid y los sarmientos');
  });

  it('envía title en el cuerpo del POST al guardar borrador', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'ww-new', published: false }),
    });
    await renderVozEditor(container, null);
    container.querySelector('#voz-sunday-date').value = '2026-06-15';
    container.querySelector('#voz-gospel-ref').value = 'Jn 14,6';
    container.querySelector('#voz-body').value = 'Voz de prueba';
    container.querySelector('#voz-title').value = 'El camino la verdad y la vida';
    container.querySelector('#voz-save-draft').click();
    await new Promise((r) => setTimeout(r, 0));
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.title).toBe('El camino la verdad y la vida');
  });

  it('envía title null cuando el campo está vacío', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'ww-new', published: false }),
    });
    await renderVozEditor(container, null);
    container.querySelector('#voz-sunday-date').value = '2026-06-15';
    container.querySelector('#voz-gospel-ref').value = 'Jn 14,6';
    container.querySelector('#voz-body').value = 'Voz de prueba';
    container.querySelector('#voz-title').value = '';
    container.querySelector('#voz-save-draft').click();
    await new Promise((r) => setTimeout(r, 0));
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.title).toBeNull();
  });
});
