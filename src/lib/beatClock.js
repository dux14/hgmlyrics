/**
 * beatClock.js — reloj de compás puro sobre una rejilla de beats (ms).
 * Sin DOM ni Web Audio: lo consume el rAF de ImmersiveView leyendo
 * audio.currentTime, y los tests lo ejercitan con números pelados.
 */

/**
 * @param {{ beatsMs: number[], timeSignature?: string, beatAnchor?: number }} grid
 * @returns {{ at: (ms: number) => { beatIndex: number, beatInBar: number, bar: number, msToNextBeat: number|null }, beatsUntil: (ms: number, targetMs: number) => number, perBar: number }}
 */
export function createBeatClock({ beatsMs, timeSignature = '4/4', beatAnchor = 1 }) {
  const perBar = Number.parseInt(String(timeSignature).split('/')[0], 10) || 4;
  const anchor = Math.min(Math.max(beatAnchor ?? 1, 1), perBar);

  // Ultimo beat con beatsMs[i] <= ms; -1 si ms cae antes del primer beat.
  function indexAt(ms) {
    let lo = 0;
    let hi = beatsMs.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (beatsMs[mid] <= ms) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  function at(ms) {
    const idx = indexAt(ms);
    if (idx < 0) {
      return { beatIndex: -1, beatInBar: 0, bar: 0, msToNextBeat: beatsMs[0] - ms };
    }
    const shifted = idx - (anchor - 1);
    const beatInBar = (((shifted % perBar) + perBar) % perBar) + 1;
    const bar = Math.floor(shifted / perBar) + 1;
    const msToNextBeat = idx + 1 < beatsMs.length ? beatsMs[idx + 1] - ms : null;
    return { beatIndex: idx, beatInBar, bar, msToNextBeat };
  }

  function beatsUntil(ms, targetMs) {
    return Math.max(0, indexAt(targetMs) - indexAt(ms));
  }

  return { at, beatsUntil, perBar };
}
