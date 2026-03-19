/**
 * auth.test.js — Unit tests for auth module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hashPin, verifyPin, login, isAuthenticated, logout } from '../src/lib/auth.js';

describe('auth', () => {
  beforeEach(() => {
    // Clear session/localStorage between tests
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  describe('hashPin', () => {
    it('should return a hex string', async () => {
      const hash = await hashPin('1234');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should return the correct SHA-256 hash for "1234"', async () => {
      const hash = await hashPin('1234');
      expect(hash).toBe('03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4');
    });

    it('should produce different hashes for different inputs', async () => {
      const hash1 = await hashPin('1234');
      const hash2 = await hashPin('5678');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce the same hash for the same input', async () => {
      const hash1 = await hashPin('test');
      const hash2 = await hashPin('test');
      expect(hash1).toBe(hash2);
    });
  });

  describe('verifyPin', () => {
    it('should return true for the default PIN "1234"', async () => {
      const result = await verifyPin('1234');
      expect(result).toBe(true);
    });

    it('should return false for an incorrect PIN', async () => {
      const result = await verifyPin('wrong');
      expect(result).toBe(false);
    });

    it('should return false for empty string', async () => {
      const result = await verifyPin('');
      expect(result).toBe(false);
    });
  });

  describe('login', () => {
    it('should return true and set session for correct PIN', async () => {
      const result = await login('1234');
      expect(result).toBe(true);
      expect(isAuthenticated()).toBe(true);
    });

    it('should return false and not set session for wrong PIN', async () => {
      const result = await login('wrong');
      expect(result).toBe(false);
      expect(isAuthenticated()).toBe(false);
    });
  });

  describe('isAuthenticated', () => {
    it('should return false when not logged in', () => {
      expect(isAuthenticated()).toBe(false);
    });

    it('should return true after successful login', async () => {
      await login('1234');
      expect(isAuthenticated()).toBe(true);
    });
  });

  describe('logout', () => {
    it('should clear the session', async () => {
      await login('1234');
      expect(isAuthenticated()).toBe(true);

      logout();
      expect(isAuthenticated()).toBe(false);
    });
  });
});
