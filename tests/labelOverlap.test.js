import { describe, it, expect } from 'vitest';
import { computeOverlapAdjustments, resolveLabelOverlaps } from '../src/lib/labelOverlap.js';

describe('computeOverlapAdjustments', () => {
  it('sin colisión ni rebase, todos los ajustes son 0', () => {
    const items = [
      { left: 0, right: 20, top: 0 },
      { left: 40, right: 60, top: 0 },
      { left: 80, right: 100, top: 0 },
    ];
    expect(computeOverlapAdjustments(items, 4, Infinity)).toEqual([0, 0, 0]);
  });

  it('dos labels solapados en la misma fila reciben el ajuste mínimo en el primero', () => {
    // El segundo empieza (left=15) antes de que el primero termine (right=20) + gap.
    const items = [
      { left: 0, right: 20, top: 0 },
      { left: 15, right: 35, top: 0 },
    ];
    const gap = 4;
    const adjust = computeOverlapAdjustments(items, gap, Infinity);
    // needed = right[0] + gap - left[1] = 20 + 4 - 15 = 9
    expect(adjust[0]).toBe(9);
    expect(adjust[1]).toBe(0);
  });

  it('labels en filas distintas (top diferente) no colisionan aunque se solapen en X', () => {
    const items = [
      { left: 0, right: 50, top: 0 },
      { left: 10, right: 60, top: 20 }, // fila distinta, top muy separado
    ];
    expect(computeOverlapAdjustments(items, 4, Infinity)).toEqual([0, 0]);
  });

  it('cadena de 3 solapados acumula el empuje en cascada', () => {
    const items = [
      { left: 0, right: 20, top: 0 },
      { left: 15, right: 35, top: 0 },
      { left: 30, right: 50, top: 0 },
    ];
    const gap = 2;
    const adjust = computeOverlapAdjustments(items, gap, Infinity);
    // i=0 vs i=1: needed = 20 + 2 - 15 = 7 → adjust[0] = 7
    // tras empujar i=1..2 en +7: item1 efectivo pasa a left=22,right=42
    // i=1 vs i=2: item2 efectivo (tras heredar +7) left=37,right=57
    //   needed = effectiveRight[1] (42) + 2 - effectiveLeft[2] (37) = 7 → adjust[1] = 7
    expect(adjust[0]).toBe(7);
    expect(adjust[1]).toBe(7);
    expect(adjust[2]).toBe(0);
  });

  it('rebase de boundRight empuja al segmento anterior de la misma fila', () => {
    const items = [
      { left: 0, right: 20, top: 0 },
      { left: 30, right: 55, top: 0 }, // se pasa del borde (boundRight=50)
    ];
    const adjust = computeOverlapAdjustments(items, 2, 50);
    // overshoot = 55 - 50 = 5, va al segmento anterior (índice 0).
    expect(adjust[0]).toBe(5);
    expect(adjust[1]).toBe(0);
  });

  it('rebase de boundRight en el primer label de la fila no tiene a quién empujar (límite documentado)', () => {
    const items = [{ left: 0, right: 60, top: 0 }];
    const adjust = computeOverlapAdjustments(items, 2, 50);
    expect(adjust).toEqual([0]);
  });

  it('boundRight = Infinity nunca dispara el ajuste de borde', () => {
    const items = [{ left: 0, right: 10000, top: 0 }];
    expect(computeOverlapAdjustments(items, 2, Infinity)).toEqual([0]);
  });

  it('lista vacía devuelve arreglo vacío', () => {
    expect(computeOverlapAdjustments([], 4, Infinity)).toEqual([]);
  });
});

describe('resolveLabelOverlaps (smoke jsdom)', () => {
  it('corre sin lanzar sobre HTML real de modo Acordes, aunque getBoundingClientRect dé 0 en jsdom', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <p class="lyrics__line lyrics__line--chords">
        <span class="line-word">
          <span class="line-seg"><span class="float-label chord-label"><i>C</i></span>San</span>
          <span class="line-seg"><span class="float-label chord-label"><i>G</i></span>to</span>
        </span>
      </p>
    `;
    expect(() => resolveLabelOverlaps(root)).not.toThrow();
  });

  it('limpia data-overlap-fix de una pasada previa antes de volver a medir', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <p class="lyrics__line lyrics__line--tono">
        <span class="line-word">
          <span class="line-seg" data-overlap-fix="1" style="margin-right: 12px">
            <span class="float-label tono-note"><i>Do</i></span>Sol
          </span>
        </span>
      </p>
    `;
    resolveLabelOverlaps(root);
    const seg = root.querySelector('.line-seg');
    // En jsdom los rects dan todos 0 → no hay colisión que resolver, así que
    // el ajuste previo se limpia y no se reaplica ninguno nuevo.
    expect(seg.hasAttribute('data-overlap-fix')).toBe(false);
    expect(seg.style.marginRight).toBe('');
  });

  it('modo mixto: separa el carril de acordes del de notas sin lanzar', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <p class="lyrics__line lyrics__line--mix">
        <span class="line-word">
          <span class="mix-seg">
            <span class="mix-rail mix-rail--chord"><i>C</i></span>
            <span class="mix-rail mix-rail--lyric">San</span>
            <span class="mix-rail mix-rail--note"><i>Do</i></span>
          </span>
        </span>
      </p>
    `;
    expect(() => resolveLabelOverlaps(root)).not.toThrow();
  });

  it('rootEl nulo o sin líneas no lanza', () => {
    expect(() => resolveLabelOverlaps(null)).not.toThrow();
    const empty = document.createElement('div');
    expect(() => resolveLabelOverlaps(empty)).not.toThrow();
  });
});
