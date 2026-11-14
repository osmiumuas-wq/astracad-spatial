/**
 * Messages between the page and the engine workers. All heavy work (kernel
 * builds, stress solves, topology optimisation) runs off the render thread;
 * typed arrays cross as transferables.
 */

import { ReinforceStep, StressSummary } from './agents.js';
import { MeasurementRecord, PartRecord } from './exporters.js';
import { LoadRegion } from './fea.js';
import { Wind } from './flow.js';
import type { DrawingViews } from './kernel.js';
import { Params } from './jobs.js';
import { GateResult } from './truth.js';
import { KernelProps, MeshData, Vec3 } from './types.js';

export interface LoadSpec {
  region: LoadRegion;
  dir: Vec3;
  newtons: number;
  surfaceOnly?: boolean;
  label: string;
}

export type Request =
  | { id: number; type: 'build'; job: string; params: Params; upTo?: number }
  | { id: number; type: 'slice'; job: string; params: Params }
  | { id: number; type: 'flow'; job: string; params: Params; wind: Wind }
  | { id: number; type: 'modes'; job: string; params: Params; material: string }
  | { id: number; type: 'views'; job: string; params: Params }
  | {
      id: number;
      type: 'solve';
      job: string;
      params: Params;
      material: string;
      load?: LoadSpec;
      target?: number;
      /** Solve on the grown (topology-optimised) shape instead of the parametric one. */
      grown?: boolean;
    }
  | { id: number; type: 'reinforce'; job: string; params: Params; material: string; loadN: number; load?: LoadSpec }
  | { id: number; type: 'grow'; job: string; params: Params; material: string; keep: number; load?: LoadSpec }
  | { id: number; type: 'lattice'; job: string; params: Params }
  | {
      id: number;
      type: 'export';
      job: string;
      params: Params;
      material: string;
      measurements: MeasurementRecord[];
      grownMesh?: { positions: Float32Array; indices: Uint32Array };
    };

export interface FeatureInfo {
  id: string;
  op: string;
}

export interface SolveOutcome extends StressSummary {
  vertexDisp: Float32Array;
  vertexStress: Float32Array;
  loadLabel: string;
  fixtureLabel: string;
  iterations: number;
  converged: boolean;
  ms: number;
}

export type Response =
  | { id: number; type: 'ready' }
  | {
      id: number;
      type: 'built';
      mesh: MeshData;
      props: KernelProps;
      gate: GateResult;
      /** Every feature of the program, for the history rail. */
      features: FeatureInfo[];
      applied: number;
      ms: number;
    }
  | { id: number; type: 'progress'; iteration: number; residual: number }
  | { id: number; type: 'solved'; outcome: SolveOutcome }
  | { id: number; type: 'reinforce-step'; step: ReinforceStep }
  | { id: number; type: 'reinforced'; steps: ReinforceStep[]; reached: boolean }
  | { id: number; type: 'grow-frame'; iteration: number; of: number; mesh: MeshData; props: KernelProps }
  | {
      id: number;
      type: 'grown';
      mesh: MeshData;
      props: KernelProps;
      /** Stress re-solved on the grown shape: the proof that it still holds. */
      outcome: SolveOutcome;
      kept: number;
      iterations: number;
      ms: number;
    }
  | { id: number; type: 'exported'; stl: Uint8Array; record: PartRecord; name: string }
  | { id: number; type: 'latticed'; mesh: MeshData; props: KernelProps; before: number; cell: number; wall: number; skin: number; ms: number }
  | { id: number; type: 'sliced'; segments: Float32Array; starts: Uint32Array; height: number; printLayers: number; layerHeight: number; up: Vec3; upLabel: string; minutes: number }
  | { id: number; type: 'flowed'; points: Float32Array; speeds: Float32Array; starts: Uint32Array; h: number; cells: number; iterations: number; ms: number; wind: Wind }
  | { id: number; type: 'moded'; frequencies: number[]; shapes: Float32Array[]; cell: number; elements: number; ms: number; fixtureLabel: string }
  | { id: number; type: 'mode-progress'; mode: number; iteration: number }
  | { id: number; type: 'viewed'; views: DrawingViews }
  | { id: number; type: 'error'; message: string; featureId?: string };
