/**
 * auth.js — Admin authentication module
 *
 * Uses backend API to verify PIN and get a JWT token.
 */

const SESSION_KEY = 'hkn-admin-token';
const API_URL = '/api';

/**
 * Attempt admin login
 * @param {string} pin
 * @returns {Promise<boolean>} true if login succeeded
 */
export async function login(pin) {
  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    
    if (res.ok) {
      const data = await res.json();
      sessionStorage.setItem(SESSION_KEY, data.token);
      return true;
    }
    return false;
  } catch (e) {
    console.error('Login error', e);
    return false;
  }
}

/**
 * Check if currently authenticated
 * @returns {boolean}
 */
export function isAuthenticated() {
  try {
    return !!sessionStorage.getItem(SESSION_KEY);
  } catch (_e) {
    return false;
  }
}

/**
 * Log out — clear session
 */
export function logout() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (_e) {
    // Ignore
  }
}

/**
 * Get the current JWT token
 * @returns {string|null}
 */
export function getToken() {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch (_e) {
    return null;
  }
}
