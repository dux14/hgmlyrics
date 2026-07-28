import { describe, it, expect } from 'vitest';
import { createSectionAccordion } from './SectionPlayer.js';

/**
 * Manager falso mínimo: solo lo que consume createSectionAccordion. El <audio>
 * es real de jsdom (duration NaN, currentTime 0, paused true por defecto).
 */
function fakeManager({ currentTrack = null } = {}) {
  return {
    audio: document.createElement('audio'),
    getCurrentTrack: () => currentTrack,
    onTime: () => () => {},
    onEnded: () => () => {},
    play() {},
    pause() {},
    seek() {},
    load() {},
  };
}

function totalText(el) {
  const times = el.querySelectorAll('.section-audio__time');
  return times[times.length - 1].textContent;
}

describe('createSectionAccordion — duración total', () => {
  it('pinta la duración aunque durationSec llegue como string (columna numeric de Postgres)', () => {
    const tracks = [
      {
        id: 't1',
        sectionIndex: 0,
        voiceScope: 'tenor',
        label: null,
        durationSec: '135.846893',
        url: 'https://x/s.mp3',
      },
    ];
    const { el } = createSectionAccordion({ manager: fakeManager(), sectionIndex: 0, tracks });
    // 135s → 2:15. Antes del fix, fmtTime(string) caía en !Number.isFinite → "0:00".
    expect(totalText(el)).toBe('2:15');
  });

  it('durationSec numérico también funciona', () => {
    const tracks = [
      {
        id: 't1',
        sectionIndex: 0,
        voiceScope: 'tenor',
        label: null,
        durationSec: 72,
        url: 'https://x/s.mp3',
      },
    ];
    const { el } = createSectionAccordion({ manager: fakeManager(), sectionIndex: 0, tracks });
    expect(totalText(el)).toBe('1:12');
  });

  it('durationSec null sin pista sonando → 0:00 sin romper', () => {
    const tracks = [
      {
        id: 't1',
        sectionIndex: 0,
        voiceScope: 'tenor',
        label: null,
        durationSec: null,
        url: 'https://x/s.mp3',
      },
    ];
    const { el } = createSectionAccordion({ manager: fakeManager(), sectionIndex: 0, tracks });
    expect(totalText(el)).toBe('0:00');
  });
});
