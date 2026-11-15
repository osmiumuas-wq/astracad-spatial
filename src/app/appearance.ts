/**
 * Appearances for the part: metals, anodised and painted colours, plastics,
 * rubber, glass, carbon fibre and wood, each a material look and, for the
 * textured ones, a procedural texture (no image files). Box-projected onto the
 * part, so they follow its faces.
 */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from '@iwsdk/core';

export interface Appearance {
  name: string;
  color: number;
  metalness: number;
  roughness: number;
  opacity?: number;
  texture?: 'brushed' | 'carbon' | 'wood' | 'knurl';
}

const COLOURS: Record<string, number> = {
  red: 0xc0392b, blue: 0x2f6fd6, green: 0x2e9d5b, black: 0x1d1f22, white: 0xf2f2f2, orange: 0xe67e22, yellow: 0xf1c40f,
  purple: 0x8e44ad, grey: 0x8c939b, gray: 0x8c939b, silver: 0xc9cdd2, gold: 0xd4af37, teal: 0x1abc9c, pink: 0xe84393,
};

/** The appearance named in words, or null. */
export function appearanceOf(t: string): Appearance | null {
  const colour = Object.keys(COLOURS).find((c) => new RegExp(`\\b${c}\\b`, 'u').test(t));
  const c = colour ? COLOURS[colour] : undefined;
  if (/\bbrushed\b/u.test(t)) return { name: 'brushed aluminium', color: c ?? 0xd0d4d8, metalness: 0.9, roughness: 0.38, texture: 'brushed' };
  if (/\banodi[sz]ed\b/u.test(t)) return { name: `anodised ${colour ?? 'silver'}`, color: c ?? 0xc9cdd2, metalness: 0.65, roughness: 0.32, texture: 'brushed' };
  if (/\b(chrome|polished|mirror)\b/u.test(t)) return { name: 'polished chrome', color: 0xf4f4f4, metalness: 1, roughness: 0.05 };
  if (/\bstainless\b|\bsteel\b/u.test(t)) return { name: 'stainless steel', color: 0xaab0b6, metalness: 1, roughness: 0.28, texture: 'brushed' };
  if (/\bbrass\b/u.test(t)) return { name: 'brass', color: 0xcfa64b, metalness: 1, roughness: 0.25 };
  if (/\bcopper\b/u.test(t)) return { name: 'copper', color: 0xc4774a, metalness: 1, roughness: 0.28 };
  if (/\bgold\b/u.test(t) && /\b(metal|plated|gold finish)\b/u.test(t)) return { name: 'gold', color: 0xd4af37, metalness: 1, roughness: 0.2 };
  if (/\bcarbon\b/u.test(t)) return { name: 'carbon fibre', color: 0xffffff, metalness: 0.35, roughness: 0.3, texture: 'carbon' };
  if (/\bwood|oak|walnut\b/u.test(t)) return { name: /walnut/u.test(t) ? 'walnut' : 'oak', color: /walnut/u.test(t) ? 0x8a5a3b : 0xd9b48a, metalness: 0, roughness: 0.75, texture: 'wood' };
  if (/\brubber\b/u.test(t)) return { name: 'rubber', color: 0x26282b, metalness: 0, roughness: 1 };
  if (/\bglass|clear|transparent\b/u.test(t)) return { name: 'clear', color: 0xcfeaff, metalness: 0, roughness: 0.05, opacity: 0.4 };
  if (/\bmatte?\b/u.test(t)) return { name: `matte ${colour ?? 'black'}`, color: c ?? 0x1d1f22, metalness: 0, roughness: 0.92 };
  if (/\b(gloss|glossy|painted|paint|plastic)\b/u.test(t)) return { name: `gloss ${colour ?? 'white'}`, color: c ?? 0xf2f2f2, metalness: 0, roughness: 0.22 };
  if (colour) return { name: colour, color: c!, metalness: 0.1, roughness: 0.45 };
  return null;
}

const cache = new Map<string, CanvasTexture>();

/** A procedural texture (512 px, repeating). */
export function textureFor(kind: NonNullable<Appearance['texture']>): CanvasTexture | null {
  const got = cache.get(kind);
  if (got) return got;
  if (typeof document === 'undefined') return null;
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d')!;
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (kind === 'brushed') {
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const y = rnd() * S;
      const v = 190 + Math.floor(rnd() * 60);
      g.strokeStyle = `rgba(${v},${v},${v},0.35)`;
      g.lineWidth = 0.6 + rnd();
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(S, y + (rnd() - 0.5) * 2);
      g.stroke();
    }
  } else if (kind === 'carbon') {
    // A 2 x 2 twill: tows alternating over and under.
    const n = 16;
    const w = S / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const along = (Math.floor(i / 2) + Math.floor(j / 2)) % 2 === 0;
        const grad = along ? g.createLinearGradient(i * w, 0, (i + 1) * w, 0) : g.createLinearGradient(0, j * w, 0, (j + 1) * w);
        grad.addColorStop(0, '#111');
        grad.addColorStop(0.5, '#3a3d42');
        grad.addColorStop(1, '#111');
        g.fillStyle = grad;
        g.fillRect(i * w, j * w, w, w);
      }
    }
  } else if (kind === 'wood') {
    for (let y = 0; y < S; y++) {
      const ring = Math.sin((y / S) * 40 + Math.sin(y / 23) * 1.5) * 0.5 + 0.5;
      const v = 0.75 + 0.25 * ring;
      g.fillStyle = `rgb(${Math.round(225 * v)},${Math.round(190 * v)},${Math.round(140 * v)})`;
      g.fillRect(0, y, S, 1);
    }
    for (let i = 0; i < 300; i++) {
      g.fillStyle = 'rgba(90,60,30,0.08)';
      g.fillRect(rnd() * S, rnd() * S, 40 + rnd() * 120, 1);
    }
  } else {
    g.fillStyle = '#bbb';
    g.fillRect(0, 0, S, S);
    g.strokeStyle = '#555';
    for (let k = -S; k < 2 * S; k += 12) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + S, S);
      g.moveTo(k + S, 0);
      g.lineTo(k, S);
      g.stroke();
    }
  }
  const tex = new CanvasTexture(cv);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  cache.set(kind, tex);
  return tex;
}

/** Box-projected texture coordinates (one repeat every 40 mm), from positions and normals. */
export function boxUv(positions: ArrayLike<number>, normals: ArrayLike<number>): Float32Array {
  const uv = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    const ax = Math.abs(normals[i]);
    const ay = Math.abs(normals[i + 1]);
    const az = Math.abs(normals[i + 2]);
    const [u, v] = ax >= ay && ax >= az ? [positions[i + 2], positions[i + 1]] : ay >= az ? [positions[i], positions[i + 2]] : [positions[i], positions[i + 1]];
    uv[j] = u / 40;
    uv[j + 1] = v / 40;
  }
  return uv;
}
