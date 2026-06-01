import { test, expect } from '@playwright/test';

/**
 * E2E de autoría v2 (voz_tono) en el editor de canciones + regresión v1.
 *
 * NOTA: Playwright aún no está instalado ni configurado en este repo. Este
 * archivo es el artefacto que ejecutará un harness futuro (o la validación en
 * el preview de Vercel). Asume:
 *   - BASE_URL apunta a un deploy/preview.
 *   - ADMIN_V2_STORAGE_STATE: storageState de un admin con el flag `voz_tono`
 *     ya asignado (sesión Supabase persistida en localStorage).
 *   - ADMIN_V1_STORAGE_STATE: storageState de un admin SIN el flag `voz_tono`,
 *     para la regresión v1.
 *
 * Escenario v2 (Task 6, Step 1):
 *   1. Crear canción, añadir 2 voces soprano (A, B).
 *   2. Escribir una línea, dividir en sílabas.
 *   3. Asignar Soprano A a las primeras sílabas con notas B3 A3.
 *   4. Crear un melisma. Guardar.
 *   5. Verificar que GET /api/songs/:id devuelve schemaVersion:2, voiceRoster
 *      con 2 sopranos y voiceLines alineados.
 *   6. Abrir el lector (C) y verificar que muestra las notas.
 *
 * Regresión v1 (Task 6, Step 3):
 *   Sin el flag, el editor edita y guarda una canción v1 (sin schemaVersion ni
 *   voiceRoster en el payload).
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const ADMIN_V2_STORAGE_STATE = process.env.ADMIN_V2_STORAGE_STATE ?? 'admin-v2-state.json';
const ADMIN_V1_STORAGE_STATE = process.env.ADMIN_V1_STORAGE_STATE ?? 'admin-v1-state.json';

/** Lee el access_token de la sesión Supabase persistida en localStorage. */
async function getToken(page) {
  return page.evaluate(() => {
    const raw = Object.keys(globalThis.localStorage).find((k) => k.includes('auth-token'));
    return raw ? JSON.parse(globalThis.localStorage.getItem(raw)).access_token : '';
  });
}

