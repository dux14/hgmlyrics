import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const stylesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles');

/** Quita comentarios /* ... *​/ para no contar ejemplos escritos en prosa. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Devuelve las custom properties que se referencian a sí mismas
 * (`--x: var(--x)`). En CSS esto produce un ciclo guaranteed-invalid:
 * la variable resuelve a vacío y todo consumidor de `var(--x)` colapsa.
 */
function selfReferences(css) {
  const out = [];
  const decl = /(--[\w-]+)\s*:\s*([^;{}]+)/g;
  let m;
  while ((m = decl.exec(css)) !== null) {
    const name = m[1];
    const value = m[2];
    const ref = new RegExp(`var\\(\\s*${name}\\s*[,)]`);
    if (ref.test(value)) out.push(`${name}: ${value.trim()}`);
  }
  return out;
}

describe('tokens CSS — sin custom properties auto-referenciales', () => {
  const files = readdirSync(stylesDir).filter((f) => f.endsWith('.css'));

  for (const file of files) {
    it(`${file} no declara ninguna variable que se referencie a sí misma`, () => {
      const css = stripComments(readFileSync(join(stylesDir, file), 'utf8'));
      expect(selfReferences(css)).toEqual([]);
    });
  }
});
