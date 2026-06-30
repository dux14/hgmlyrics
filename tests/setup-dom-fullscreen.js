/**
 * Stubs de las APIs de Fullscreen que jsdom no implementa.
 * Definir como getters configurables permite que vi.spyOn(..., 'get')
 * los pise correctamente en cada test.
 *
 * Guard: los setupFiles corren para TODOS los archivos, incluidos los que
 * declaran `// @vitest-environment node` (sin DOM). Sin este guard, tocar
 * `document` ahi lanza ReferenceError y tumba esas suites (p.ej. acordes/).
 */
if (typeof document !== 'undefined') {
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
}
