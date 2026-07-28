/**
 * chromeRoutes.js — tabla de chrome por ruta (header + bottom-nav auto-hide,
 * headerless permanente).
 *
 * Extraída de main.js (patrón `scrollChrome.js`: lógica pura testeable sin
 * DOM/bootstrap). Motor único de auto-hide por ruta: Grupo C = header + nav;
 * Grupo B = solo nav, headerless (hero a sangre completa, sin header ni su
 * reserva de espacio). `headerless: true` unifica lo que antes era la tabla
 * HEADERLESS aparte — es exactamente el subconjunto nav-only de esta tabla.
 *
 * `nav: false` (booleano explícito, distinto de `undefined`) marca las
 * vistas de tarea del pipeline (Task 2): ocultan también el bottom-nav y la
 * sidebar de forma permanente, no solo el header. Rutas no listadas aquí no
 * se ven afectadas por `isNavHidden` (undefined !== false).
 */
export const CHROME_AUTOHIDE = [
  { re: /^\/$/, header: true, nav: true },
  { re: /^\/favoritos$/, header: true, nav: true },
  { re: /^\/listas$/, header: true, nav: true },
  { re: /^\/albumes$/, header: true, nav: true },
  { re: /^\/amigos$/, header: true, nav: true },
  { re: /^\/licencias$/, header: true, nav: true },
  { re: /^\/lista\/(?!nueva$)[^/]+$/, header: true, nav: true }, // vista, no editor
  { re: /^\/oracion$/, header: true, nav: true },
  { re: /^\/song\/[^/]+$/, header: true, nav: true }, // no incluye /song/:id/links
  // Vistas de pipeline (Task 2): chrome propio, sin header/bottom-nav/sidebar
  // globales — evita el header duplicado reportado en la auditoría.
  { re: /^\/song\/[^/]+\/(procesamiento|estudio|partitura)$/, headerless: true, nav: false },
  { re: /^\/album\/[^/]+$/, nav: true, headerless: true },
  { re: /^\/u\/[^/]+$/, header: true, nav: true },
  { re: /^\/voz\/[^/]+$/, header: true, nav: true },
  { re: /^\/voces$/, nav: true, headerless: true },
  { re: /^\/perfil$/, header: true, nav: true }, // no incluye /perfil/editar
];

export const chromeFor = (path) => CHROME_AUTOHIDE.find((c) => c.re.test(path)) ?? {};
export const isHeaderless = (path) => Boolean(chromeFor(path).headerless);
/** Oculta bottom-nav + sidebar de forma permanente (marca explícita `nav: false`). */
export const isNavHidden = (path) => chromeFor(path).nav === false;
