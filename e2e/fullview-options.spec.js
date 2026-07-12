import { test, expect } from '@playwright/test';

/**
 * E2E de la matriz completa del sheet de opciones del full view (vista
 * inmersiva karaoke, Task 23). Corre contra un servidor real (dev o preview)
 * con datos reales de la DB — no mockea nada.
 *
 * Variables de entorno (mismo patrón que tests/e2e/immersive.spec.js):
 *   BASE_URL: default http://localhost:3000 (dev:vercel). Para el preview:
 *     BASE_URL=https://hgmlyrics-pitch-preview.vercel.app
 *   ADMIN_STORAGE_STATE: default .playwright-mcp/admin-state.json — sesión
 *     Supabase de un admin con flags voz_tono + immersive_player. El token
 *     expira en ~1h: si los tests empiezan a fallar con login wall, regenerar
 *     con `node .playwright-mcp/make-state.mjs`.
 *
 * Fixtures (DB real):
 *   SONG_SYNC ("Santo"): mp3 + beats + timings ready -> promueve a modo sync
 *     (TimingEngine), expone PISTA + METRÓNOMO, oculta AUTO-SCROLL.
 *   SONG_TIMER ("A Ti te alabo"): sin audio -> se queda en TimerEngine,
 *     expone AUTO-SCROLL, nunca PISTA/METRÓNOMO/badge/pulso.
 *
 * Hallazgo empírico (verificado antes de escribir la suite, no documentado
 * en el plan): la promoción a modo sync es asíncrona (~1.5-3s, fetch de
 * /api/songs/:id/audio) y el auto-ocultado del chrome (3s de inactividad,
 * CONTROLS_HIDE_MS) corre desde el montaje inicial sin reiniciarse al
 * promover — por lo que el chrome puede quedar oculto (pointer-events: none)
 * ANTES de que un test alcance a abrir el sheet. `revealChrome()` reproduce
 * la interacción real del usuario (tap en la pantalla) para destaparlo sin
 * alterar el estado de reproducción.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN_STORAGE_STATE = process.env.ADMIN_STORAGE_STATE ?? '.playwright-mcp/admin-state.json';
const SONG_SYNC = process.env.SONG_SYNC ?? 'f969b156-ed95-4e2b-ab66-8381ff4939df'; // Santo
const SONG_TIMER = process.env.SONG_TIMER ?? '5c045ba0-9d72-4ce9-875f-610a2ef79d4f'; // A Ti te alabo

/** Entra a la vista inmersiva desde SongView y espera que el overlay monte. */
async function enterFullView(page, songId) {
  await page.goto(`${BASE_URL}/#/song/${songId}`);
  await page.locator('#enter-stage-btn').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#enter-stage-btn').click();
  await expect(page.locator('.imm-v1')).toBeVisible();
}

/**
 * Espera a que la sesión se promueva a modo sync (TimingEngine con pista real):
 * el `<audio>` se monta solo tras resolver /api/songs/:id/audio con timings
 * `ready`. Sin esto, SONG_SYNC se comporta como timer durante la ventana de
 * carga.
 */
async function waitForSync(page) {
  await page.locator('#imm-audio').waitFor({ state: 'attached', timeout: 15000 });
}

/**
 * Si el chrome está auto-oculto (pointer-events: none, ver nota de cabecera),
 * lo destapa con un tap neutro en el viewport — misma interacción que un
 * usuario real, sin togglear pausa (el handler de click solo pausa si el
 * chrome YA estaba visible).
 */
async function revealChrome(page) {
  const hidden = await page
    .locator('#imm-chrome')
    .evaluate((el) => el.classList.contains('imm-v1__chrome--hidden'));
  if (hidden) {
    await page.locator('#imm-viewport').click({ position: { x: 2, y: 2 } });
  }
}

async function openOptions(page) {
  await revealChrome(page);
  await page.locator('#imm-open-options').click();
  await expect(page.locator('.osheet')).toBeVisible();
}

/** Cierra el sheet tocando el scrim (`.osheet-dim`, el mismo listener de cierre real). */
async function closeOptions(page) {
  await page.locator('.osheet-dim').click({ position: { x: 2, y: 2 } });
  await expect(page.locator('.osheet')).toHaveCount(0);
}

