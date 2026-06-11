/**
 * adminWorldPanel.test.js — Pruebas de estructura DOM y comportamiento básico
 * del componente AdminWorldPanel.
 *
 * Se usan mocks de jsdom para no depender del entorno de browser real.
 */
/* global File */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks de dependencias externas
// ---------------------------------------------------------------------------

vi.mock('../../src/lib/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'test-token' })),
  isAdmin: vi.fn(() => true),
}));

// Mock de worldMapStore admin functions
const mockListMaps = vi.fn();
const mockSaveMap = vi.fn();
const mockActivate = vi.fn();

vi.mock('../../src/world/worldMapStore.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    listMaps: mockListMaps,
    saveMap: mockSaveMap,
    activate: mockActivate,
  };
});

// icons.js devuelve strings SVG; en jsdom solo necesitamos que no falle.
vi.mock('../../src/lib/icons.js', () => ({
  icon: (name) => `<svg data-icon="${name}"></svg>`,
}));

const { mountAdminWorldPanel } = await import('../../src/components/AdminWorldPanel.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

// Limpieza del DOM entre tests: los IDs del panel (wm-map-file, etc.) son
// únicos por diseño, pero jsdom confunde querySelector en el container cuando
// hay duplicados en el body de tests anteriores.
afterEach(() => {
  document.body.innerHTML = '';
});

const SAMPLE_MAPS = [
  { id: 'uuid-1', name: 'Mapa A', isActive: true, updatedAt: '2024-06-10T12:00:00Z' },
  { id: 'uuid-2', name: 'Mapa B', isActive: false, updatedAt: '2024-06-09T10:00:00Z' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mountAdminWorldPanel — estructura DOM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListMaps.mockResolvedValue([]);
  });

  it('monta el panel con el formulario de subir mapa', async () => {
    const container = makeContainer();
    mountAdminWorldPanel(container);

    expect(container.querySelector('#wm-name')).not.toBeNull();
    expect(container.querySelector('#wm-map-file')).not.toBeNull();
    expect(container.querySelector('#wm-tileset-file')).not.toBeNull();
    expect(container.querySelector('#wm-save-btn')).not.toBeNull();
    expect(container.querySelector('#wm-versions-list')).not.toBeNull();
  });

  it('el botón Guardar comienza deshabilitado', () => {
    const container = makeContainer();
    mountAdminWorldPanel(container);

    const saveBtn = container.querySelector('#wm-save-btn');
    expect(saveBtn.disabled).toBe(true);
  });
});

describe('mountAdminWorldPanel — lista de versiones', () => {
  beforeEach(() => vi.clearAllMocks());

  it('llama a listMaps al montar y muestra los mapas retornados', async () => {
    mockListMaps.mockResolvedValue(SAMPLE_MAPS);
    const container = makeContainer();
    mountAdminWorldPanel(container);

    // Esperar a que la promise de listMaps se resuelva
    await new Promise((r) => setTimeout(r, 0));

    const versionsList = container.querySelector('#wm-versions-list');
    expect(mockListMaps).toHaveBeenCalledOnce();
    // Debe haber dos items de versión
    expect(versionsList.querySelectorAll('.wm-version-item')).toHaveLength(2);
    expect(versionsList.textContent).toContain('Mapa A');
    expect(versionsList.textContent).toContain('Mapa B');
  });

  it('muestra mensaje cuando no hay mapas', async () => {
    mockListMaps.mockResolvedValue([]);
    const container = makeContainer();
    mountAdminWorldPanel(container);

    await new Promise((r) => setTimeout(r, 0));

    const versionsList = container.querySelector('#wm-versions-list');
    expect(versionsList.textContent).toContain('No hay mapas guardados');
  });

  it('el mapa activo no muestra botón Activar', async () => {
    mockListMaps.mockResolvedValue(SAMPLE_MAPS);
    const container = makeContainer();
    mountAdminWorldPanel(container);

    await new Promise((r) => setTimeout(r, 0));

    const items = container.querySelectorAll('.wm-version-item');
    // primer item (isActive: true) no tiene botón Activar
    expect(items[0].querySelector('.wm-activate-btn')).toBeNull();
    // segundo item (isActive: false) sí lo tiene
    expect(items[1].querySelector('.wm-activate-btn')).not.toBeNull();
  });

  it('clic en Activar llama a activate y refresca la lista', async () => {
    mockListMaps.mockResolvedValue(SAMPLE_MAPS);
    mockActivate.mockResolvedValue({ map: { ...SAMPLE_MAPS[1], isActive: true } });
    // Tras activate, listMaps devuelve el estado actualizado
    mockListMaps.mockResolvedValueOnce(SAMPLE_MAPS).mockResolvedValueOnce([
      { ...SAMPLE_MAPS[0], isActive: false },
      { ...SAMPLE_MAPS[1], isActive: true },
    ]);

    const container = makeContainer();
    mountAdminWorldPanel(container);
    await new Promise((r) => setTimeout(r, 0));

    const activateBtn = container.querySelector('.wm-activate-btn');
    activateBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockActivate).toHaveBeenCalledWith({ id: 'uuid-2' });
    // listMaps debería haber sido llamado dos veces (mount + tras activate)
    expect(mockListMaps).toHaveBeenCalledTimes(2);
  });
});

