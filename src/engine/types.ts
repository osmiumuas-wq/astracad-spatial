/**
 * Shared engine types. Nothing in src/engine imports IWSDK, Three.js or the
 * DOM, so the same code runs in the Web Worker and in the Node test runner.
 *
 * Units everywhere: millimetres, newtons, megapascals, degrees.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** Part Language v2 sketch segment: line, arc (centre, start, end, direction) or full circle. */
export type LineSeg = ['L', number, number, number, number];
export type ArcSeg = ['A', number, number, number, number, number, number, 1 | -1];
export type CircleSeg = ['C', number, number, number];
export type Seg = LineSeg | ArcSeg | CircleSeg;

/** One Part Language operation, in the same JSON shape desktop AstraCAD reads. */
export interface Feature {
  $op: string;
  id: string;
  sketched_on?: string;
  args: Record<string, unknown>;
}

export interface PartSpec {
  language: 2;
  name: string;
  units: 'mm';
  features: Feature[];
  notes?: Record<string, string>;
}

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

/** Triangle mesh in part coordinates (mm). */
export interface MeshData {
  /** xyz per vertex. Vertices are split along sharp edges so normals shade correctly. */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Line segments (xyz pairs) along sharp edges, for the drafted outline. */
  edges: Float32Array;
}

export interface KernelProps {
  volume: number;
  surfaceArea: number;
  bbox: Box3;
  genus: number;
  triangles: number;
  /** Volume and area integrated again by our own code from the output triangles. */
  volumeCheck: number;
  areaCheck: number;
  status: string;
  components: number;
}

export interface BuildOutput {
  mesh: MeshData;
  props: KernelProps;
  /** Feature ids that were applied, in order (a rollback applies a prefix). */
  applied: string[];
  ms: number;
}

export class SpecError extends Error {
  constructor(
    message: string,
    public readonly featureId?: string,
  ) {
    super(featureId ? `${featureId}: ${message}` : message);
    this.name = 'SpecError';
  }
}

export interface Material {
  id: string;
  name: string;
  /** Young's modulus, MPa. */
  E: number;
  nu: number;
  /** Yield (or, for printed polymers, tensile strength at yield), MPa. */
  yield: number;
  /** Density, g/cm3. */
  density: number;
  /** Indicative material price, USD per kg. Shown as an estimate, never as a quote. */
  usdPerKg: number;
  process: 'fdm' | 'cnc';
  note: string;
}
