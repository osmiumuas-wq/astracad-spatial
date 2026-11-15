import { describe, expect, it } from 'vitest';
import { addFeature, featureDefs, OPS } from '../src/engine/design.js';
import { applyEquations, evalExpr, spokenToExpr } from '../src/engine/equations.js';

describe('equations and variables', () => {
  it('evaluates expressions safely: precedence, brackets, powers, functions in degrees', () => {
    const v = { width: 60, t: 2 };
    expect(evalExpr('width / 3 + 2', v)).toBeCloseTo(22, 12);
    expect(evalExpr('(width - 2*t) ^ 2', v)).toBeCloseTo(56 * 56, 9);
    expect(evalExpr('sqrt(width*width + 80^2)', v)).toBeCloseTo(100, 9);
    expect(evalExpr('2 * sin 30 * width', v)).toBeCloseTo(60, 9);
    expect(evalExpr('max(t, 5) - -1', v)).toBe(6);
    expect(() => evalExpr('width + depth', v)).toThrow(/no variable "depth"/);
    expect(() => evalExpr('alert(1)', v)).toThrow();
    expect(() => evalExpr('width;', v)).toThrow(/cannot read/);
  });

  it('reads spoken arithmetic', () => {
    expect(spokenToExpr('width divided by 3 plus 2')).toBe('width / 3 + 2');
    expect(spokenToExpr('half of length minus 4')).toBe('0.5 * length - 4');
  });

  it('drives feature dimensions from variables, in order', () => {
    let p = addFeature({ nf: 0 }, OPS.BOX, { a: 60, b: 40, c: 10 });
    p = addFeature(p, OPS.CYL, { a: 10, c: 20 });
    const box = featureDefs(p, 0);
    const cyl = featureDefs(p, 1);
    const width = box.find((d) => d.label === 'Width')!.id;
    const height = box.find((d) => d.label === 'Height')!.id;
    const dia = cyl.find((d) => d.label === 'Diameter')!.id;
    const eq = {
      globals: { length: 120 },
      rules: [
        { target: width, expr: 'length', label: 'feature 1 width' },
        { target: height, expr: 'length / 12', label: 'feature 1 height' },
        { target: dia, expr: 'length / 8', label: 'feature 2 diameter' },
      ],
    };
    const r = applyEquations(p, eq);
    expect(r.params[width]).toBe(120);
    expect(r.params[height]).toBe(10);
    expect(r.params[dia]).toBe(15);
    expect(r.changed).toEqual(['feature 1 width', 'feature 2 diameter']);
    expect(r.errors).toEqual([]);
  });
});
