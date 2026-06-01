import { test, expect } from '@playwright/test';

/**
 * E2E del flujo completo de Feature Flags.
 *
 * NOTA: Playwright aún no está instalado ni configurado en este repo. Este
 * archivo es el artefacto que ejecutará un harness futuro (o la validación en
 * el preview de Vercel). Asume:
 *   - BASE_URL apunta a un deploy/preview con la sesión de admin ya disponible.
 *   - ADMIN_STORAGE_STATE / USER_STORAGE_STATE: storageState de cada rol
 *     (sesión Supabase persistida en localStorage).
 *   - TEST_USER_EMAIL: email de un usuario de prueba real al que se le asigna
 *     el flag `voz_tono`.
 *
 * Escenario:
 *   1. Como admin, abrir #/admin y agregar el email del usuario de prueba al
 *      flag `voz_tono`. Verificar que aparece en la lista del flag.
 *   2. Como ese usuario, verificar que GET /api/auth/me devuelve flags con
 *      `voz_tono`.
 *   3. Como admin, quitar la asignación y verificar que desaparece de la lista.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const ADMIN_STORAGE_STATE = process.env.ADMIN_STORAGE_STATE ?? 'admin-state.json';
const USER_STORAGE_STATE = process.env.USER_STORAGE_STATE ?? 'user-state.json';
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? 'test-user@example.com';

const FLAG_KEY = 'voz_tono';

test.describe('Feature Flags — flujo completo', () => {
  test('admin asigna voz_tono, el usuario lo resuelve, admin lo quita', async ({ browser }) => {
    // --- Sesión de admin ---
    const adminContext = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const adminPage = await adminContext.newPage();

    await adminPage.goto(`${BASE_URL}/#/admin`);

    const flagItem = adminPage.locator(`.ff-item[data-flag="${FLAG_KEY}"]`);
    await expect(flagItem).toBeVisible();

    // 1. Agregar el email del usuario de prueba al flag.
    await flagItem.locator('.ff-input').fill(TEST_USER_EMAIL);
    await flagItem.locator('.ff-add').click();

    // La lista se recarga; el usuario debe aparecer en la lista del flag.
    await expect(
      flagItem.locator('.ff-item__users li', { hasText: TEST_USER_EMAIL }),
    ).toBeVisible();

    // 2. Como el usuario de prueba: /api/auth/me devuelve flags con voz_tono.
    const userContext = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const userPage = await userContext.newPage();
    await userPage.goto(`${BASE_URL}/#/`);

    const meResponse = await userPage.evaluate(async () => {
      const raw = Object.keys(globalThis.localStorage).find((k) => k.includes('auth-token'));
      const token = raw ? JSON.parse(globalThis.localStorage.getItem(raw)).access_token : '';
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      return res.json();
    });
    expect(meResponse.flags).toContain(FLAG_KEY);

    // 3. Como admin: quitar la asignación y verificar que desaparece.
    await adminPage.reload();
    const removeBtn = flagItem.locator(`.ff-remove[data-email="${TEST_USER_EMAIL}"]`);
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    await expect(flagItem.locator('.ff-item__users li', { hasText: TEST_USER_EMAIL })).toHaveCount(
      0,
    );

    await adminContext.close();
    await userContext.close();
  });
});
