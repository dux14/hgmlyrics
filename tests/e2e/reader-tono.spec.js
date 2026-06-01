import { test, expect } from '@playwright/test';

/**
 * E2E del modo "Tono" del lector (notas por sílaba + disclosure categoría→persona).
 *
 * NOTA: Playwright aún no está instalado ni configurado en este repo
 * (intencional). Este archivo es el artefacto que ejecutará un harness futuro o
 * la validación en el preview de Vercel. Asume:
 *   - BASE_URL apunta a un deploy/preview.
 *   - USER_STORAGE_STATE: storageState de un usuario CON el flag `voz_tono`
 *     asignado (sesión Supabase persistida en localStorage).
 *   - NOFLAG_STORAGE_STATE: storageState de un usuario SIN el flag `voz_tono`.
 *   - SONG_V2_ID: id de una canción v2 con al menos 2 sopranos y notas por
 *     sílaba (p.ej. Soprano A y Soprano B con notas distintas).
 *
 * Escenario:
 *   1. Con flag activo: abrir la canción, activar el modo Tono, elegir
 *      Soprano → Soprano B. La letra muestra solo lo que canta Soprano B con
 *      sus notas alineadas; el resto atenuado.
 *   2. Cambiar a Soprano A: cambian highlight y notas.
 *   3. En modo Acordes no aparecen notas por sílaba.
 *   4. Sin flag: el toggle solo muestra Letra/Acordes y nunca aparece Tono.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const USER_STORAGE_STATE = process.env.USER_STORAGE_STATE ?? 'user-state.json';
const NOFLAG_STORAGE_STATE = process.env.NOFLAG_STORAGE_STATE ?? 'noflag-state.json';
const SONG_V2_ID = process.env.SONG_V2_ID ?? 'song-v2-tono';

test.describe('Lector — modo Tono (con flag voz_tono)', () => {
  test('activa Tono, elige Soprano B y A, y verifica notas/atenuado', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_V2_ID}`);

    // El tercer botón del toggle debe existir gracias al flag.
    const tonoBtn = page.locator('.chord-toggle__btn[data-mode="tono"]');
    await expect(tonoBtn).toBeVisible();

    // 1. Activar modo Tono → aparece la fila de filtros (categoría → persona).
    await tonoBtn.click();
    const tonoFilters = page.locator('#tono-filters');
    await expect(tonoFilters).toBeVisible();

    // Elegir categoría Soprano.
    await page.locator('.tono-chip--category[data-category="soprano"]').click();
    const personRow = page.locator('#tono-person-row');
    await expect(personRow.locator('.tono-chip--person')).toHaveCount(2);

    // Elegir Soprano B (segunda persona de la categoría).
    const personChips = personRow.locator('.tono-chip--person');
    await personChips.nth(1).click();

    // El encabezado aria-live anuncia la voz activa (color-not-only).
    await expect(page.locator('#tono-active-voice')).toContainText('Voz activa:');

    // Las líneas en modo Tono usan el contenedor ruby; hay notas y dimmed.
    const tonoLines = page.locator('.lyrics__line--tono');
    await expect(tonoLines.first()).toBeVisible();
    await expect(page.locator('.syll__note').first()).toBeVisible();
    await expect(page.locator('.syll--dimmed').first()).toBeVisible();

    // Capturar el texto de las notas visibles de Soprano B.
    const notesB = await page.locator('.syll:not(.syll--dimmed) .syll__note').allTextContents();

    // 2. Cambiar a Soprano A → cambia highlight y notas.
    await personChips.nth(0).click();
    await expect(page.locator('#tono-active-voice')).toContainText('Voz activa:');
    const notesA = await page.locator('.syll:not(.syll--dimmed) .syll__note').allTextContents();
    expect(notesA.join('|')).not.toEqual(notesB.join('|'));

    // 3. En modo Acordes no aparecen notas por sílaba.
    const chordsBtn = page.locator('.chord-toggle__btn[data-mode="chords"]');
    if (await chordsBtn.count()) {
      await chordsBtn.click();
      await expect(page.locator('.lyrics__line--tono')).toHaveCount(0);
      await expect(page.locator('.syll__note')).toHaveCount(0);
    }

    await context.close();
  });
});

test.describe('Lector — regresión sin flag voz_tono', () => {
  test('el toggle solo muestra Letra/Acordes (sin Tono)', async ({ browser }) => {
    const context = await browser.newContext({ storageState: NOFLAG_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_V2_ID}`);

    // Nunca debe existir el botón Tono ni la fila de filtros de notas.
    await expect(page.locator('.chord-toggle__btn[data-mode="tono"]')).toHaveCount(0);
    await expect(page.locator('#tono-filters')).toHaveCount(0);

    // Si la canción tiene acordes, el toggle muestra Letra + Acordes y nada más.
    const toggle = page.locator('#chord-toggle');
    if (await toggle.count()) {
      await expect(toggle.locator('.chord-toggle__btn[data-mode="lyrics"]')).toBeVisible();
      await expect(toggle.locator('.chord-toggle__btn[data-mode="tono"]')).toHaveCount(0);
    }

    await context.close();
  });
});
