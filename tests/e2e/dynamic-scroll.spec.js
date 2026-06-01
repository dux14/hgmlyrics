import { test, expect } from '@playwright/test';

/**
 * E2E del scroll dinámico (Fase 1): el autoscroll reacciona a
 * `section.speedPreset`, recuerda la velocidad por canción y deja que el
 * ajuste manual (−/+) gane sobre el preset.
 *
 * NOTA: Playwright aún no está instalado ni configurado en este repo
 * (intencional). Este archivo es el artefacto que ejecutará un harness futuro o
 * la validación en el preview de Vercel. Asume:
 *   - BASE_URL apunta a un deploy/preview.
 *   - USER_STORAGE_STATE: storageState de un usuario autenticado (sesión
 *     Supabase persistida en localStorage; login wall activo).
 *   - SONG_PRESETS_ID: id de una canción cuyas secciones tienen `speedPreset`
 *     distinto entre sí (al menos dos valores: uno bajo arriba, uno alto abajo).
 *   - SONG_OTHER_ID: id de una segunda canción cualquiera (para verificar que la
 *     persistencia es por canción y no global).
 *
 * Escenario:
 *   1. Presets por sección: abrir la canción, activar autoscroll, dejar que
 *      avance y verificar que el label de velocidad (#autoscroll-speed-label)
 *      cambia al cruzar una sección con otro preset (la velocidad converge).
 *   2. Manual gana sobre preset: tocar −/+ ajusta en vivo el label y persiste
 *      la velocidad en `localStorage` bajo la clave por canción.
 *   3. Persistencia por canción: recargar la misma canción restaura SU
 *      velocidad; abrir otra canción NO hereda esa velocidad (clave distinta).
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const USER_STORAGE_STATE = process.env.USER_STORAGE_STATE ?? 'user-state.json';
const SONG_PRESETS_ID = process.env.SONG_PRESETS_ID ?? 'song-presets';
const SONG_OTHER_ID = process.env.SONG_OTHER_ID ?? 'song-other';

const SPEED_KEY = 'hkn-autoscroll-speed';

test.describe('Scroll dinámico — presets por sección', () => {
  test('la velocidad converge al cruzar secciones con preset distinto', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_PRESETS_ID}`);

    // Hay secciones anotadas con data-speed-preset.
    await expect(page.locator('.lyrics__section[data-speed-preset]').first()).toBeAttached();

    // Activar autoscroll.
    await page.locator('#autoscroll-toggle').click();

    const label = page.locator('#autoscroll-speed-label');
    const initial = (await label.textContent())?.trim();

    // Tras dejar avanzar el scroll y cruzar una sección con otro preset, el
    // label de velocidad debe cambiar (la interpolación mueve scrollSpeed hacia
    // el targetSpeed de la nueva sección).
    await expect
      .poll(async () => (await label.textContent())?.trim(), { timeout: 8000 })
      .not.toBe(initial);

    await context.close();
  });
});

test.describe('Scroll dinámico — manual gana sobre preset + persistencia por canción', () => {
  test('−/+ ajusta en vivo y persiste bajo la clave por canción', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_PRESETS_ID}`);
    await page.locator('#autoscroll-toggle').click();

    const label = page.locator('#autoscroll-speed-label');
    const before = (await label.textContent())?.trim();

    // Subir velocidad manualmente.
    await page.locator('#autoscroll-faster').click();
    await page.locator('#autoscroll-faster').click();

    const after = (await label.textContent())?.trim();
    expect(after).not.toBe(before);

    // La velocidad se persiste bajo la clave por canción, no la global.
    const perSong = await page.evaluate(
      ([key, id]) => localStorage.getItem(`${key}:${id}`),
      [SPEED_KEY, SONG_PRESETS_ID],
    );
    expect(perSong).toBeTruthy();

    // Recargar la misma canción restaura SU velocidad.
    await page.reload();
    await expect(page.locator('#autoscroll-speed-label')).toHaveText(after ?? '');

    // Otra canción NO hereda esa velocidad (clave por canción distinta).
    await page.goto(`${BASE_URL}/#/song/${SONG_OTHER_ID}`);
    const otherPerSong = await page.evaluate(
      ([key, id]) => localStorage.getItem(`${key}:${id}`),
      [SPEED_KEY, SONG_OTHER_ID],
    );
    expect(otherPerSong).not.toBe(perSong);

    await context.close();
  });
});
