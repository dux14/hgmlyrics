/**
 * router.test.js — Unit tests for router module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { route, navigate, getCurrentPath, initRouter, onNotFound, refresh } from '../src/router.js';

describe('router', () => {
  beforeEach(() => {
    // Reset hash
    window.location.hash = '';
  });

  describe('getCurrentPath', () => {
    it('should return "/" when hash is empty', () => {
      window.location.hash = '';
      expect(getCurrentPath()).toBe('/');
    });

    it('should return the hash path without the # prefix', () => {
      window.location.hash = '/song/test-id';
      expect(getCurrentPath()).toBe('/song/test-id');
    });
  });

  describe('navigate', () => {
    it('should set window.location.hash', () => {
      navigate('/song/my-song');
      expect(window.location.hash).toBe('#/song/my-song');
    });

    it('should navigate to home', () => {
      navigate('/');
      expect(window.location.hash).toBe('#/');
    });
  });

  describe('route + initRouter', () => {
    it('should call the matching route handler', () => {
      const handler = vi.fn();
      route('/', handler);
      window.location.hash = '#/';
      refresh();
      expect(handler).toHaveBeenCalled();
    });

    it('should parse :param from route pattern', () => {
      const handler = vi.fn();
      route('/song/:id', handler);
      window.location.hash = '#/song/my-test-id';
      refresh();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { id: 'my-test-id' },
        }),
      );
    });

    it('should handle URL-encoded params', () => {
      const handler = vi.fn();
      route('/song/:id', handler);
      window.location.hash = '#/song/canci%C3%B3n-especial';
      refresh();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { id: 'canción-especial' },
        }),
      );
    });
  });

  describe('onNotFound', () => {
    it('should call not-found handler for unmatched routes', () => {
      const notFoundHandler = vi.fn();
      onNotFound(notFoundHandler);
      window.location.hash = '#/unknown/route/that/does/not/exist';
      refresh();
      expect(notFoundHandler).toHaveBeenCalled();
    });
  });
});