/**
 * Limpia solo las claves del full view, sin tocar la sesión Supabase.
 * `hkn-stage-font-scale` se limpia también porque comparte la perilla de
 * zoom con SongView — si quedara un valor de una corrida anterior, el
 * assert de default "1.00" dejaría de ser determinista.
 */
async function clearFullViewPrefs(page) {
  await page.evaluate(() => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('hkn-immersive') || k === 'hkn-stage-font-scale')
      .forEach((k) => localStorage.removeItem(k));
  });
}

test.describe('sheet de opciones — matriz completa (Santo, modo sync)', () => {
  for (const mode of ['letra', 'chords', 'mixed', 'tono']) {
    test(`modo ${mode}: secciones correctas sin reabrir el sheet`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
      const page = await context.newPage();

      await enterFullView(page, SONG_SYNC);
      await openOptions(page);

      const modeBtn = page.locator(`.osheet [data-mode="${mode}"]`);
      const available = (await modeBtn.count()) > 0;
      if (!available) {
        await context.close();
        test.skip(true, `modo ${mode} no disponible para SONG_SYNC en este entorno`);
      }

      await modeBtn.click();

      // VOZ solo aparece en mixed/tono, y debe verse SIN cerrar el sheet
      // (regresión del Frente A: el grupo de voz debe reflejar el modo
      // recién elegido en el mismo render, sin reabrir).
      const voces = page.locator('.osheet [data-voice]');
      if (mode === 'mixed' || mode === 'tono') {
        await expect(voces).toHaveCount(4);
      } else {
        await expect(voces).toHaveCount(0);
      }

      await expect(page.locator('.osheet [data-mode].is-active')).toHaveAttribute(
        'data-mode',
        mode,
      );
      await expect(modeBtn).toHaveAttribute('aria-pressed', 'true');

      await context.close();
    });
  }
});

test.describe('defaults y persistencia', () => {
  test('primera entrada: Letra + ABC + 1.00 aunque SongView tenga capas activas', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_SYNC}`);
    await page.locator('#enter-stage-btn').waitFor({ state: 'visible', timeout: 30000 });
    await clearFullViewPrefs(page);

    // Activar la capa de acordes en SongView ANTES de entrar al full view: el
    // full view NO debe heredar este estado — arranca siempre en Letra.
    // Santo TIENE acordes, así que #layer-chords debe existir en este
    // entorno; si no está presente la precondición del test es inválida y
    // debe fallar, no degradarse en silencio.
    const layerChords = page.locator('#layer-chords');
    await expect(layerChords).toBeVisible();
    await layerChords.click();
    await expect(layerChords).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#enter-stage-btn').click();
    await expect(page.locator('.imm-v1')).toBeVisible();
    await openOptions(page);

    await expect(page.locator('.osheet [data-mode].is-active')).toHaveAttribute(
      'data-mode',
      'letra',
    );
    await expect(page.locator('.osheet [data-notation].is-active')).toHaveAttribute(
      'data-notation',
      'anglo',
    );
    await expect(page.locator('#osheet-font')).toHaveText('1.00');

    await context.close();
  });

  test('A+/A− mueven --imm-font-scale y persisten entre sesiones', async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/song/${SONG_SYNC}`);
    await page.locator('#enter-stage-btn').waitFor({ state: 'visible', timeout: 30000 });
    await clearFullViewPrefs(page);
    await page.locator('#enter-stage-btn').click();
    await expect(page.locator('.imm-v1')).toBeVisible();
    await openOptions(page);

    await page.locator('.osheet [data-act="fup"]').click();
    await expect(page.locator('#osheet-font')).toHaveText('1.10');
    const scaleAfterUp = await page
      .locator('.imm-v1')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--imm-font-scale').trim());
    expect(scaleAfterUp).toBe('1.10');

    await page.locator('.osheet [data-act="fdown"]').click();
    await page.locator('.osheet [data-act="fdown"]').click();
    await expect(page.locator('#osheet-font')).toHaveText('0.90');
    await closeOptions(page);

    // Persistencia: salir y volver a entrar debe conservar 0.90 (localStorage
    // `hkn-stage-font-scale`, compartido con el zoom de SongView).
    await page.locator('#imm-exit').click();
    await expect(page.locator('.imm-v1')).toHaveCount(0);
    await page.locator('#enter-stage-btn').click();
    await expect(page.locator('.imm-v1')).toBeVisible();
    await openOptions(page);
    await expect(page.locator('#osheet-font')).toHaveText('0.90');

    await context.close();
  });
});

