import { test, expect } from '@playwright/test';

/**
 * Task 1.3: blindaje del full view contra controles del normal view (Fix 2).
 * Mismo patrón de storageState/BASE_URL que e2e/fullview-options.spec.js.
 *
 * SONG_ACCORDION: "Madre de Hakuna" — única canción con audio de sección
 * (song_section_audio) real en la DB de este entorno al momento de escribir
 * este test (verificado con `supabase db query --linked`: Santo, la fixture
 * SONG_SYNC de fullview-options.spec.js, no tiene filas en song_section_audio
 * y por lo tanto nunca monta el acordeón `.section-audio`). Si en el futuro
 * la fixture deja de tener audio de sección, el test de "acordeón presente"
 * debe fallar en vez de degradarse en silencio — es justo el escenario que
 * blinda esta suite.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN_STORAGE_STATE = process.env.ADMIN_STORAGE_STATE ?? '.playwright-mcp/admin-state.json';
const SONG_ACCORDION = process.env.SONG_ACCORDION ?? '7b0858ed-4f8b-4042-b412-8c66161ba44e'; // Madre de Hakuna

test.describe('full view: sin leak de controles del normal view (Task 1.3)', () => {
  test('acordeón de sección abierto + entrar al full view: colapsa, se pausa y el hit-test no lo toca', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_ACCORDION}`);

    // Precondición dura: la fixture debe tener al menos un panel de audio de
    // sección montado, si no el test no está probando lo que dice probar.
    // Timeout 30s como el caso in-stage de abajo: el shell `.song-view` no
    // monta hasta que resuelve el catálogo completo (`/api/songs`), que en
    // `vercel dev` local tarda ~18s; el botón de sección aparece recién a ~22s
    // (ya sirve el audio de sección con 200). En preview/prod el catálogo va
    // por CDN y esto es instantáneo — el margen sobra sin volver el test lento.
    const playBtn = page.locator('.lyrics__section-play').first();
    await playBtn.waitFor({ state: 'visible', timeout: 30000 });
    await playBtn.click();

    const panel = page.locator('.section-audio').first();
    await expect(panel).toBeVisible();

    // Arranca el audio de la sección antes de entrar al full view, para
    // probar también que queda PAUSADO (no solo oculto) al entrar.
    await panel.locator('.section-audio__play').click();
    const sectionAudioEl = page.locator('audio').first();
    await expect
      .poll(async () => sectionAudioEl.evaluate((el) => el.paused))
      .toBe(false);

    await page.locator('#enter-stage-btn').click();
    await expect(page.locator('.imm-v1')).toBeVisible();

    // El audio de sección quedó pausado por el hook de entrada (Task 1.3).
    await expect
      .poll(async () => sectionAudioEl.evaluate((el) => el.paused))
      .toBe(true);

    // El acordeón quedó colapsado (CSS defensa-en-profundidad + JS): ningún
    // `.section-audio` visible (ni hidden=false ni display!=none).
    const visibleSectionAudioCount = await page
      .locator('.section-audio')
      .evaluateAll((els) =>
        els.filter((el) => !el.hidden && getComputedStyle(el).display !== 'none').length,
      );
    expect(visibleSectionAudioCount).toBe(0);

    // Hit-testing: en la franja inferior del viewport, el elemento superior
    // en cada punto muestreado pertenece al overlay inmersivo (.imm-v1), no a
    // un control flotante del normal view que hubiera quedado pintado encima.
    const viewport = page.viewportSize();
    const y = viewport.height - 20;
    for (const xFrac of [0.1, 0.5, 0.9]) {
      const x = Math.round(viewport.width * xFrac);
      const belongsToImmersive = await page.evaluate(
        ([px, py]) => {
          const top = document.elementFromPoint(px, py);
          return !!top && !!top.closest('.imm-v1');
        },
        [x, y],
      );
      expect(belongsToImmersive).toBe(true);
    }

    await context.close();
  });

  test('afinador in-stage: el toggle del escenario sigue visible dentro de .imm-v1 (no lo tapa el blindaje CSS)', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_ACCORDION}`);
    await page.locator('#enter-stage-btn').waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#enter-stage-btn').click();
    await expect(page.locator('.imm-v1')).toBeVisible();

    // Abre el afinador híbrido DEL ESCENARIO (no el flotante del normal
    // view) vía su propio toggle in-stage.
    await page.locator('#imm-tuner-toggle').click();
    const inStageTuner = page.locator('.imm-v1 .floating-tuner');
    await expect(inStageTuner).toBeVisible();

    // El blindaje CSS (body.immersive-active > .floating-tuner) es un
    // selector de hijo DIRECTO de <body> — la instancia in-stage cuelga
    // adentro de .imm-v1__tuner-panel/.imm-v1, nunca hijo directo de body,
    // así que la regla no debe alcanzarla.
    const display = await inStageTuner.evaluate((el) => getComputedStyle(el).display);
    expect(display).not.toBe('none');

    await context.close();
  });
});