describe('mountAdminWorldPanel — validación de map.json', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListMaps.mockResolvedValue([]);
  });

  it('muestra errores de validación cuando el JSON de Tiled es inválido', async () => {
    const container = makeContainer();
    mountAdminWorldPanel(container);

    const mapFileInput = container.querySelector('#wm-map-file');
    const validationErrors = container.querySelector('#wm-validation-errors');

    // Simular selección de archivo con JSON inválido (sin capas requeridas)
    const invalidJson = JSON.stringify({ width: 10, height: 10 });
    const file = new File([invalidJson], 'bad-map.json', { type: 'application/json' });
    Object.defineProperty(mapFileInput, 'files', { value: [file], configurable: true });

    mapFileInput.dispatchEvent(new Event('change'));
    // Esperar al FileReader (se resuelve en microtask)
    await new Promise((r) => setTimeout(r, 10));

    expect(validationErrors.style.display).not.toBe('none');
    expect(validationErrors.textContent).toMatch(/layers|capas|tilesets/i);
  });

  it('muestra las zonas cuando el JSON de Tiled es válido', async () => {
    const container = makeContainer();
    mountAdminWorldPanel(container);

    const mapFileInput = container.querySelector('#wm-map-file');
    const zonesContainer = container.querySelector('#wm-zones-container');

    const validJson = JSON.stringify({
      width: 2,
      height: 2,
      tilewidth: 32,
      tileheight: 32,
      layers: [
        { type: 'tilelayer', name: 'suelo', data: [1, 1, 1, 1] },
        { type: 'tilelayer', name: 'collision', data: [0, 0, 0, 0] },
        {
          type: 'objectgroup',
          name: 'zones',
          objects: [
            {
              properties: [
                { name: 'name', value: 'Sala Central' },
                { name: 'channelId', value: 'ch-central' },
              ],
            },
          ],
        },
      ],
      tilesets: [{ name: 'world-tileset' }],
    });

    const file = new File([validJson], 'good-map.json', { type: 'application/json' });
    Object.defineProperty(mapFileInput, 'files', { value: [file], configurable: true });
    mapFileInput.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 10));

    expect(zonesContainer.style.display).not.toBe('none');
    // Los valores de zona se renderizan en inputs editables (no texto plano)
    const zoneNameInput = zonesContainer.querySelector('.wm-zone-name');
    const zoneChannelInput = zonesContainer.querySelector('.wm-zone-channel');
    expect(zoneNameInput).not.toBeNull();
    expect(zoneChannelInput).not.toBeNull();
    expect(zoneNameInput.value).toBe('Sala Central');
    expect(zoneChannelInput.value).toBe('ch-central');
    // Debe haber inputs de edición inline para la zona
    expect(zonesContainer.querySelectorAll('.wm-zone-name')).toHaveLength(1);
    expect(zonesContainer.querySelectorAll('.wm-zone-channel')).toHaveLength(1);
  });

  it('la edición inline de zona escribe de vuelta en tiledJson antes de guardar', async () => {
    mockListMaps.mockResolvedValue([]);
    mockSaveMap.mockResolvedValue({ map: { name: 'test' }, zones: [] });

    const container = makeContainer();
    mountAdminWorldPanel(container);

    const mapFileInput = container.querySelector('#wm-map-file');
    const zonesContainer = container.querySelector('#wm-zones-container');
    const nameInput = container.querySelector('#wm-name');
    const tilesetFileInput = container.querySelector('#wm-tileset-file');
    const saveBtn = container.querySelector('#wm-save-btn');

    // Cargar un mapa válido con una zona
    const validJson = JSON.stringify({
      width: 2,
      height: 2,
      tilewidth: 32,
      tileheight: 32,
      layers: [
        { type: 'tilelayer', name: 'suelo', data: [1, 1, 1, 1] },
        { type: 'tilelayer', name: 'collision', data: [0, 0, 0, 0] },
        {
          type: 'objectgroup',
          name: 'zones',
          objects: [
            {
              properties: [
                { name: 'name', value: 'Sala Original' },
                { name: 'channelId', value: 'ch-original' },
              ],
            },
          ],
        },
      ],
      tilesets: [{ name: 'world-tileset' }],
    });

    const file = new File([validJson], 'good-map.json', { type: 'application/json' });
    Object.defineProperty(mapFileInput, 'files', { value: [file], configurable: true });
    mapFileInput.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 10));

    // Editar el nombre de la zona inline
    const zoneNameInput = zonesContainer.querySelector('.wm-zone-name');
    expect(zoneNameInput).not.toBeNull();
    zoneNameInput.value = 'Sala Editada';
    zoneNameInput.dispatchEvent(new Event('input'));

    // Habilitar el botón: poner nombre del mapa y tileset
    nameInput.value = 'Mi Mapa';
    nameInput.dispatchEvent(new Event('input'));

    const tilesetFile = new File(['fake'], 'tileset.png', { type: 'image/png' });
    Object.defineProperty(tilesetFileInput, 'files', { value: [tilesetFile], configurable: true });
    tilesetFileInput.dispatchEvent(new Event('change'));

    expect(saveBtn.disabled).toBe(false);

    // Guardar
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    // Verificar que saveMap recibió el tiledJson con el valor editado
    expect(mockSaveMap).toHaveBeenCalledOnce();
    const { tiledJson } = mockSaveMap.mock.calls[0][0];
    const zonesLayer = tiledJson.layers.find(
      (l) => l.type === 'objectgroup' && l.name?.toLowerCase() === 'zones',
    );
    const nameProp = zonesLayer.objects[0].properties.find((p) => p.name === 'name');
    expect(nameProp.value).toBe('Sala Editada');
  });
});
