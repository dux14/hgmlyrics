/**
 * shuffle.js — utilidades de barajado compartidas (/buscar, Home).
 */

/** PRNG determinista (mulberry32) — para barajar estable por sesión. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** Fisher-Yates sembrado. Pura: mismo (arr, seedStr) → misma permutación. */
export function seededShuffle(arr, seedStr) {
  const rand = mulberry32(seedFromString(seedStr));
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** Baraja con semilla fresca en cada llamada — variedad en cada entrada. */
export function freshShuffle(arr) {
  return seededShuffle(arr, String(Math.random()));
}