test.describe('notación de acordes', () => {
  test('cambiar notación cambia los labels de acordes en el rollo (Do -> G)', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    await enterFullView(page, SONG_SYNC);
    await openOptions(page);

    const chordsBtn = page.locator('.osheet [data-mode="chords"]');
    if ((await chordsBtn.count()) === 0) {
      await context.close();
      test.skip(true, 'SONG_SYNC sin modo chords en este entorno');
    }
    await chordsBtn.click();

    await page.locator('.osheet [data-notation="latin"]').click();
    const chordLabels = page.locator('#imm-roll .chord-label');
    await expect(chordLabels.first()).toBeVisible();
    const latinText = (await chordLabels.allTextContents()).join(' ');
    // Notación latina usa Do/Re/Mi/Fa/Sol/La/Si, nunca letras A-G sueltas.
    expect(/\b(Do|Re|Mi|Fa|Sol|La|Si)\b/.test(latinText)).toBe(true);

    await closeOptions(page);
    await openOptions(page);
    await page.locator('.osheet [data-notation="anglo"]').click();
    const angloText = (await page.locator('#imm-roll .chord-label').allTextContents()).join(' ');
    expect(/\b[A-G](#|b)?\b/.test(angloText)).toBe(true);
    expect(angloText).not.toMatch(/\bDo\b/);

    await context.close();
  });
});

test.describe('afinador', () => {
  test('el toggle activa el panel y lo cierra', async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    await enterFullView(page, SONG_SYNC);
    await revealChrome(page);

    await page.locator('#imm-tuner-toggle').click();
    await expect(page.locator('#imm-tuner-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#imm-tuner-panel')).toBeVisible();

    await page.locator('#imm-tuner-toggle').click();
    await expect(page.locator('#imm-tuner-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#imm-tuner-panel')).toBeHidden();

    await context.close();
  });
});

test.describe('secciones condicionadas por modo de motor (sync vs timer)', () => {
  test('sync (Santo): VELOCIDAD/AUTO-SCROLL oculto; PISTA y METRÓNOMO visibles', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    await enterFullView(page, SONG_SYNC);
    await waitForSync(page);
    await openOptions(page);

    await expect(page.locator('#osheet-autoscroll')).toHaveCount(0);
    await expect(page.locator('#osheet-player')).toHaveCount(1);
    await expect(page.locator('#osheet-metronome')).toHaveCount(1);

    await context.close();
  });

  test('timer (A Ti te alabo): AUTO-SCROLL visible; sin PISTA/METRÓNOMO/badge/pulso', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    await enterFullView(page, SONG_TIMER);
    // Ventana de gracia por si el entorno tuviera datos de audio para esta
    // canción (no debería, es la fixture sin mp3): confirmar que NO promueve.
    await page.waitForTimeout(2000);
    await openOptions(page);

    await expect(page.locator('#osheet-autoscroll')).toHaveCount(1);
    await expect(page.locator('#osheet-player')).toHaveCount(0);
    await expect(page.locator('#osheet-metronome')).toHaveCount(0);
    await expect(page.locator('#imm-bpm-badge')).toBeHidden();
    await expect(page.locator('#imm-pulse')).toBeHidden();

    await context.close();
  });
});

test.describe('voz en el sheet', () => {
  test('elegir una voz actualiza los chips del header', async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    await enterFullView(page, SONG_SYNC);
    await openOptions(page);

    const mixedBtn = page.locator('.osheet [data-mode="mixed"]');
    if ((await mixedBtn.count()) === 0) {
      await context.close();
      test.skip(true, 'SONG_SYNC sin modo mixed en este entorno');
    }
    await mixedBtn.click();

    const voiceBtn = page.locator('.osheet [data-voice="tenor"]');
    await voiceBtn.click();
    await expect(voiceBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#imm-voice-chips')).toBeVisible();
    // Los chips del header muestran solo la inicial (S/A/T/B); el label
    // completo va en aria-label del chip activo ("Voz: Tenor").
    await expect(page.locator('#imm-voice-chips [class*="--active"]')).toHaveAttribute(
      'aria-label',
      /tenor/i,
    );

    await context.close();
  });
});