test.describe('Editor v2 — autoría voz_tono', () => {
  test('crea canción v2 con roster, silabación, notas y melisma; el lector muestra notas', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: ADMIN_V2_STORAGE_STATE });
    const page = await context.newPage();

    // 1. Nueva canción.
    await page.goto(`${BASE_URL}/#/admin/create`);
    await page.fill('#song-title', 'Santo Test V2');

    // La zona de roster sólo existe con el flag activo.
    const roster = page.locator('#editor-roster');
    await expect(roster).toBeVisible();

    // 1b. Añadir 2 voces soprano (A, B).
    await page.click('#add-roster-voice');
    await page.click('#add-roster-voice');
    const rosterRows = page.locator('#roster-list .roster-row');
    await expect(rosterRows).toHaveCount(2);
    await rosterRows.nth(0).locator('[data-action="roster-name"]').fill('Soprano A');
    await rosterRows.nth(0).locator('[data-action="roster-category"]').selectOption('soprano');
    await rosterRows.nth(1).locator('[data-action="roster-name"]').fill('Soprano B');
    await rosterRows.nth(1).locator('[data-action="roster-category"]').selectOption('soprano');

    // 2. Escribir una línea.
    await page.click('#add-section-btn');
    const firstLineInput = page.locator('.section-block .line-row__input').first();
    await firstLineInput.fill('Santo');

    // Abrir el editor de tono de esa línea.
    await page.locator('.line-row [data-action="open-tono"]').first().click();
    const tono = page.locator('.tono-editor');
    await expect(tono).toBeVisible();

    // 2b. Dividir en sílabas: auto-sugerir produce "San|to".
    await tono.locator('[data-tono="autosuggest"]').click();
    await expect(tono.locator('.tono-syllables .syl-chip')).toHaveCount(2);

    // 3. Voz activa = Soprano A. Marcar la primera sílaba como cantada.
    await tono.locator('[data-tono="active-voice"]').selectOption({ label: /Soprano A/ });
    // Tap-anchor-extend a nivel sílaba: anchor en la sílaba 0, focus en la 0.
    await tono.locator('.syl-chip[data-syl="0"]').click();
    await tono.locator('.syl-chip[data-syl="0"]').click();
    // Asignar nota B3 a la sílaba 0 (toca de nuevo → abre note picker).
    await tono.locator('.syl-chip[data-syl="0"]').click();
    await page.locator('.note-picker__note[data-note="B3"]').click();

    // Sílaba 1 con nota A3.
    await tono.locator('.syl-chip[data-syl="1"]').click();
    await tono.locator('.syl-chip[data-syl="1"]').click();
    await tono.locator('.syl-chip[data-syl="1"]').click();
    await page.locator('.note-picker__note[data-note="A3"]').click();

    // 4. Crear un melisma sobre la sílaba 1 (sílaba de ancho cero).
    await tono.locator('.syl-chip__melisma[data-melisma="1"]').click();
    await expect(tono.locator('.tono-syllables .syl-chip--melisma')).toHaveCount(1);

    // Cerrar el editor de tono y guardar.
    await tono.locator('[data-tono="done"]').click();
    await page.click('#editor-save');

    // No debe mostrarse error inline de validación.
    await expect(page.locator('#editor-save-error')).toBeHidden();

    // 5. Verificar el payload persistido vía API.
    await page.waitForURL(/#\/admin/);
    const token = await getToken(page);
    const songs = await page.evaluate(async (t) => {
      const res = await fetch('/api/songs/all', { headers: { Authorization: `Bearer ${t}` } });
      return res.json();
    }, token);
    const created = (Array.isArray(songs) ? songs : songs.songs || []).find(
      (s) => s.title === 'Santo Test V2',
    );
    expect(created).toBeTruthy();

    const detail = await page.evaluate(
      async ({ t, id }) => {
        const res = await fetch(`/api/songs/${id}`, { headers: { Authorization: `Bearer ${t}` } });
        return res.json();
      },
      { t: token, id: created.id },
    );

    expect(detail.schemaVersion).toBe(2);
    expect(detail.voiceRoster).toHaveLength(2);
    expect(detail.voiceRoster.every((v) => v.category === 'soprano')).toBe(true);

    const line = detail.sections.flatMap((sec) => sec.lines).find((l) => l.text === 'Santo');
    expect(line).toBeTruthy();
    // syllables: "San","to" + extensor de melisma (ancho cero) = 3.
    expect(line.syllables.length).toBe(3);
    const sopranoAId = detail.voiceRoster.find((v) => v.name === 'Soprano A').id;
    const vl = line.voiceLines[sopranoAId];
    expect(vl.sungSyllables.length).toBe(vl.notes.length); // alineados
    expect(vl.notes).toContain('B3');
    expect(vl.notes).toContain('A3');

    // 6. Abrir el lector (C) y verificar que muestra las notas.
    await page.goto(`${BASE_URL}/#/song/${created.id}`);
    await expect(page.locator('body')).toContainText('Santo Test V2');
    // El lector v2 expone las notas por sílaba (data-note o texto de nota).
    await expect(page.locator('[data-note="B3"], .syll[data-note]').first()).toBeVisible();

    await context.close();
  });

  test('regresión v1: sin el flag, el editor guarda una canción v1 sin campos v2', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: ADMIN_V1_STORAGE_STATE });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/#/admin/create`);

    // Sin el flag NO debe existir la zona de roster ni el botón de tono.
    await expect(page.locator('#editor-roster')).toHaveCount(0);
    await page.fill('#song-title', 'Cancion V1 Test');
    await page.click('#add-section-btn');
    await expect(page.locator('.line-row [data-action="open-tono"]')).toHaveCount(0);

    await page.locator('.section-block .line-row__input').first().fill('Letra v1');
    await page.click('#editor-save');
    await page.waitForURL(/#\/admin/);

    const token = await getToken(page);
    const songs = await page.evaluate(async (t) => {
      const res = await fetch('/api/songs/all', { headers: { Authorization: `Bearer ${t}` } });
      return res.json();
    }, token);
    const created = (Array.isArray(songs) ? songs : songs.songs || []).find(
      (s) => s.title === 'Cancion V1 Test',
    );
    expect(created).toBeTruthy();

    const detail = await page.evaluate(
      async ({ t, id }) => {
        const res = await fetch(`/api/songs/${id}`, { headers: { Authorization: `Bearer ${t}` } });
        return res.json();
      },
      { t: token, id: created.id },
    );

    // Payload v1 puro: sin schemaVersion 2 ni voiceRoster.
    expect(detail.schemaVersion).not.toBe(2);
    const noRoster =
      detail.voiceRoster === null ||
      detail.voiceRoster === undefined ||
      detail.voiceRoster.length === 0;
    expect(noRoster).toBe(true);

    await context.close();
  });
});
