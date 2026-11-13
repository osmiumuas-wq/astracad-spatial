/**
 * Files the user takes away: a binary STL for the printer, and a JSON record
 * that carries the Part Language program, its parameters and the evidence of
 * the truth gate, so the same part can be rebuilt and re-checked on desktop
 * AstraCAD.
 */

import { Params } from './jobs.js';
import { GateResult } from './truth.js';
import { KernelProps, PartSpec } from './types.js';

export const APP_NAME = 'AstraCAD Spatial';
export const APP_VERSION = '0.1.0';

/** Binary STL, millimetres. `label` goes into the 80-byte header. */
export function toBinaryStl(
  positions: Float32Array,
  indices: Uint32Array,
  label: string,
): Uint8Array {
  const count = indices.length / 3;
  const bytes = new Uint8Array(84 + count * 50);
  const view = new DataView(bytes.buffer);
  const header = `${APP_NAME} ${APP_VERSION} | ${label} | units mm`.slice(0, 80);
  for (let i = 0; i < header.length; i++) {
    bytes[i] = header.charCodeAt(i) & 0x7f;
  }
  view.setUint32(80, count, true);
  let o = 84;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    view.setFloat32(o, nx, true);
    view.setFloat32(o + 4, ny, true);
    view.setFloat32(o + 8, nz, true);
    o += 12;
    for (const v of [a, b, c]) {
      view.setFloat32(o, positions[v], true);
      view.setFloat32(o + 4, positions[v + 1], true);
      view.setFloat32(o + 8, positions[v + 2], true);
      o += 12;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return bytes;
}

/** Signed volume of a binary STL, for checking an export against the kernel. */
export function stlVolume(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  let v6 = 0;
  for (let t = 0; t < count; t++) {
    const o = 84 + t * 50 + 12;
    const p: number[] = [];
    for (let i = 0; i < 9; i++) {
      p.push(view.getFloat32(o + i * 4, true));
    }
    v6 +=
      p[0] * (p[4] * p[8] - p[5] * p[7]) +
      p[1] * (p[5] * p[6] - p[3] * p[8]) +
      p[2] * (p[3] * p[7] - p[4] * p[6]);
  }
  return v6 / 6;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface PartRecord {
  format: 'astracad.spatial.part.v1';
  app: string;
  created: string;
  job: string;
  material: string;
  parameters: Params;
  /** Real-world measurements the parameters were bound to, if any. */
  measurements: MeasurementRecord[];
  spec: PartSpec;
  /** SHA-256 of the canonical JSON of `spec`. */
  specSha256: string;
  kernel: KernelProps;
  truthGate: GateResult;
}

export interface MeasurementRecord {
  parameter: string;
  /** Measured value before the fit allowance, mm. */
  measured: number;
  /** Spread of the samples the reading was averaged from, mm. */
  spread: number;
  method: 'span' | 'tape';
  fit: number;
}

export async function buildRecord(input: {
  job: string;
  material: string;
  parameters: Params;
  measurements: MeasurementRecord[];
  spec: PartSpec;
  kernel: KernelProps;
  truthGate: GateResult;
  created?: Date;
}): Promise<PartRecord> {
  return {
    format: 'astracad.spatial.part.v1',
    app: `${APP_NAME} ${APP_VERSION}`,
    created: (input.created ?? new Date()).toISOString(),
    job: input.job,
    material: input.material,
    parameters: input.parameters,
    measurements: input.measurements,
    spec: input.spec,
    specSha256: await sha256Hex(JSON.stringify(input.spec)),
    kernel: input.kernel,
    truthGate: input.truthGate,
  };
}
