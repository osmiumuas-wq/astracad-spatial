/**
 * Equations and global variables, as in SOLIDWORKS' Equations or CATIA's
 * formulas: named variables ("width = 60") and rules that drive a feature's
 * dimension from them ("feature 2 height = width / 3"). Expressions take
 * numbers, variables, + - * / ^, brackets, pi and sqrt, sin, cos, tan (in
 * degrees), abs, round, min, max. They are parsed here (no eval).
 */

import type { Params } from './jobs.js';

export interface EquationSet {
  globals: Record<string, number>;
  /** Each rule sets a parameter (by key) to an expression; `label` is how it was named. */
  rules: { target: string; expr: string; label: string }[];
}

export const emptyEquations = (): EquationSet => ({ globals: {}, rules: [] });

/** Spoken arithmetic to symbols: "width divided by 3 plus 2" to "width / 3 + 2". */
export function spokenToExpr(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bdivided by\b|\bover\b/gu, '/')
    .replace(/\b(times|multiplied by)\b/gu, '*')
    .replace(/\bplus\b/gu, '+')
    .replace(/\bminus\b/gu, '-')
    .replace(/\b(to the power of|squared)\b/gu, (m) => (m === 'squared' ? '^2' : '^'))
    .replace(/\bhalf of\b/gu, '0.5 *')
    .replace(/\bsquare root of\b/gu, 'sqrt ')
    .trim();
}

/** Evaluate an expression with the variables given. Throws, naming the problem, on anything else. */
export function evalExpr(src: string, vars: Record<string, number>): number {
  const toks = src.match(/\d*\.?\d+(?:e[-+]?\d+)?|[a-z_][a-z0-9_]*|[-+*/^(),]/giu);
  if (!toks || toks.join('').replace(/\s/gu, '') !== src.replace(/\s/gu, '')) throw new Error(`cannot read "${src}"`);
  let i = 0;
  const peek = (): string | undefined => toks[i];
  const take = (t?: string): string => {
    const x = toks[i++];
    if (t !== undefined && x !== t) throw new Error(`expected "${t}" in "${src}"`);
    if (x === undefined) throw new Error(`"${src}" ends too soon`);
    return x;
  };
  const DEG = Math.PI / 180;
  const FN: Record<string, (...a: number[]) => number> = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    round: Math.round,
    min: Math.min,
    max: Math.max,
    sin: (x) => Math.sin(x * DEG),
    cos: (x) => Math.cos(x * DEG),
    tan: (x) => Math.tan(x * DEG),
  };
  const primary = (): number => {
    const t = take();
    if (t === '(') {
      const v = sum();
      take(')');
      return v;
    }
    if (t === '-') return -factor();
    if (t === '+') return factor();
    if (/^\d|^\./u.test(t)) return parseFloat(t);
    const name = t.toLowerCase();
    if (name === 'pi') return Math.PI;
    if (FN[name]) {
      // A function: brackets, or one bare argument ("sqrt 2").
      if (peek() === '(') {
        take('(');
        const args = [sum()];
        while (peek() === ',') {
          take(',');
          args.push(sum());
        }
        take(')');
        return FN[name](...args);
      }
      return FN[name](factor());
    }
    if (name in vars) return vars[name];
    throw new Error(`there is no variable "${t}"`);
  };
  const factor = (): number => {
    const base = primary();
    if (peek() === '^') {
      take('^');
      return base ** factor();
    }
    return base;
  };
  const product = (): number => {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = take();
      const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === '+' || peek() === '-') {
      const op = take();
      const r = product();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  if (i !== toks.length) throw new Error(`unexpected "${toks[i]}" in "${src}"`);
  if (!Number.isFinite(v)) throw new Error(`"${src}" is not a finite number`);
  return v;
}

/** The parameters with every rule applied (in order, twice, so a rule may use what an earlier one set). */
export function applyEquations(p: Params, eq: EquationSet): { params: Params; changed: string[]; errors: string[] } {
  const out: Params = { ...p };
  const changed = new Set<string>();
  const errors: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const r of eq.rules) {
      try {
        const v = evalExpr(r.expr, eq.globals);
        if (Math.abs((out[r.target] ?? NaN) - v) > 1e-12 || !(r.target in out)) {
          out[r.target] = v;
          changed.add(r.label);
        }
      } catch (e) {
        if (pass === 1) errors.push(`${r.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return { params: out, changed: [...changed], errors };
}
