// recentVisits.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { recordVisit, getRecentVisitIds } from './recentVisits.js';

const STORAGE_KEY = 'hkn:recent-visits';

beforeEach(() => {
  localStorage.clear();
});

describe('recordVisit / getRecentVisitIds', () => {
  it('devuelve los ids del más reciente al más antiguo', () => {
    recordVisit('s1');
    recordVisit('s2');
    recordVisit('s3');
    expect(getRecentVisitIds()).toEqual(['s3', 's2', 's1']);
  });

  it('una visita repetida mueve el id al frente sin duplicarlo', () => {
    recordVisit('s1');
    recordVisit('s2');
    recordVisit('s1');
    expect(getRecentVisitIds()).toEqual(['s1', 's2']);
  });

  it('acota el historial a 24 entradas', () => {
    for (let i = 0; i < 30; i++) recordVisit(`s${i}`);
    const ids = getRecentVisitIds(100);
    expect(ids.length).toBe(24);
    expect(ids[0]).toBe('s29');
  });

  it('ignora songId falsy', () => {
    recordVisit(null);
    recordVisit(undefined);
    recordVisit('');
    expect(getRecentVisitIds()).toEqual([]);
  });

  it('devuelve [] si el JSON almacenado es inválido', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');
    expect(getRecentVisitIds()).toEqual([]);
  });

  it('devuelve [] si el valor almacenado no es un array', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 's1' }));
    expect(getRecentVisitIds()).toEqual([]);
  });

  it('ignora entradas corruptas sin id', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ at: 1 }, { id: 's1', at: 2 }]));
    expect(getRecentVisitIds()).toEqual(['s1']);
  });

  it('no explota si localStorage lanza al leer o escribir', () => {
    const original = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('storage bloqueado');
        },
        setItem: () => {
          throw new Error('storage lleno');
        },
      },
    });

    expect(() => recordVisit('s1')).not.toThrow();
    expect(getRecentVisitIds()).toEqual([]);

    Object.defineProperty(window, 'localStorage', { configurable: true, value: original });
  });
});
