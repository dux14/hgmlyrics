import { test, expect } from '@playwright/test';

/**
 * E2E del afinador flotante bajo demanda (T5, reemplaza el shortcut viejo
 * "Afinar · nota" de #tono-person-row, eliminado en el rediseño de chips SATB
 * del hero).
 *
 * NOTA: Playwright aún no está instalado ni configurado en este repo
 * (intencional). Este archivo es el artefacto que ejecutará un harness futuro o
 * la validación en el preview de Vercel. Asume:
 *   - BASE_URL apunta a un deploy/preview.
 *   - USER_STORAGE_STATE: storageState de un usuario CON el flag `voz_tono`
 *     asignado (sesión Supabase persistida en localStorage). El flag
 *     `afinador_shortcut` quedó huérfano tras este rediseño — el mic ya no
 *     depende de él.
 *   - SONG_V2_ID: id de una canción v2 cuyo roster tiene una voz con
 *     referenceKey derivable (referenceKey explícito o primera nota cantada).
 *
 * Escenario: abrir la canción, elegir una voz en los chips SATB del hero,
 * tocar el mic (`#hero-tuner-mic`) → aparece la barra flotante `.floating-tuner`
 * con la nota objetivo de la voz activa. Cambiar de voz actualiza la nota sin
 * cerrar la barra. Tocar la X la cierra.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const USER_STORAGE_STATE = process.env.USER_STORAGE_STATE ?? 'user-state.json';
const SONG_V2_ID = process.env.SONG_V2_ID ?? 'song-v2-tono';

test.describe('Afinador flotante — mic del hero', () => {
  test('mic → barra flotante con la nota de la voz activa → cambia de voz → cierra', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_V2_ID}`);

    // Elegir una voz en los chips SATB del hero (única fuente de verdad de
    // voz activa, T2 — reemplaza el disclosure categoría→persona de Tono).
    await page.locator('#hero-voice-chips [data-category]').first().click();

    // Tocar el mic abre la barra flotante con la nota objetivo visible.
    await page.locator('#hero-tuner-mic').click();
    const floatingTuner = page.locator('.floating-tuner');
    await expect(floatingTuner).toBeVisible();
    await expect(floatingTuner.locator('#floating-tuner-note')).not.toHaveText('—');

    // Cambiar de voz actualiza la nota sin cerrar la barra.
    const firstNote = await floatingTuner.locator('#floating-tuner-note').textContent();
    await page.locator('#hero-voice-chips [data-category]').nth(1).click();
    await expect(floatingTuner).toBeVisible();
    await expect(floatingTuner.locator('#floating-tuner-note')).not.toHaveText(firstNote ?? '');

    // La X cierra la barra.
    await floatingTuner.locator('[aria-label="Cerrar afinador"]').click();
    await expect(page.locator('.floating-tuner')).toHaveCount(0);

    await context.close();
  });
});
