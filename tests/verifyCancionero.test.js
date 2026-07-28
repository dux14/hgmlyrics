/**
 * verifyCancionero.test.js — Task A7, verificación de cierre de la letra
 * canónica. Funciones puras (_verifyLib.mjs) se testean directo. El flujo
 * del script (scripts/verify-cancionero.mjs) mockea `postgres`, mismo patrón
 * que tests/ingestCancionero.test.js -- NUNCA toca la DB real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateCanonicalContent,
  coverageReport,
  lineCountMismatch,
  projectSongLines,
} from '../scripts/_verifyLib.mjs';

// ── Funciones puras ──────────────────────────────────────────────────────

describe('validateCanonicalContent', () => {
  it('content válido -> ok, cuenta secciones y líneas', () => {
    const content = {
      secciones: [
        { lineas: [{ texto: 'linea 1' }, { texto: 'linea 2' }] },
        { tipo: 'coro', lineas: [{ texto: 'linea 3' }] },
      ],
    };
    const result = validateCanonicalContent(content);
    expect(result.ok).toBe(true);
    expect(result.sectionCount).toBe(2);
    expect(result.lineCount).toBe(3);
    expect(result.problems).toHaveLength(0);
  });

  it('content sin "secciones" -> problema listado', () => {
    const result = validateCanonicalContent({});
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/secciones/);
  });

  it('sección sin "lineas" -> problema listado', () => {
    const result = validateCanonicalContent({ secciones: [{}] });
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes('lineas'))).toBe(true);
  });

  it('línea sin "texto" -> problema listado, no cuenta esa línea', () => {
    const content = { secciones: [{ lineas: [{ texto: '' }, { texto: 'valida' }] }] };
    const result = validateCanonicalContent(content);
    expect(result.ok).toBe(false);
    expect(result.lineCount).toBe(1);
    expect(result.problems.some((p) => p.includes('texto'))).toBe(true);
  });

  it('content null -> problema, sin explotar', () => {
    const result = validateCanonicalContent(null);
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
  });
});

describe('coverageReport', () => {
  it('3 de 5 canciones cubiertas -> 60%, 2 faltantes', () => {
    const { covered, missing, pct } = coverageReport(5, 3);
    expect(covered).toBe(3);
    expect(missing).toBe(2);
    expect(pct).toBe(60);
  });

  it('0 canciones totales no explota (division por cero)', () => {
    const { covered, missing, pct } = coverageReport(0, 0);
    expect(covered).toBe(0);
    expect(missing).toBe(0);
    expect(pct).toBe(0);
  });
});

describe('lineCountMismatch', () => {
  it('cantidades similares -> no flaggea', () => {
    const { flag, ratio } = lineCountMismatch(10, 11);
    expect(flag).toBe(false);
    expect(ratio).toBeCloseTo(1 / 11, 5);
  });

  it('diferencia > 50% -> flaggea', () => {
    const { flag } = lineCountMismatch(4, 10);
    expect(flag).toBe(true);
  });
});

describe('projectSongLines', () => {
  it('salta lineas annotation, mantiene el resto en orden', () => {
    const sections = [
      { lines: [{ text: 'a' }, { text: 'nota', annotation: true }, { text: 'b' }] },
      { lines: [{ text: 'c' }] },
    ];
    expect(projectSongLines(sections)).toEqual(['a', 'b', 'c']);
  });

  it('sections null/vacio -> array vacio', () => {
    expect(projectSongLines(null)).toEqual([]);
    expect(projectSongLines([])).toEqual([]);
  });
});

// ── Flujo del script (mock de postgres) ──────────────────────────────────

const topLevelResponses = [];
function sqlMock(strings) {
  if (!strings?.raw) return strings;
  return Promise.resolve(topLevelResponses.shift() ?? []);
}
sqlMock.end = vi.fn().mockResolvedValue(undefined);
vi.mock('postgres', () => ({ default: () => sqlMock }));

beforeEach(() => {
  topLevelResponses.length = 0;
  sqlMock.end.mockClear();
  process.env.DATABASE_URL = 'postgresql://test';
});

describe('flujo run() (mock de postgres, read-only)', () => {
  it('sin DATABASE_URL falla con mensaje claro y no consulta', async () => {
    delete process.env.DATABASE_URL;
    const { run } = await import('../scripts/verify-cancionero.mjs');
    await expect(run()).rejects.toThrow(/DATABASE_URL/);
  });

  it('detecta fila malformada y devuelve exit code de fallo (process.exit(1))', async () => {
    topLevelResponses.push([{ id: 'song-a', title: 'Cancion A', sections: [] }]); // songs
    topLevelResponses.push([{ song_id: 'song-a', content: { secciones: [] } }]); // canonical, malformada

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    const { run } = await import('../scripts/verify-cancionero.mjs');
    await run();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('cobertura completa y shape valido -> no llama a process.exit', async () => {
    topLevelResponses.push([
      { id: 'song-a', title: 'Cancion A', sections: [{ lines: [{ text: 'x' }] }] },
    ]); // songs
    topLevelResponses.push([
      { song_id: 'song-a', content: { secciones: [{ lineas: [{ texto: 'x' }] }] } },
    ]); // canonical, valida y con la misma cantidad de lineas

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    const { run } = await import('../scripts/verify-cancionero.mjs');
    await run();

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
