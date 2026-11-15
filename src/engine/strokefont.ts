/**
 * A stroke font for engraving and embossing: capitals, digits and a few marks
 * as polylines on a 4 x 6 grid (6 units an advance). Each stroke becomes a
 * bar of the pen's width with square ends, so text is real geometry that cuts
 * into or stands out of a face and exports with the part.
 */

type Poly = [number, number][];

const O: Poly = [[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]];
const P: Poly = [[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]];

export const GLYPHS: Record<string, Poly[]> = {
  A: [[[0, 0], [0, 4], [2, 6], [4, 4], [4, 0]], [[0, 3], [4, 3]]],
  B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
  C: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]],
  D: [[[0, 0], [0, 6], [2, 6], [4, 4], [4, 2], [2, 0], [0, 0]]],
  E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
  F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
  G: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[1, 6], [3, 6]], [[2, 6], [2, 0]], [[1, 0], [3, 0]]],
  J: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
  K: [[[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1, 3], [4, 0]]],
  L: [[[0, 6], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]],
  N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
  O: [O],
  P: [P],
  Q: [O, [[2, 2], [4, 0]]],
  R: [P, [[2, 3], [4, 0]]],
  S: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  U: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]],
  V: [[[0, 6], [2, 0], [4, 6]]],
  W: [[[0, 6], [1, 0], [2, 3], [3, 0], [4, 6]]],
  X: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]],
  Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
  Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
  '0': [O, [[0, 1], [4, 5]]],
  '1': [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]],
  '2': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]],
  '3': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  '4': [[[3, 0], [3, 6], [0, 2], [4, 2]]],
  '5': [[[4, 6], [0, 6], [0, 3], [3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
  '6': [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]],
  '7': [[[0, 6], [4, 6], [1, 0]]],
  '8': [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
  '9': [[[4, 3], [1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
  '-': [[[1, 3], [3, 3]]],
  '+': [[[1, 3], [3, 3]], [[2, 2], [2, 4]]],
  '.': [[[1.7, 0], [2.3, 0]]],
  '/': [[[0, 0], [4, 6]]],
  ':': [[[1.7, 1], [2.3, 1]], [[1.7, 5], [2.3, 5]]],
};

/** Bars (as rectangles, anticlockwise) for the text, `height` mm tall, centred on (0, 0). */
export function textBars(text: string, height: number, pen = 0.9): [number, number][][] {
  const s = height / 6;
  const chars = [...text.toUpperCase()];
  const width = (chars.length * 6 - 2) * s;
  const out: [number, number][][] = [];
  const w = (pen * s) / 2;
  chars.forEach((ch, k) => {
    for (const poly of GLYPHS[ch] ?? []) {
      for (let i = 0; i + 1 < poly.length; i++) {
        const ax = (poly[i][0] + 6 * k) * s - width / 2;
        const ay = poly[i][1] * s - height / 2;
        const bx = (poly[i + 1][0] + 6 * k) * s - width / 2;
        const by = poly[i + 1][1] * s - height / 2;
        const L = Math.hypot(bx - ax, by - ay) || 1;
        const ux = ((bx - ax) / L) * w;
        const uy = ((by - ay) / L) * w;
        // Square ends past each point, so strokes meeting at a corner overlap.
        out.push([[ax - ux + uy, ay - uy - ux], [bx + ux + uy, by + uy - ux], [bx + ux - uy, by + uy + ux], [ax - ux - uy, ay - uy + ux]]);
      }
    }
  });
  return out;
}

/** Characters the font draws (others are left as spaces). */
export const FONT_CHARS = Object.keys(GLYPHS).join('');
