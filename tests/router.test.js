/**
 * router.test.js — Unit tests for router module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  route,
  navigate,
  getCurrentPath,
  initRouter,
  onNotFound,
  refresh,
  configureAuth,
  guardedRoute,
} from '../src/router.js';

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

    it('with { replace } resolves synchronously without leaving a history entry', () => {
      const handler = vi.fn();
      route('/login', handler);
      const lengthBefore = window.history.length;
      navigate('/login', { replace: true });
      expect(window.history.length).toBe(lengthBefore); // replaceState, no pushState
      expect(handler).toHaveBeenCalled();
      expect(getCurrentPath()).toBe('/login');
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

describe('guardedRoute', () => {
  beforeEach(() => {
    globalThis.location.hash = '';
  });

  it('redirects to /login?next=... when not authenticated', () => {
    const handler = vi.fn();
    configureAuth({
      isAuthenticated: () => false,
      needsOnboarding: () => false,
      isAdmin: () => false,
    });
    guardedRoute('/secret', handler);
    globalThis.location.hash = '/secret';
    refresh();
    expect(handler).not.toHaveBeenCalled();
    expect(globalThis.location.hash).toContain('/login?next=');
  });

  it('redirects to /onboarding when needsOnboarding is true', () => {
    const handler = vi.fn();
    configureAuth({
      isAuthenticated: () => true,
      needsOnboarding: () => true,
      isAdmin: () => false,
    });
    guardedRoute('/home', handler);
    globalThis.location.hash = '/home';
    refresh();
    expect(handler).not.toHaveBeenCalled();
    expect(globalThis.location.hash).toBe('#/onboarding');
  });

  it('redirects to / when adminOnly and not admin', () => {
    const handler = vi.fn();
    configureAuth({
      isAuthenticated: () => true,
      needsOnboarding: () => false,
      isAdmin: () => false,
    });
    guardedRoute('/admin', handler, { adminOnly: true });
    globalThis.location.hash = '/admin';
    refresh();
    expect(handler).not.toHaveBeenCalled();
    expect(globalThis.location.hash).toBe('#/');
  });

  it('invokes handler when authenticated + no onboarding + admin pass', () => {
    const handler = vi.fn();
    configureAuth({
      isAuthenticated: () => true,
      needsOnboarding: () => false,
      isAdmin: () => true,
    });
    guardedRoute('/admin', handler, { adminOnly: true });
    globalThis.location.hash = '/admin';
    refresh();
    expect(handler).toHaveBeenCalled();
  });

  it('forwards the query string to the handler (e.g. /afinador?mode=song&ref=F#3)', () => {
    const handler = vi.fn();
    configureAuth({
      isAuthenticated: () => true,
      needsOnboarding: () => false,
      isAdmin: () => false,
    });
    guardedRoute('/afinador', handler);
    globalThis.location.hash = '/afinador?mode=song&ref=F%233&from=abc';
    refresh();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'mode=song&ref=F%233&from=abc' }),
    );
  });
});
