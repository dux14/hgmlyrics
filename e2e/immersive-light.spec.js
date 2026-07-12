import { test, expect } from '@playwright/test';

/**
 * E2E del overlay inmersivo con el tema forzado a claro (Task 4.3, D9). El
 * full view (`.imm-v1`) es SIEMPRE oscuro por decisión de producto (como
 * Apple Music, que no invierte a claro) — este test verifica que ningún
 * token del tema (`--color-*`) se filtra al overlay cuando `data-theme` está
 * en `light`: la línea activa se sigue leyendo en blanco sobre fondo negro,
 * y el acorde de la línea activa en modo mixed no hereda el verde oscuro del
 * token light.
 *
 * Mismo patrón que e2e/fullview-options.spec.js (storageState admin, canción
 * SONG_SYNC "Santo").
 *
 * Variables de entorno:
 *   BASE_URL: default http://localhost:3000 (dev:vercel). Para el preview:
 *     BASE_URL=https://hgmlyrics-pitch-preview.vercel.app
 *   ADMIN_STORAGE_STATE: default .playwright-mcp/admin-state.json.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN_STORAGE_STATE = process.env.ADMIN_STORAGE_STATE ?? '.playwright-mcp/admin-state.json';
const SONG_SYNC = process.env.SONG_SYNC ?? 'f969b156-ed95-4e2b-ab66-8381ff4939df'; // Santo

test.describe('overlay inmersivo en tema claro (D9)', () => {
  test('permanece oscuro y legible aunque data-theme=light', async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    // Forzar tema claro ANTES de que la app cargue: misma clave que usa
    // ThemeToggle.js (THEME_KEY = 'hkn-theme').
    await page.addInitScript(() => {
      localStorage.setItem('hkn-theme', 'light');
      document.documentElement.setAttribute('data-theme', 'light');
    });

    await page.goto(`${BASE_URL}/#/song/${SONG_SYNC}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Entrar al full view.
    await page.locator('#enter-stage-btn').waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#enter-stage-btn').click();
    await expect(page.locator('.imm-v1')).toBeVisible();

    // El data-theme sigue siendo light: la app NO se oscurece globalmente,
    // solo el overlay debe autoprotegerse.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // El overlay debe pintar #121212 pase lo que pase con el tema.
    const overlayBg = await page
      .locator('.imm-v1')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(overlayBg).toBe('rgb(18, 18, 18)');

    // La línea activa debe leerse en blanco, no en el --color-text oscuro
    // (#1a1a1a) que data-theme=light le daría sin el re-pin.
    const activeColor = await page
      .locator('.imm-line--active')
      .evaluate((el) => getComputedStyle(el).color);
    expect(activeColor).toBe('rgb(255, 255, 255)');

    await page.screenshot({ path: 'e2e/screenshots/immersive-light-letra.png' });

    // Cambiar a modo mixed y verificar que el acorde de la línea activa NO
    // tomó el verde oscuro del token light (--color-chord-l, ~#2e7d32).
    const chrome = page.locator('#imm-chrome');
    const hidden = await chrome.evaluate((el) => el.classList.contains('imm-v1__chrome--hidden'));
    if (hidden) {
      await page.locator('#imm-viewport').click({ position: { x: 2, y: 2 } });
    }
    await page.locator('#imm-open-options').click();
    await expect(page.locator('.osheet')).toBeVisible();

    const mixedBtn = page.locator('.osheet [data-mode="mixed"]');
    if ((await mixedBtn.count()) > 0) {
      await mixedBtn.click();

      // El riel de acordes por línea (`.mix-rail--chord i`, components.css
      // buildMixedLineHTML) solo se renderiza con una voz activa — sin esto
      // el mode 'mixed' cae a solo-acordes (`.float-label.chord-label`, sin
      // riel) y la aserción de abajo sería un no-op. Santo tiene tenor
      // (confirmado en fullview-options.spec.js, test "elegir una voz
      // actualiza los chips del header"): elegimos ese chip para fijar
      // `activeVoiceId` antes de cerrar el sheet.
      const voiceBtn = page.locator('.osheet [data-voice="tenor"]');
      await expect(voiceBtn).toBeVisible();
      await voiceBtn.click();

      await page.locator('.osheet-dim').click({ position: { x: 2, y: 2 } });
      await expect(page.locator('.osheet')).toHaveCount(0);

      // La línea activa al entrar (data-i="0") es el spoken/pre-roll de
      // intro ("Por eso con los ángeles...") — buildLine() la resuelve
      // SIEMPRE por letra plana (línea.spoken), sin acordes, sin importar el
      // modo. El riel `.mix-rail--chord i` solo existe en la línea ACTIVA
      // con voz elegida (ver buildLine, ImmersiveView.js): navegamos con tap
      // (mismo patrón real de usuario, seekSyncToLine/goTo vía [data-i]) a
      // data-i="1" ("Santo"), que sí trae acorde (G).
      await page.locator('[data-i="1"]').click();
      await expect(page.locator('.imm-line--active')).toHaveAttribute('data-i', '1');

      // Sin guard suave: si el riel no existe (regresión de markup o la
      // línea activa quedó sin acorde), el test debe FALLAR, no saltarse la
      // aserción de color en silencio.
      const activeChord = page.locator('.imm-line--active .mix-rail--chord i').first();
      await expect(activeChord).toBeAttached();
      expect(await activeChord.count()).toBeGreaterThan(0);

      const chordColor = await activeChord.evaluate((el) => getComputedStyle(el).color);
      // El verde oscuro del token light (--color-chord-l) es
      // rgb(46, 125, 50); el token dark re-pinneado es rgb(165, 214, 167).
      expect(chordColor).not.toBe('rgb(46, 125, 50)');
      expect(chordColor).toBe('rgb(165, 214, 167)');

      await page.screenshot({ path: 'e2e/screenshots/immersive-light-mixed.png' });
    }

    await context.close();
  });
});
