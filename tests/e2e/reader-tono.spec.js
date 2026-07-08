import { test, expect } from '@playwright/test';

/**
 * E2E del modo "Tono" del lector (notas por sílaba), fuera de preview.
 *
 * NOTA: Playwright aún no está instalado ni configurado en este repo
 * (intencional). Este archivo es el artefacto que ejecutará un harness futuro o
 * la validación en el preview de Vercel. Post-T2/T3: el disclosure viejo
 * categoría→persona (`#tono-filters`/`#tono-person-row`/`#tono-active-voice`)
 * fue reemplazado por los chips SATB del hero (única fuente de verdad de voz
 * activa) + la capa "Tono" independiente de la toolbar (`#layer-tono`, T3).
 * Asume:
 *   - BASE_URL apunta a un deploy/preview.
 *   - USER_STORAGE_STATE: storageState de un usuario CON el flag `voz_tono`
 *     asignado (sesión Supabase persistida en localStorage).
 *   - NOFLAG_STORAGE_STATE: storageState de un usuario SIN el flag `voz_tono`.
 *   - SONG_V2_ID: id de una canción v2 con al menos 2 sopranos y notas por
 *     sílaba (p.ej. Soprano A y Soprano B con notas distintas).
 *
 * Escenario:
 *   1. Con flag activo: abrir la canción, elegir el chip Soprano del hero
 *      (activa la capa Tono automáticamente, T2) → luego, si el roster tiene
 *      2+ sopranos, no hay autoselección de persona (el hero solo elige
 *      categoría) — la letra muestra las notas de la primera voz de la
 *      categoría.
 *   2. Cambiar a otro chip (p.ej. Contralto) cambia highlight y notas.
 *   3. Apagar la capa Tono (#layer-tono) oculta las notas por sílaba.
 *   4. Sin flag: no aparecen los chips SATB del hero.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const USER_STORAGE_STATE = process.env.USER_STORAGE_STATE ?? 'user-state.json';
const NOFLAG_STORAGE_STATE = process.env.NOFLAG_STORAGE_STATE ?? 'noflag-state.json';
const SONG_V2_ID = process.env.SONG_V2_ID ?? 'song-v2-tono';

test.describe('Lector — modo Tono (con flag voz_tono)', () => {
  test('elige voz en los chips del hero y verifica notas/atenuado', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_V2_ID}`);

    // Los chips SATB del hero existen gracias al flag.
    const heroChips = page.locator('#hero-voice-chips [data-category]');
    await expect(heroChips.first()).toBeVisible();

    // 1. Elegir el chip Soprano → activa la capa Tono (T2) y selecciona la
    // categoría como voz activa.
    await page.locator('#hero-voice-chips [data-category="soprano"]').click();
    await expect(page.locator('#layer-tono')).toHaveAttribute('aria-pressed', 'true');

    const tonoLines = page.locator('.lyrics__line--tono');
    await expect(tonoLines.first()).toBeVisible();
    await expect(page.locator('.syll__note').first()).toBeVisible();
    await expect(page.locator('.syll--dimmed').first()).toBeVisible();

    const notesSoprano = await page
      .locator('.syll:not(.syll--dimmed) .syll__note')
      .allTextContents();

    // 2. Cambiar a Contralto → cambia highlight y notas.
    await page.locator('#hero-voice-chips [data-category="contralto"]').click();
    const notesContralto = await page
      .locator('.syll:not(.syll--dimmed) .syll__note')
      .allTextContents();
    expect(notesContralto.join('|')).not.toEqual(notesSoprano.join('|'));

    // 3. Apagar la capa Tono oculta las notas por sílaba.
    await page.locator('#layer-tono').click();
    await expect(page.locator('#layer-tono')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.lyrics__line--tono')).toHaveCount(0);
    await expect(page.locator('.syll__note')).toHaveCount(0);

    await context.close();
  });
});

test.describe('Lector — regresión sin flag voz_tono', () => {
  test('no aparecen los chips SATB del hero', async ({ browser }) => {
    const context = await browser.newContext({ storageState: NOFLAG_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_V2_ID}`);

    await expect(page.locator('#hero-voice-chips')).toHaveCount(0);
    await expect(page.locator('#layer-tono')).toHaveCount(0);

    await context.close();
  });
});
