/**
 * Stubs de las APIs de Fullscreen que jsdom no implementa.
 * Definir como getters configurables permite que vi.spyOn(..., 'get')
 * los pise correctamente en cada test.
 */
Object.defineProperties(document, {
  fullscreenElement: {
    get: () => null,
    configurable: true,
  },
  exitFullscreen: {
    // Retorna undefined por defecto; los tests lo sustituyen con vi.fn()
    get: () => undefined,
    configurable: true,
  },
});
