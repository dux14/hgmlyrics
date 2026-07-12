import { describe, expect, it } from 'vitest';
import { createBeatClock } from './beatClock.js';

const grid = {
  beatsMs: [1000, 1650, 2300, 2950, 3600, 4250, 4900, 5550],
  timeSignature: '4/4',
  beatAnchor: 1,
};

describe('createBeatClock', () => {
  it('antes del primer beat: beatIndex -1 y msToNextBeat correcto', () => {
    const c = createBeatClock(grid);
    expect(c.at(0)).toEqual({ beatIndex: -1, beatInBar: 0, bar: 0, msToNextBeat: 1000 });
  });

  it('en el beat exacto y entre beats', () => {
    const c = createBeatClock(grid);
    expect(c.at(1000).beatInBar).toBe(1);
    expect(c.at(1700).beatInBar).toBe(2);
    expect(c.at(1700).msToNextBeat).toBe(600);
  });

  it('compás avanza cada perBar beats', () => {
    const c = createBeatClock(grid);
    expect(c.at(1000).bar).toBe(1);
    expect(c.at(3600).bar).toBe(2); // 5o beat
  });

  it('beatAnchor desplaza el acento', () => {
    const c = createBeatClock({ ...grid, beatAnchor: 2 });
    expect(c.at(1650).beatInBar).toBe(1); // el 2o beat detectado es el "1"
    expect(c.at(1000).beatInBar).toBe(4); // el beat anterior al ancla cierra el compás previo
  });

  it('3/4 usa perBar 3', () => {
    const c = createBeatClock({ ...grid, timeSignature: '3/4' });
    expect(c.perBar).toBe(3);
    expect(c.at(2950).beatInBar).toBe(1); // 4o beat = compás 2 tiempo 1
  });

  it('después del último beat: msToNextBeat null', () => {
    expect(createBeatClock(grid).at(9999).msToNextBeat).toBeNull();
  });

  it('beatsUntil cuenta beats en (ms, target]', () => {
    const c = createBeatClock(grid);
    expect(c.beatsUntil(1000, 3600)).toBe(4); // 1650,2300,2950,3600
    expect(c.beatsUntil(5550, 9000)).toBe(0);
  });
});
