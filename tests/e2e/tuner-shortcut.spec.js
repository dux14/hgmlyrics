import { test, expect } from '@playwright/test';

/**
 * E2E del shortcut al afinador desde la voz activa del modo "Tono".
 *
 * NOTA: Playwright aún no está instalado ni configurado en este repo
 * (intencional). Este archivo es el artefacto que ejecutará un harness futuro o
 * la validación en el preview de Vercel. Asume:
 *   - BASE_URL apunta a un deploy/preview.
 *   - USER_STORAGE_STATE: storageState de un usuario CON los flags `voz_tono` y
 *     `afinador_shortcut` asignados (sesión Supabase persistida en localStorage).
 *   - NOFLAG_STORAGE_STATE: storageState de un usuario CON `voz_tono` pero SIN
 *     `afinador_shortcut`.
 *   - SONG_V2_ID: id de una canción v2 cuyo roster tiene una voz con
 *     referenceKey derivable (referenceKey explícito o primera nota cantada).
 *
 * Escenario:
 *   1. Con ambos flags: abrir la canción, activar Tono, elegir una voz. Aparece
 *      el botón "Afinar · {nota}". Click → URL `#/afinador?ref=...&from=...`, el
 *      afinador arranca en modo Voz con el objetivo. Click "Volver a la canción"
 *      → regresa a la canción.
 *   2. Sin el flag `afinador_shortcut`: el botón Afinar nunca aparece.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const USER_STORAGE_STATE = process.env.USER_STORAGE_STATE ?? 'user-state.json';
const NOFLAG_STORAGE_STATE = process.env.NOFLAG_STORAGE_STATE ?? 'noflag-state.json';
const SONG_V2_ID = process.env.SONG_V2_ID ?? 'song-v2-tono';

test.describe('Afinador — shortcut desde la voz activa (con flags)', () => {
  test('Afinar · nota → afinador en modo voz con objetivo → Volver', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_V2_ID}`);

    // Activar modo Tono y elegir una voz (categoría → persona).
    await page.locator('.chord-toggle__btn[data-mode="tono"]').click();
    await page.locator('.tono-chip--category').first().click();
    await page.locator('#tono-person-row .tono-chip--person').first().click();

    // Aparece el botón "Afinar · {nota}" con la nota de referencia derivada.
    const tuneBtn = page.locator('#tune-voice');
    await expect(tuneBtn).toBeVisible();
    await expect(tuneBtn).toContainText('Afinar ·');

    // La nota objetivo se lee del data-ref del botón.
    const refNote = await tuneBtn.getAttribute('data-ref');
    expect(refNote).toBeTruthy();

    // Click → navega al afinador con ref + from en el query.
    await tuneBtn.click();
    await expect(page).toHaveURL(new RegExp(`#/afinador\\?ref=.+&from=${SONG_V2_ID}`));

    // El afinador arranca en modo Voz (tab seleccionado) y muestra el objetivo.
    await expect(page.locator('.tuner-tabs__btn[data-mode="voice"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#tuner-objective')).toContainText('Objetivo:');

    // El botón "Volver a la canción" existe y regresa a la canción de origen.
    const backBtn = page.locator('#tuner-back');
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await expect(page).toHaveURL(new RegExp(`#/song/${SONG_V2_ID}`));

    await context.close();
  });
});

test.describe('Afinador — regresión sin flag afinador_shortcut', () => {
  test('no aparece el botón Afinar en la voz activa', async ({ browser }) => {
    const context = await browser.newContext({ storageState: NOFLAG_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_V2_ID}`);

    // El modo Tono sigue disponible (flag voz_tono), pero sin el botón Afinar.
    await page.locator('.chord-toggle__btn[data-mode="tono"]').click();
    await page.locator('.tono-chip--category').first().click();
    await page.locator('#tono-person-row .tono-chip--person').first().click();

    await expect(page.locator('#tune-voice')).toHaveCount(0);

    await context.close();
  });
});