test.describe('metrónomo: badge, pulso y auto-ocultado del chrome', () => {
  test('badge y pulso visibles al entrar; el pulso NO se oculta con el chrome', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    await enterFullView(page, SONG_SYNC);
    await waitForSync(page);

    await expect(page.locator('#imm-bpm-badge')).toBeVisible();
    await expect(page.locator('#imm-bpm-badge')).toContainText(/BPM/);
    await expect(page.locator('#imm-pulse')).toBeVisible();

    // El chrome se auto-oculta a los 3s de inactividad (CONTROLS_HIDE_MS):
    // esperar a que ocurra es la única forma real de probar que el pulso
    // (hermano del chrome en el DOM, no hijo) sobrevive al ocultado.
    await expect(page.locator('#imm-chrome')).toHaveClass(/imm-v1__chrome--hidden/, {
      timeout: 6000,
    });
    await expect(page.locator('#imm-pulse')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/fullview-pulso-chrome-oculto.png' });

    await context.close();
  });

  test('count-in aparece en la intro/interludio con la pista corriendo', async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    await enterFullView(page, SONG_SYNC);
    await waitForSync(page);

    await page.locator('#imm-player-play').click();

    // Santo tiene beats desde 92ms y varios interludios entre líneas; con
    // gap >= 2 beats el count-in debe aparecer en alguno durante los
    // primeros ~15s de reproducción real. Timeout generoso, sin sleeps fijos.
    // Verificado en corrida real: el count-in SÍ aparece con esta fixture,
    // así que el assert es duro (debe fallar si la feature regresa).
    const countIn = page.locator('.imm-interlude__count');
    await expect(countIn).toBeVisible({ timeout: 15000 });
    await expect(countIn).toHaveText(/^\d+$/);
    await page.screenshot({ path: 'e2e/screenshots/fullview-count-in.png' });

    await context.close();
  });
});

test.describe('verificación visual — layout', () => {
  test('afinador no tapa la barra de player; el sheet no desborda el viewport', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    await enterFullView(page, SONG_SYNC);
    await waitForSync(page);
    await revealChrome(page);

    await page.locator('#imm-tuner-toggle').click();
    // Ambos elementos deben estar activos en este punto (pista sync + panel
    // del afinador abierto): si alguno no aparece, el test debe fallar en
    // vez de saltar el assert de layout en silencio.
    await expect(page.locator('#imm-tuner-panel')).toBeVisible();
    await expect(page.locator('#imm-player')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/fullview-afinador-player.png' });

    const player = await page.locator('#imm-player').boundingBox();
    const tuner = await page.locator('#imm-tuner-panel').boundingBox();
    expect(player).not.toBeNull();
    expect(tuner).not.toBeNull();
    expect(tuner.y + tuner.height).toBeLessThanOrEqual(player.y + 1);

    await page.locator('#imm-tuner-toggle').click();
    await openOptions(page);
    await page.screenshot({ path: 'e2e/screenshots/fullview-sheet-abierto.png' });

    const sheet = await page.locator('.osheet').boundingBox();
    const viewport = page.viewportSize();
    expect(sheet).not.toBeNull();
    expect(sheet.width).toBeLessThanOrEqual(viewport.width);

    await context.close();
  });

  test('modo letra y mixed con voz elegida: capturas de estado', async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const page = await context.newPage();

    await enterFullView(page, SONG_SYNC);
    await page.screenshot({ path: 'e2e/screenshots/fullview-letra.png' });

    await openOptions(page);
    const mixedBtn = page.locator('.osheet [data-mode="mixed"]');
    if (await mixedBtn.count()) {
      await mixedBtn.click();
      await page.locator('.osheet [data-voice="soprano"]').click();
      await closeOptions(page);
      await page.screenshot({ path: 'e2e/screenshots/fullview-mixed-voz.png' });
    }

    await context.close();
  });
});
