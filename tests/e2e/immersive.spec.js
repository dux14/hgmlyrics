import { test, expect } from '@playwright/test';

/**
 * E2E de la vista inmersiva (Task D4, karaoke estilo Apple Music).
 *
 * NOTA: @playwright/test está instalado y playwright.config.js (raíz) apunta a
 * e2e/ (offline). Esta suite vive en tests/e2e/ y corre con un config propio
 * apuntando aquí (validada 10-jul contra el preview: 6/6 verdes). Asume:
 *   - BASE_URL apunta a un deploy/preview.
 *   - USER_STORAGE_STATE: storageState de un usuario autenticado (sesión
 *     Supabase persistida en localStorage; login wall activo).
 *   - SONG_ID: id de "Santo" (f969b156-ed95-4e2b-ab66-8381ff4939df por
 *     defecto), con audio + timings `ready` en la DB del preview.
 *
 * Alcance:
 *   1. Entrar a la vista desde SongView (#enter-stage-btn) → el overlay
 *      `.imm-v1` monta.
 *   2. Sheet de opciones: cambiar entre los modos que la canción permita
 *      (letra siempre; +Acordes solo si la canción tiene acordes; +Tono /
 *      +Ac.+Tono solo con roster de voces — Santo puede no tener todos, el
 *      test filtra por los botones realmente presentes) y elegir una voz
 *      cuando el sheet expone el grupo VOZ.
 *   3. Afinador: abrir/cerrar el panel flotante SIN esperar permiso real de
 *      mic (el estado idle del widget ya es visible sin getUserMedia
 *      concedido — mismo criterio que tuner-shortcut.spec.js, que tampoco
 *      otorga permisos).
 *   4. Salir con el botón X y con Escape.
 *   5. Player (describe aparte, condicionado a datos listos): la barra
 *      `#imm-player` está visible, reproducir mueve el audio, tocar una
 *      línea hace seek y el scrubber avanza.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const USER_STORAGE_STATE = process.env.USER_STORAGE_STATE ?? 'user-state.json';
const SONG_ID = process.env.SONG_ID ?? 'f969b156-ed95-4e2b-ab66-8381ff4939df';
// Si el runner no tiene el flag/datos del player listos, se salta ese
// describe en vez de fallar (reportado como skipped por Playwright).
const HAS_PLAYER_FIXTURE = process.env.IMMERSIVE_PLAYER_READY === '1';

test.describe('Vista inmersiva — entrada, modos y voz', () => {
  test('monta desde SongView y expone el rollo de líneas', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_ID}`);
    await page.locator('#enter-stage-btn').click();

    await expect(page.locator('.imm-v1')).toBeVisible();
    await expect(page.locator('#imm-roll')).toBeVisible();
    await expect(page.locator('.imm-line[data-i]').first()).toBeAttached();
    await expect(page.locator('#imm-fab')).toBeVisible();

    await context.close();
  });

  test('cambia entre los modos disponibles en el sheet de opciones', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_ID}`);
    await page.locator('#enter-stage-btn').click();
    await expect(page.locator('.imm-v1')).toBeVisible();

    await page.locator('#imm-open-options').click();
    const modeGroup = page.locator('.osheet__seg--mode');
    await expect(modeGroup).toBeVisible();

    // Solo los modos que la canción/flag realmente habilitan aparecen como
    // botones — Santo puede no tener acordes ni roster de voces.
    const modeButtons = modeGroup.locator('[data-mode]');
    const count = await modeButtons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const btn = modeButtons.nth(i);
      const mode = await btn.getAttribute('data-mode');
      await btn.click();
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
      // El rollo se re-renderiza completo al cambiar de modo (applyMode).
      await expect(page.locator('.imm-line[data-i]').first()).toBeAttached();

      // Si el modo activa el grupo VOZ (mixed/tono), elegir la primera voz
      // disponible y verificar que los chips compactos del header aparecen.
      const voiceGroup = page.locator('.osheet__seg--voice');
      if ((mode === 'mixed' || mode === 'tono') && (await voiceGroup.isVisible())) {
        const voiceBtn = voiceGroup.locator('[data-voice]').first();
        await voiceBtn.click();
        await expect(voiceBtn).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#imm-voice-chips')).toBeVisible();
      }
    }

    await context.close();
  });

  test('afinador: abre y cierra el panel flotante sin permiso real de mic', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_ID}`);
    await page.locator('#enter-stage-btn').click();
    await expect(page.locator('.imm-v1')).toBeVisible();

    // Abrir: el toggle queda pressed y el panel deja de estar hidden. No se
    // otorgan permisos de mic — el estado idle del widget (botón "Activar
    // micrófono") ya es visible sin getUserMedia concedido.
    await page.locator('#imm-tuner-toggle').click();
    await expect(page.locator('#imm-tuner-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#imm-tuner-panel')).toBeVisible();

    // Cerrar con el mismo toggle.
    await page.locator('#imm-tuner-toggle').click();
    await expect(page.locator('#imm-tuner-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#imm-tuner-panel')).toBeHidden();

    await context.close();
  });

  test('sale con el boton X', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_ID}`);
    await page.locator('#enter-stage-btn').click();
    await expect(page.locator('.imm-v1')).toBeVisible();

    await page.locator('#imm-exit').click();
    await expect(page.locator('.imm-v1')).toHaveCount(0);

    await context.close();
  });

  test('sale con Escape', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_ID}`);
    await page.locator('#enter-stage-btn').click();
    await expect(page.locator('.imm-v1')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.imm-v1')).toHaveCount(0);

    await context.close();
  });
});

test.describe('Vista inmersiva — player sincronizado', () => {
  test.skip(
    !HAS_PLAYER_FIXTURE,
    'requiere IMMERSIVE_PLAYER_READY=1: audio/timings ready para SONG_ID',
  );

  test('barra de player visible, play mueve el audio, tap en linea hace seek', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_ID}`);
    await page.locator('#enter-stage-btn').click();
    await expect(page.locator('.imm-v1')).toBeVisible();

    const player = page.locator('#imm-player');
    await expect(player).toBeVisible();

    const scrubber = page.locator('#imm-player-scrubber');
    const before = await scrubber.inputValue();

    await page.locator('#imm-player-play').click();
    await expect(page.locator('#imm-player-play')).toHaveAttribute('aria-label', 'Pausar pista');

    // El scrubber avanza tras reproducir (timeupdate del <audio>).
    await expect
      .poll(async () => scrubber.inputValue(), { timeout: 8000 })
      .not.toBe(before);

    // Tap en una línea distinta a la activa hace seek (seekSyncToLine).
    const targetLine = page.locator('.imm-line[data-i]').nth(4);
    await targetLine.click();
    const afterSeekValue = await scrubber.inputValue();
    await expect
      .poll(async () => scrubber.inputValue(), { timeout: 8000 })
      .not.toBe(afterSeekValue);

    await context.close();
  });
});
