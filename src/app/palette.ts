/**
 * One palette for the whole bench, and the stress colour maps.
 * Hex values are sRGB; vertex colours are written in linear space.
 */

export const COLORS = {
  part: 0xdfe6ee,
  partRolled: 0x9db7d6,
  edge: 0x0b1b2b,
  amber: 0xffb020,
  cyan: 0x35d0ff,
  green: 0x3ddc84,
  red: 0xff4d4f,
  violet: 0x9b7bff,
  glass: 0x0c1420,
  ink: 0x0b1220,
  white: 0xffffff,
} as const;

export const CSS = {
  ink: '#0b1220',
  panel: 'rgba(11,18,32,0.92)',
  text: '#f2f6fb',
  dim: '#9fb0c5',
  amber: '#ffb020',
  cyan: '#35d0ff',
  green: '#3ddc84',
  red: '#ff4d4f',
  violet: '#9b7bff',
} as const;

const toLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

function stops(hex: number[]): Float32Array {
  const out = new Float32Array(hex.length * 3);
  hex.forEach((h, i) => {
    out[i * 3] = toLinear(((h >> 16) & 255) / 255);
    out[i * 3 + 1] = toLinear(((h >> 8) & 255) / 255);
    out[i * 3 + 2] = toLinear((h & 255) / 255);
  });
  return out;
}

/** Blue, cyan, green, yellow, red: the conventional stress map. */
const RAINBOW = stops([0x1e3a8a, 0x06b6d4, 0x22c55e, 0xfacc15, 0xef4444]);
/** Dark blue to yellow, readable with any colour vision (after the cividis map). */
const SAFE = stops([0x00224e, 0x35456c, 0x7b7b78, 0xbcae6c, 0xfee838]);

/** Write the colour for stress ratio `t` (0 = unloaded, 1 = at yield) into `out` at `offset`. */
export function stressColor(t: number, safe: boolean, out: Float32Array, offset: number): void {
  const map = safe ? SAFE : RAINBOW;
  const n = map.length / 3 - 1;
  const x = Math.min(1, Math.max(0, t)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  out[offset] = map[i * 3] + (map[i * 3 + 3] - map[i * 3]) * f;
  out[offset + 1] = map[i * 3 + 1] + (map[i * 3 + 4] - map[i * 3 + 1]) * f;
  out[offset + 2] = map[i * 3 + 2] + (map[i * 3 + 5] - map[i * 3 + 2]) * f;
}
