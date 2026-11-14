/**
 * Application state and actions. Systems read the signals and call the
 * actions; nothing here touches Three.js, so the same controller drives the
 * immersive bench and the flat page.
 */

import { batch, Signal, signal } from '@iwsdk/core';
import { Finding, runAgents, safetyFactor, StressSummary } from '../engine/agents.js';
import { MeasurementRecord } from '../engine/exporters.js';
import { defaultParams, Job, jobById, JOBS, paramDef, Params } from '../engine/jobs.js';
import { materialById } from '../engine/materials.js';
import { FeatureInfo, LoadSpec, Response, SolveOutcome } from '../engine/protocol.js';
import { decodeShare, encodeShare } from '../engine/share.js';
import { GateResult } from '../engine/truth.js';
import { KernelProps, Material, MeshData, Vec3 } from '../engine/types.js';
import { CancelledError, EngineClient } from './engine-client.js';
import {
  bumpStreak,
  loadCalibration,
  loadLibrary,
  saveCalibration,
  loadProgress,
  loadSettings,
  loadThings,
  Progress,
  SavedPart,
  saveLibrary,
  saveProgress,
  saveSettings,
  saveThings,
  Settings,
  Skill,
  Thing,
  today,
  uid,
} from './persistence.js';
import { dailyBrief, dailyMet } from '../engine/daily.js';
import { calibrate, CALIBRATION_READINGS, CARD_MM, correct } from '../engine/calibration.js';
import { recognise, type ImportedMesh } from '../engine/step-import.js';
import { History } from './history.js';
import { drawingSvg } from '../engine/drawing.js';
import { answer, blockParams, Described, describe } from '../engine/describe.js';
import { Action, deicticEdit, HELP, parseCommand, wordsToDigits } from '../engine/commands.js';
import { probe } from './context.js';
import { Understander } from './understand.js';

export interface BuiltState {
  mesh: MeshData;
  props: KernelProps;
  gate: GateResult;
  features: FeatureInfo[];
  applied: number;
  ms: number;
}

export interface StressState extends SolveOutcome {
  /** True when the load came from a palm push rather than the job's standard case. */
  custom: boolean;
  /** Parameters the solve belongs to; a different part invalidates it. */
  key: string;
  onGrown: boolean;
}

export interface Measurement {
  value: number;
  spread: number;
  method: 'span' | 'tape' | 'laser';
  samples: number;
  /** Two-sigma uncertainty from the user's calibration, mm, when calibrated. */
  uncertainty?: number;
}

export interface Busy {
  kind: 'solve' | 'reinforce' | 'grow' | 'export';
  label: string;
  /** 0 to 1, or -1 when unknown. */
  progress: number;
}

export interface Notice {
  text: string;
  tone: 'good' | 'info' | 'warn' | 'bad';
  id: number;
}

export interface GrownState {
  mesh: MeshData;
  props: KernelProps;
  kept: number;
  final: boolean;
  iteration: number;
  of: number;
}

export type Mode = 'shape' | 'measure' | 'test' | 'sketch' | 'capture';

export class App {
  readonly engine = new EngineClient();

  readonly jobId = signal(JOBS[0].id);
  readonly params: Signal<Params> = signal(defaultParams(JOBS[0]));
  readonly material = signal('pla');
  readonly selected: Signal<string | null> = signal(null);
  readonly mode: Signal<Mode> = signal('shape');
  readonly built: Signal<BuiltState | null> = signal(null);
  /** Why the last change could not be built, or null. */
  readonly refusal: Signal<string | null> = signal(null);
  /** Number of features shown by the history rail; null shows the whole part. */
  readonly rollback: Signal<number | null> = signal(null);
  readonly stress: Signal<StressState | null> = signal(null);
  /** The load the part is being judged at, N. */
  readonly loadN = signal(JOBS[0].loadCase(defaultParams(JOBS[0])).newtons);
  readonly findings: Signal<Finding[]> = signal([]);
  readonly busy: Signal<Busy | null> = signal(null);
  readonly measurement: Signal<Measurement | null> = signal(null);
  readonly bound: Signal<MeasurementRecord[]> = signal([]);
  /** World point the last measurement of a full set was taken at (starts the extract flight). */
  readonly extractFrom: Signal<[number, number, number] | null> = signal(null);
  readonly grown: Signal<GrownState | null> = signal(null);
  /** Show a lattice core cut open (src/systems/cutaway-system.ts). */
  readonly cutaway = signal(false);
  /** The knife-hand slice is open (it owns the clip plane meanwhile). */
  slicing = false;
  readonly agentLog: Signal<string[]> = signal([]);
  readonly notice: Signal<Notice | null> = signal(null);
  readonly fatal: Signal<string | null> = signal(null);
  readonly settings: Signal<Settings> = signal(loadSettings());
  readonly progress: Signal<Progress> = signal(loadProgress());
  readonly library: Signal<SavedPart[]> = signal(loadLibrary());
  readonly things: Signal<Thing[]> = signal(loadThings());
  /** True while a handle or dial is being moved. */
  readonly dragging = signal(false);
  /** A STEP model brought in from desktop CAD, shown seated in a cradle fitted round it. */
  readonly reference: Signal<ImportedMesh | null> = signal(null);
  /** Per-method calibration against a bank card, if done. */
  readonly calibration = signal(loadCalibration());
  /** Readings so far while calibrating, or null. */
  readonly calibrating: Signal<{ readings: number[] } | null> = signal(null);
  /** Measure mode is using the laser tape (hit tests on the real room) instead of fingers. */
  readonly laser = signal(false);
  /** Bumped when a system's coach prompt changes (capture steps). */
  readonly coachTick = signal(0);
  /** Notes from the last clamp (why a value was limited). */
  readonly clampNotes: Signal<string[]> = signal([]);

  private noticeId = 0;
  private retestAfterBuild = false;
  /** Undo and redo of the part (job, dimensions, material). */
  readonly history: History;

  constructor() {
    this.engine.onBuilt = (b) => this.onBuilt(b);
    this.engine.onBuildError = (message) => {
      this.refusal.value = message;
    };
    this.engine.onFatal = (message) => {
      this.fatal.value = message;
    };
    this.engine.onRecovered = (what) => {
      this.say(
        what === 'build'
          ? 'The geometry engine stopped and was restarted. Your part is being rebuilt.'
          : 'The analysis stopped and was restarted. Run it again when ready.',
        'warn',
      );
      if (what === 'analysis') this.busy.value = null;
    };
    const shared = decodeShare(globalThis.location?.hash ?? '');
    if (shared) {
      this.jobId.value = shared.job.id;
      this.params.value = shared.params;
      this.material.value = shared.material;
      this.loadN.value = shared.job.loadCase(shared.params).newtons;
    }
    this.history = new History(this);
    this.requestBuild();
  }

  undo(): void {
    if (this.history.undo()) this.say('Undone.', 'info');
  }

  redo(): void {
    if (this.history.redo()) this.say('Redone.', 'info');
  }

  get job(): Job {
    return jobById(this.jobId.peek());
  }

  get materialData(): Material {
    return materialById(this.material.peek());
  }

  private key(): string {
    return `${this.jobId.peek()}|${JSON.stringify(this.params.peek())}`;
  }

  say(text: string, tone: Notice['tone'] = 'info'): void {
    this.notice.value = { text, tone, id: ++this.noticeId };
  }

  private requestBuild(): void {
    this.engine.requestBuild(this.jobId.peek(), this.params.peek(), this.rollback.peek() ?? undefined);
  }

  private onBuilt(b: Extract<Response, { type: 'built' }>): void {
    this.refusal.value = null;
    this.built.value = {
      mesh: b.mesh,
      props: b.props,
      gate: b.gate,
      features: b.features,
      applied: b.applied,
      ms: b.ms,
    };
    this.refreshFindings();
    if (this.retestAfterBuild && !this.dragging.peek()) {
      this.retestAfterBuild = false;
      void this.runTest();
    }
  }

  // ----- shape ---------------------------------------------------------------

  /** Change parameters. Clamps them, invalidates analysis results and rebuilds. */
  setParams(changes: Params): void {
    const job = this.job;
    const { params, notes } = job.clamp({ ...this.params.peek(), ...changes });
    this.clampNotes.value = notes;
    const before = this.params.peek();
    // Compare every key: some parts (the air sketch) carry geometry beyond their named dimensions.
    const keys = new Set([...Object.keys(params), ...Object.keys(before)]);
    if ([...keys].every((k) => Math.abs((params[k] ?? NaN) - (before[k] ?? NaN)) < 1e-9)) {
      return;
    }
    this.params.value = params;
    this.invalidateAnalysis();
    this.requestBuild();
  }

  setParam(id: string, value: number): void {
    this.setParams({ [id]: value });
  }

  /** Step a parameter by a number of dial detents (fine steps). */
  nudge(id: string, detents: number, coarse = false): void {
    const def = paramDef(this.job, id);
    if (!def) {
      return;
    }
    const step = coarse ? def.step : def.fine;
    this.setParam(id, this.params.peek()[id] + detents * step);
  }

  private invalidateAnalysis(): void {
    if (this.engine.analysing) {
      this.engine.cancelAnalysis();
      this.busy.value = null;
    }
    if (this.stress.peek()) {
      this.stress.value = null;
    }
    if (this.grown.peek()) {
      this.grown.value = null;
    }
  }

  selectJob(id: string): void {
    const job = jobById(id);
    this.invalidateAnalysis();
    // One batch: observers must never see the new job with the old parameters.
    batch(() => {
      this.jobId.value = job.id;
      this.params.value = defaultParams(job);
      this.selected.value = null;
      this.rollback.value = null;
      this.bound.value = [];
      this.agentLog.value = [];
      this.loadN.value = job.loadCase(this.params.peek()).newtons;
    });
    this.requestBuild();
  }

  setMaterial(id: string): void {
    if (id === this.material.peek()) {
      return;
    }
    const hadStress = this.stress.peek() !== null;
    this.invalidateAnalysis();
    this.material.value = materialById(id).id;
    this.refreshFindings();
    if (hadStress) {
      void this.runTest();
    }
  }

  /** Show the part as it was after `count` features (null = finished part). */
  setRollback(count: number | null): void {
    const total = this.built.peek()?.features.length ?? 0;
    const next = count === null || count >= total ? null : Math.max(1, count);
    if (next === this.rollback.peek()) {
      return;
    }
    this.rollback.value = next;
    this.requestBuild();
    if (next !== null) {
      this.award('history');
    }
  }

  // ----- analysis ------------------------------------------------------------

  refreshFindings(): void {
    const built = this.built.peek();
    if (!built || this.rollback.peek() !== null) {
      return;
    }
    const stress = this.stress.peek();
    const live = stress && stress.key === this.key() ? stress : null;
    const grown = this.grown.peek();
    this.findings.value = runAgents({
      job: this.job,
      params: this.params.peek(),
      props: grown?.final ? grown.props : built.props,
      material: this.materialData,
      loadN: this.loadN.peek(),
      stress: live ? (live as StressSummary) : undefined,
      positions: built.mesh.positions,
      indices: built.mesh.indices,
    });
  }

  /** Safety factor at the current load, or null when the part is untested. */
  factor(): number | null {
    const s = this.stress.peek();
    return s && s.key === this.key() ? safetyFactor(this.materialData, s, this.loadN.peek()) : null;
  }

  private async solve(load: LoadSpec | undefined, label: string): Promise<boolean> {
    const key = this.key();
    this.engine.cancelAnalysis();
    this.busy.value = { kind: 'solve', label, progress: -1 };
    const onGrown = this.grown.peek()?.final === true;
    try {
      const res = await this.engine.run<'solved'>(
        {
          type: 'solve',
          job: this.jobId.peek(),
          params: this.params.peek(),
          material: this.material.peek(),
          load,
          grown: onGrown,
        },
        (ev) => {
          if (ev.type === 'progress') {
            this.busy.value = { kind: 'solve', label, progress: -1 };
          }
        },
      );
      if (key !== this.key()) {
        return false;
      }
      this.stress.value = { ...res.outcome, custom: load !== undefined, key, onGrown };
      this.busy.value = null;
      this.refreshFindings();
      return true;
    } catch (e) {
      if (!(e instanceof CancelledError)) {
        this.busy.value = null;
        this.say(e instanceof Error ? e.message : String(e), 'bad');
      }
      return false;
    }
  }

  /** Run the job's standard load case. */
  async runTest(): Promise<boolean> {
    const lc = this.job.loadCase(this.params.peek());
    this.loadN.value = lc.newtons;
    const ok = await this.solve(undefined, 'Testing the standard load');
    if (ok) {
      this.award('test');
    }
    return ok;
  }

  /** Solve for a palm push at `center` (part coordinates, mm) along `dir`. */
  async pushTest(center: Vec3, dir: Vec3, radius: number): Promise<boolean> {
    const ok = await this.solve(
      { region: { kind: 'sphere', c: center, r: radius }, dir, newtons: 10, surfaceOnly: true, label: 'Palm push' },
      'Solving your push',
    );
    if (ok) {
      this.award('test');
    }
    return ok;
  }

  /** Change the load the part is judged at (the palm push drives this every frame). */
  setLoad(newtons: number, refresh = true): void {
    const next = Math.max(0, Math.round(newtons * 10) / 10);
    if (next !== this.loadN.peek()) {
      this.loadN.value = next;
      if (refresh) {
        this.refreshFindings();
      }
    }
  }

  /**
   * Take on a co-design partner's part exactly (job, every parameter, material).
   * Unlike setParams, keys the partner's part does not have are dropped, so an
   * air sketch with fewer corners does not keep stale ones.
   */
  adoptShared(part: { job: string; params: Params; material: string }): void {
    const job = jobById(part.job);
    const { params } = job.clamp(part.params);
    const sameJob = job.id === this.jobId.peek();
    const before = this.params.peek();
    const keys = new Set([...Object.keys(params), ...Object.keys(before)]);
    const same = sameJob && [...keys].every((k) => Math.abs((params[k] ?? NaN) - (before[k] ?? NaN)) < 1e-9);
    if (part.material !== this.material.peek()) {
      this.setMaterial(part.material);
    }
    if (same) {
      return;
    }
    this.invalidateAnalysis();
    batch(() => {
      this.jobId.value = job.id;
      this.params.value = params;
      if (!sameJob) {
        this.selected.value = null;
        this.rollback.value = null;
        this.bound.value = [];
        this.agentLog.value = [];
        this.loadN.value = job.loadCase(params).newtons;
      }
    });
    this.requestBuild();
  }

  /** Put a hand-drawn outline on the bench as a new part, ready to be pulled up. */
  loadSketch(outline: Params, notes: string[]): void {
    this.selectJob('sketch');
    this.setParams(outline);
    this.mode.value = 'shape';
    this.selected.value = 'h';
    this.award('sketch');
    this.say(`${notes.join('. ')}. Pull the handle up to give it height.`, 'good');
  }

  /** Put a captured real object on the bench as an editable part (footprint outline + height). */
  loadCapture(params: Params, notes: string[]): void {
    this.selectJob('sketch');
    this.setParams(params);
    this.mode.value = 'shape';
    this.selected.value = 'h';
    this.award('sketch');
    const size = params.kind === 1 ? `${(params.r * 2).toFixed(1)} mm across` : `${params.n} corners`;
    this.say(
      `Captured: ${size}, ${params.h.toFixed(1)} mm tall. ${notes.join('. ')}. A parametric extrusion of the footprint: every corner and the height can be edited.`,
      'good',
    );
  }

  /** Show an imported model and fit a cradle round it (its laid-flat size plus the cradle's clearance). */
  useReference(m: ImportedMesh): void {
    const L = m.box.max[0] - m.box.min[0];
    const W = m.box.max[2] - m.box.min[2];
    const H = m.box.max[1] - m.box.min[1];
    this.selectJob('cradle');
    this.setParams({ L, W, H });
    this.reference.value = m;
    const p = this.params.peek();
    const limited = Math.abs(p.L - L) > 0.01 || Math.abs(p.W - W) > 0.01 || Math.abs(p.H - H) > 0.01;
    this.say(
      `${m.name}: ${L.toFixed(1)} x ${W.toFixed(1)} x ${H.toFixed(1)} mm${Number.isFinite(m.volume) ? `, ${(m.volume / 1000).toFixed(2)} cm3` : ''}. ` +
        (limited ? 'Too big for the cradle in some direction; the cradle was limited to its largest size.' : 'A cradle now fits round it.'),
      limited ? 'warn' : 'good',
    );
  }

  /**
   * Turn the imported STEP model into an editable part when it is a block or
   * a cylinder (recognised from its exact volume); otherwise it stays a reference.
   */
  makeEditable(): string {
    const m = this.reference.peek();
    if (!m) return 'Import a STEP file first.';
    const r = recognise(m);
    if (!r) return `${m.name} is not a plain block or cylinder, so it stays a reference model with a cradle round it.`;
    const params: Params = r.shape === 'block' ? { ...blockParams(r.x, r.y), h: r.h } : { kind: 1, cx: 0, cy: 0, r: r.d / 2, h: r.h };
    this.reference.value = null;
    this.adoptShared({ job: 'sketch', params, material: this.material.peek() });
    const f = (v: number): string => (Math.abs(v - Math.round(v)) < 0.01 ? v.toFixed(0) : v.toFixed(2));
    return r.shape === 'block'
      ? `Recognised a ${f(r.x)} x ${f(r.y)} x ${f(r.h)} mm block. It is now an editable part: pull its handles or say "make it 10 mm taller".`
      : `Recognised a cylinder ${f(r.d)} mm across and ${f(r.h)} mm long. It is now an editable part, standing on its end.`;
  }

  /** Load today's brief: its part, material and load. */
  startDaily(): void {
    const brief = dailyBrief(today());
    this.selectJob(brief.job.id);
    this.setMaterial(brief.material);
    this.loadN.value = brief.loadN;
    this.say(`Daily job: ${brief.text}`, 'info');
  }

  applyFix(finding: Finding): void {
    if (!finding.fix) {
      return;
    }
    const hadStress = this.stress.peek() !== null;
    this.retestAfterBuild = hadStress || finding.agent === 'marcus';
    this.setParams(finding.fix.changes);
    this.say(`${finding.fix.label}. ${finding.agent === 'marcus' ? 'Re-testing.' : 'Applied.'}`, 'good');
    this.award('fix');
  }

  /** Let the structural agent iterate: change, rebuild, re-test, until the target holds. */
  async autoReinforce(): Promise<void> {
    this.engine.cancelAnalysis();
    this.agentLog.value = [];
    this.busy.value = { kind: 'reinforce', label: 'Marcus is reinforcing', progress: -1 };
    try {
      const res = await this.engine.run<'reinforced'>(
        {
          type: 'reinforce',
          job: this.jobId.peek(),
          params: this.params.peek(),
          material: this.material.peek(),
          loadN: this.loadN.peek(),
        },
        (ev) => {
          if (ev.type === 'reinforce-step') {
            const s = ev.step;
            const line = s.change
              ? `${s.change}: factor ${s.factor.toFixed(2)}`
              : `Start: factor ${s.factor.toFixed(2)}`;
            this.agentLog.value = [...this.agentLog.peek(), line];
          }
        },
      );
      const last = res.steps[res.steps.length - 1];
      this.busy.value = null;
      // Adopt the agent's result, then test it once more on the visible part.
      const before = this.key();
      this.retestAfterBuild = true;
      this.setParams(last.params);
      if (this.key() === before) {
        this.retestAfterBuild = false;
        void this.runTest();
      }
      this.say(
        res.reached
          ? `Reinforced in ${res.steps.length - 1} step(s): factor ${last.factor.toFixed(1)}, re-tested.`
          : `Best reachable factor ${last.factor.toFixed(1)}. Lower the load or change material.`,
        res.reached ? 'good' : 'warn',
      );
      this.award('fix');
    } catch (e) {
      if (!(e instanceof CancelledError)) {
        this.busy.value = null;
        this.say(e instanceof Error ? e.message : String(e), 'bad');
      }
    }
  }

  /** Carve the part down to `keep` of its material, showing it as it grows. */
  async grow(keep: number): Promise<void> {
    const key = this.key();
    this.engine.cancelAnalysis();
    this.busy.value = { kind: 'grow', label: 'Growing the bone structure', progress: 0 };
    try {
      const res = await this.engine.run<'grown'>(
        {
          type: 'grow',
          job: this.jobId.peek(),
          params: this.params.peek(),
          material: this.material.peek(),
          keep,
        },
        (ev) => {
          if (ev.type === 'grow-frame' && key === this.key()) {
            this.grown.value = {
              mesh: ev.mesh,
              props: ev.props,
              kept: ev.props.volume / (this.built.peek()?.props.volume ?? ev.props.volume),
              final: false,
              iteration: ev.iteration,
              of: ev.of,
            };
            this.busy.value = { kind: 'grow', label: 'Growing the bone structure', progress: ev.iteration / ev.of };
          }
        },
      );
      if (key !== this.key()) {
        return;
      }
      this.grown.value = {
        mesh: res.mesh,
        props: res.props,
        kept: res.kept,
        final: true,
        iteration: res.iterations,
        of: res.iterations,
      };
      this.loadN.value = this.job.loadCase(this.params.peek()).newtons;
      this.stress.value = { ...res.outcome, custom: false, key, onGrown: true };
      this.busy.value = null;
      this.refreshFindings();
      const sf = this.factor();
      this.say(
        `Kept ${(res.kept * 100).toFixed(0)} % of the material. Re-tested: factor ${sf === null ? 'n/a' : sf.toFixed(1)}.`,
        sf !== null && sf >= 1 ? 'good' : 'warn',
      );
      this.award('grow');
    } catch (e) {
      if (!(e instanceof CancelledError)) {
        this.busy.value = null;
        this.say(e instanceof Error ? e.message : String(e), 'bad');
      }
    }
  }

  /**
   * Lattice core: keep a skin and fill the inside with a gyroid sheet. Shown and
   * exported like a grown shape. It is not stress-tested again: the solver's
   * cells are coarser than the lattice walls, so the app says so.
   */
  async lattice(): Promise<void> {
    const key = this.key();
    this.engine.cancelAnalysis();
    this.busy.value = { kind: 'grow', label: 'Filling the core with a gyroid lattice', progress: -1 };
    try {
      const res = await this.engine.run<'latticed'>({ type: 'lattice', job: this.jobId.peek(), params: this.params.peek() });
      if (key !== this.key()) return;
      this.grown.value = { mesh: res.mesh, props: res.props, kept: res.props.volume / res.before, final: true, iteration: 1, of: 1 };
      this.cutaway.value = true;
      this.stress.value = null;
      this.busy.value = null;
      this.refreshFindings();
      const d = this.materialData.density / 1000;
      this.say(
        `Gyroid core, ${res.cell.toFixed(0)} mm cells, ${res.wall.toFixed(1)} mm sheets behind a ${res.skin.toFixed(1)} mm skin: ` +
          `${(res.before * d).toFixed(1)} g to ${(res.props.volume * d).toFixed(1)} g (${((1 - res.props.volume / res.before) * 100).toFixed(0)} % lighter). ` +
          'Not re-tested: the stress solver is too coarse for lattice walls. Export takes the lattice.',
        'good',
      );
    } catch (e) {
      if (!(e instanceof CancelledError)) {
        this.busy.value = null;
        this.say(e instanceof Error ? e.message : String(e), 'warn');
      }
    }
  }

  clearGrown(): void {
    this.cutaway.value = false;
    if (this.grown.peek()) {
      this.grown.value = null;
      this.stress.value = null;
      this.refreshFindings();
    }
  }

  // ----- measure -------------------------------------------------------------

  lockMeasurement(raw: Measurement): void {
    const cal = this.calibrating.peek();
    if (cal) {
      // Calibration readings are kept raw and never bound to the part.
      const readings = [...cal.readings, raw.value];
      if (readings.length < CALIBRATION_READINGS) {
        this.calibrating.value = { readings };
        this.say(`Card reading ${readings.length} of ${CALIBRATION_READINGS}: ${raw.value.toFixed(1)} mm. Measure it again.`, 'info');
        return;
      }
      const result = calibrate(readings);
      const all = { ...this.calibration.peek(), [raw.method]: result };
      this.calibration.value = all;
      saveCalibration(all);
      this.calibrating.value = null;
      this.say(
        `Calibrated (${raw.method === 'span' ? 'finger span' : 'two-hand tape'}): your readings run ${result.bias >= 0 ? '+' : ''}${result.bias.toFixed(1)} mm, ` +
          `scatter ${result.sd.toFixed(1)} mm. Later readings are corrected and shown with their measured uncertainty.`,
        'good',
      );
      return;
    }
    let m = raw;
    const c = this.calibration.peek()[raw.method];
    if (c) {
      const fixed = correct(raw.value, raw.spread, c);
      m = { ...raw, value: fixed.value, uncertainty: fixed.uncertainty };
      this.say(`${m.value.toFixed(1)} mm +/- ${fixed.uncertainty.toFixed(1)} mm (2 sigma, from your calibration).`, 'info');
    }
    this.measurement.value = m;
    this.award('measure');
  }

  /** Measure a bank card's long edge a few times to learn this person's bias and scatter. */
  startCalibration(): void {
    this.calibrating.value = { readings: [] };
    this.mode.value = 'measure';
    this.say(`Calibrate: measure the long edge of a bank card (${CARD_MM.toFixed(2)} mm) ${CALIBRATION_READINGS} times, with the method you use most.`, 'info');
  }

  /** Bind the locked measurement to a parameter (plus that parameter's fit allowance). */
  bindMeasurement(paramId: string, thingName?: string): boolean {
    const m = this.measurement.peek();
    const def = paramDef(this.job, paramId);
    if (!m || !def) {
      return false;
    }
    const fit = def.fit ?? 0;
    this.setParam(paramId, m.value + fit);
    const record: MeasurementRecord = {
      parameter: paramId,
      measured: m.value,
      spread: m.spread,
      method: m.method,
      fit,
    };
    this.bound.value = [...this.bound.peek().filter((b) => b.parameter !== paramId), record];
    const thing: Thing = {
      id: uid(),
      name: thingName ?? `Thing ${this.things.peek().length + 1}`,
      value: m.value,
      spread: m.spread,
      method: m.method,
      created: new Date().toISOString(),
    };
    this.things.value = [thing, ...this.things.peek()].slice(0, 12);
    saveThings(this.things.peek());
    const got = this.params.peek()[paramId];
    this.say(
      Math.abs(got - (m.value + fit)) < 0.03
        ? `${def.label} set to ${got.toFixed(1)} mm (${m.value.toFixed(1)} measured + ${fit.toFixed(1)} fit).`
        : `${def.label} limited to ${got.toFixed(1)} mm; the measurement was ${m.value.toFixed(1)} mm.`,
      'good',
    );
    return true;
  }

  /** Re-use a remembered object for a parameter. */
  bindThing(paramId: string, thing: Thing): void {
    this.measurement.value = { value: thing.value, spread: thing.spread, method: thing.method, samples: 0 };
    const def = paramDef(this.job, paramId);
    if (def) {
      this.setParam(paramId, thing.value + (def.fit ?? 0));
      this.say(`${def.label} fitted to ${thing.name}.`, 'good');
    }
  }

  // ----- keep ----------------------------------------------------------------

  shareUrl(): string {
    const base = `${location.origin}${location.pathname}`;
    return `${base}#${encodeShare({ job: this.jobId.peek(), material: this.material.peek(), params: this.params.peek() })}`;
  }

  /** Put the current part on the shelf. Refused parts cannot be saved. */
  save(): SavedPart | null {
    const built = this.built.peek();
    if (!built || built.gate.verdict === 'refused' || this.rollback.peek() !== null) {
      this.say('Only a part that passed the truth gate can be saved.', 'warn');
      return null;
    }
    const job = this.job;
    const mat = this.materialData;
    const grown = this.grown.peek();
    const volume = grown?.final ? grown.props.volume : built.props.volume;
    const part: SavedPart = {
      id: uid(),
      job: job.id,
      title: job.title,
      material: mat.id,
      params: { ...this.params.peek() },
      created: new Date().toISOString(),
      verdict: built.gate.verdict,
      volume,
      grams: (volume / 1000) * mat.density,
      fits: this.bound.peek().length ? this.things.peek()[0]?.name : undefined,
    };
    this.library.value = [part, ...this.library.peek()].slice(0, 24);
    const stored = saveLibrary(this.library.peek());
    this.progress.value = bumpStreak(this.progress.peek());
    const brief = dailyBrief(today());
    const stress = this.stress.peek();
    const tested = stress !== null && stress.key === this.key();
    const daily = dailyMet(brief, {
      job: job.id,
      material: mat.id,
      grams: part.grams,
      verified: built.gate.verdict === 'verified',
      factorAtLoad: tested ? this.factor() : null,
      testedLoad: tested ? this.loadN.peek() : 0,
    });
    const p = this.progress.peek();
    if (daily.met && p.dailyDone !== brief.date) {
      this.progress.value = { ...p, dailyDone: brief.date, dailyCount: p.dailyCount + 1 };
    }
    saveProgress(this.progress.peek());
    this.award('save');
    if (!stored) {
      // Do not claim a save the browser refused: the shelf holds it only until the page closes.
      this.say('On your shelf for this session, but the browser would not store it (storage full or blocked). Share or download it to keep it.', 'warn');
    } else {
      this.say(
        daily.met
          ? `Saved, and today's job is met: ${part.grams.toFixed(1)} g.`
          : `Saved to your shelf: ${job.title}, ${part.grams.toFixed(1)} g.`,
        'good',
      );
    }
    return part;
  }

  loadSaved(part: SavedPart): void {
    this.invalidateAnalysis();
    batch(() => {
      this.jobId.value = jobById(part.job).id;
      this.material.value = materialById(part.material).id;
      this.params.value = jobById(part.job).clamp(part.params).params;
      this.selected.value = null;
      this.rollback.value = null;
      this.bound.value = [];
      this.loadN.value = this.job.loadCase(this.params.peek()).newtons;
    });
    this.requestBuild();
  }

  removeSaved(id: string): void {
    this.library.value = this.library.peek().filter((p) => p.id !== id);
    saveLibrary(this.library.peek());
  }

  /** Actions that live in systems (drawing, flow, vibration...), registered at start-up. */
  readonly actions: Partial<Record<Action, () => void>> = {
    // Lattice core: a toggle; a second press (or any grown shape) goes back to solid.
    lattice: () => (this.grown.peek()?.final ? this.clearGrown() : void this.lattice()),
  };

  /**
   * One sentence, typed or spoken: edit the part, change material, run an
   * action, or make a new part. Returns the reply, which is also shown (and
   * spoken when the user talked).
   */
  /** Point and say: the parameter under the hand ray, and when it was last pointed at (ms). */
  pointed: { param: string; at: number } | null = null;

  runCommand(sentence: string): string {
    const job = this.job;
    const before = { ...this.params.peek() };
    // "make this thicker" while pointing at the part: edit the size under the ray.
    const p = this.pointed;
    if (p && performance.now() - p.at < 8000 && p.param in before) {
      const next = deicticEdit(sentence, before[p.param]);
      if (next !== null) {
        this.setParams({ [p.param]: next });
        const d = paramDef(job, p.param);
        const after = this.params.peek()[p.param];
        const fmt = (v: number): string => (d?.unit === '' ? String(Math.round(v)) : v.toFixed(Math.abs(v - Math.round(v)) < 0.01 ? 0 : 2));
        const reply = `${d?.label ?? p.param} (where you pointed): ${fmt(before[p.param])} to ${fmt(after)}${d?.unit ? ` ${d.unit}` : ''}.`;
        this.say(reply, 'info');
        this.speakReply(reply);
        return reply;
      }
    }
    const cmd = parseCommand(sentence, job, before);
    let reply = '';
    let tone: Notice['tone'] = 'info';
    switch (cmd.kind) {
      case 'edit': {
        this.setParams(cmd.changes);
        const after = this.params.peek();
        reply = Object.keys(cmd.changes)
          .map((id) => {
            const d = paramDef(job, id);
            const unit = d?.unit ? ` ${d.unit}` : '';
            const fmt = (v: number): string => (d?.unit === '' ? String(Math.round(v)) : v.toFixed(Math.abs(v - Math.round(v)) < 0.01 ? 0 : 2));
            return `${d?.label ?? id}: ${fmt(before[id])} to ${fmt(after[id])}${unit}`;
          })
          .join(', ');
        const notes = this.clampNotes.peek();
        if (notes.length) reply += `. ${notes.join(' ')}`;
        tone = 'good';
        break;
      }
      case 'material':
        this.setMaterial(cmd.material);
        reply = `Material: ${this.materialData.name}.`;
        tone = 'good';
        break;
      case 'describe': {
        const d = describe(cmd.text);
        if ('error' in d) {
          // No part word the rules know: let the on-device language model work out what was meant.
          void this.understandLater(sentence);
          reply = 'Thinking about that...';
          break;
        }
        if (d.job === 'sketch') {
          // "Box" or "round" alone only gives a plain block or disc: let the language model say
          // whether a specific part was meant ("a box to keep my board in" is an enclosure).
          void this.understandLater(sentence, d);
          reply = 'Thinking about that...';
          break;
        }
        reply = this.applySentence(d);
        tone = 'good';
        break;
      }
      case 'action':
        reply = this.runAction(cmd.action);
        break;
      default:
        void this.understandLater(sentence);
        reply = 'Thinking about that...';
    }
    this.say(reply, tone);
    return reply;
  }

  /** Spoken requests cannot fill a form: missing sizes take their defaults, and the reply says so. */
  private applySentence(d: Described): string {
    const answers: Record<string, number> = {};
    for (const q of d.ask) answers[q.id] = q.value;
    this.applyDescribed(d, answers);
    return `${this.job.title}${d.understood.length ? `: ${d.understood.join(', ')}` : ''}.` +
      (d.ask.length ? ` I used ${d.ask.map((q) => `${q.label.toLowerCase()} ${q.value}${q.unit ? ` ${q.unit}` : ''}`).join(', ')}; say a new value to change it.` : '');
  }

  /** The on-device language model: chooses what a free-form sentence means (never its numbers). */
  readonly understander = new Understander();

  private async understandLater(sentence: string, plain?: Described): Promise<void> {
    let u = await this.understander.understand(sentence);
    let reply: string;
    let tone: Notice['tone'] = 'info';
    // With a plain block or disc already understood, only a clear specific part overrides it.
    if (plain && !(u?.kind === 'part' && u.score >= 0.45)) u = null;
    if (plain && !u) {
      reply = this.applySentence(plain);
      tone = 'good';
    } else if (!u || u.kind === 'none') {
      reply = `I did not catch a command there. ${HELP}`;
      tone = 'warn';
    } else if (u.kind === 'tie') {
      reply = `Did you mean ${u.a.label} or ${u.b.label}? Say it again with one of those words.`;
    } else if (u.kind === 'action') {
      reply = `I took that as ${u.intent.label}. ${this.runAction(u.action)}`;
    } else {
      // The part's own word goes in front, so the word rules read the user's numbers for it.
      const d = describe(`${u.intent.noun} ${wordsToDigits(sentence)}`);
      if ('error' in d) {
        reply = d.error;
        tone = 'warn';
      } else {
        reply = `I took that as ${u.intent.label}. ${this.applySentence(d)}`;
        const said = (wordsToDigits(sentence).match(/\d+(?:\.\d+)?/gu) ?? []).map(Number);
        const used = new Set(Object.values(d.params));
        const loose = said.filter((n) => !used.has(n));
        if (loose.length) reply += ` I could not tell what ${loose.join(' and ')} ${loose.length > 1 ? 'were' : 'was'} for; say which size.`;
        tone = 'good';
      }
    }
    probe.understood = { sentence, result: u ? { kind: u.kind, key: 'intent' in u ? u.intent.key : null } : null };
    this.say(reply, tone);
    this.speakReply(reply);
  }

  private runAction(a: Action): string {
    switch (a) {
      case 'undo':
        return this.history.undo() ? 'Undone.' : 'Nothing to undo.';
      case 'redo':
        return this.history.redo() ? 'Redone.' : 'Nothing to redo.';
      case 'test':
        this.mode.value = 'test';
        void this.runTest().then((ok) => {
          const sf = this.factor();
          if (ok && sf !== null) {
            this.speakReply(sf >= 2 ? `Safety factor ${sf.toFixed(1)}. It holds.` : sf >= 1 ? `Safety factor ${sf.toFixed(1)}. It holds, but the margin is thin.` : `Safety factor ${sf.toFixed(1)}. It would fail at this load.`);
          }
        });
        return 'Testing the standard load.';
      case 'stronger':
        void this.autoReinforce();
        return 'Marcus is reinforcing it until it holds.';
      case 'grow':
        void this.grow(0.55);
        return 'Growing the bone structure.';
      case 'solid':
        this.clearGrown();
        return 'Back to the solid part.';
      case 'save':
        return this.save() ? 'Saved to your shelf.' : 'Only a verified part can be saved.';
      case 'next': {
        const i = JOBS.findIndex((j) => j.id === this.jobId.peek());
        this.selectJob(JOBS[(i + 1) % JOBS.length].id);
        return `${this.job.title}.`;
      }
      case 'measure':
        this.laser.value = false;
        this.mode.value = 'measure';
        return 'Measure: pinch the ends of a real object.';
      case 'laser':
        this.mode.value = 'measure';
        this.laser.value = true;
        return 'Laser tape: point at a surface and pinch, then at the other end.';
      case 'capture':
        this.mode.value = 'capture';
        return 'Capture: trace round the base of the object, then pinch its top.';
      case 'sketch':
        this.mode.value = 'sketch';
        return 'Sketch: draw a closed outline just above the bench.';
      case 'shape':
        this.laser.value = false;
        this.mode.value = 'shape';
        return 'Shape mode.';
      case 'help':
        return HELP;
      case 'editable':
        return this.makeEditable();
      default: {
        const fn = this.actions[a];
        if (!fn) return 'That works on the bench in the headset.';
        fn();
        return { flow: 'Air-flow preview.', vibration: 'Finding the natural frequencies.', drawing: 'Making the drawing.', print: 'Print preview.', share: 'Share code.', swing: 'Swinging the hinge.', explode: this.jobId.peek() === 'hinge' ? 'Exploded view.' : 'Exploded views are for the hinge assembly.' }[a as string] ?? 'Done.';
      }
    }
  }

  /** Called with replies worth hearing; the voice layer speaks them when the user is talking. */
  speakReply: (text: string) => void = () => {};

  /** Build a described part (after its questions are answered). */
  applyDescribed(d: Described, answers: Record<string, number>): void {
    const params = answer(d, answers);
    this.adoptShared({ job: d.job, params, material: d.material ?? this.material.peek() });
    this.mode.value = 'shape';
    const job = this.job;
    const notes = this.job.clamp(params).notes;
    this.say(
      `${job.title}${d.shape ? ` (${d.shape})` : ''}: ${d.understood.length ? d.understood.join(', ') : 'default sizes'}${Object.keys(answers).length ? ', and your answers' : ''}.${notes.length ? ` ${notes.join(' ')}` : ''}`,
      'good',
    );
  }

  /** A three-view A4 drawing of the current part, as SVG text. */
  async makeDrawing(): Promise<{ svg: string; name: string; holes: number } | null> {
    const built = this.built.peek();
    if (!built || this.rollback.peek() !== null) {
      this.say('A drawing is made of the finished part.', 'warn');
      return null;
    }
    const job = this.job;
    const params = this.params.peek();
    const mat = this.materialData;
    try {
      const res = await this.engine.run<'viewed'>({ type: 'views', job: job.id, params });
      const b = job.box(params).box;
      const unit = (u: string): string => (u === '' ? '' : ` ${u}`);
      const { svg, holes } = drawingSvg(res.views, {
        title: job.title,
        name: job.id,
        material: `${mat.name} (typical values)`,
        massG: (built.props.volume / 1000) * mat.density,
        volume: built.props.volume,
        verdict: built.gate.verdict === 'verified' ? 'Verified: closed form and kernel agree' : built.gate.verdict === 'kernel-only' ? 'Kernel only' : 'Refused',
        date: today(),
        params: job.params.map((d) => `${d.label} = ${d.unit === '' ? Math.round(params[d.id]) : params[d.id].toFixed(2)}${unit(d.unit)}`),
        exact: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
      });
      return { svg, name: job.id, holes: holes.reduce((s, h) => s + h.count, 0) };
    } catch (e) {
      this.say(e instanceof Error ? e.message : String(e), 'bad');
      return null;
    }
  }

  /** Build the STL and the JSON record for the current part. */
  async exportFiles(): Promise<{ stl: Uint8Array; json: string; name: string } | null> {
    const grown = this.grown.peek();
    const mesh = grown?.final
      ? { positions: grown.mesh.positions.slice(), indices: grown.mesh.indices.slice() }
      : undefined;
    try {
      const res = await this.engine.run<'exported'>(
        {
          type: 'export',
          job: this.jobId.peek(),
          params: this.params.peek(),
          material: this.material.peek(),
          measurements: this.bound.peek(),
          grownMesh: mesh,
        },
        undefined,
        mesh ? [mesh.positions.buffer, mesh.indices.buffer] : [],
      );
      return { stl: res.stl, json: JSON.stringify(res.record, null, 2), name: res.name };
    } catch (e) {
      if (!(e instanceof CancelledError)) {
        this.say(e instanceof Error ? e.message : String(e), 'bad');
      }
      return null;
    }
  }

  // ----- settings and progress ----------------------------------------------

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings.value = { ...this.settings.peek(), [key]: value };
    saveSettings(this.settings.peek());
  }

  award(skill: Skill): void {
    const p = this.progress.peek();
    const count = (p.skills[skill] ?? 0) + 1;
    this.progress.value = { ...p, skills: { ...p.skills, [skill]: count } };
    saveProgress(this.progress.peek());
  }

  finishCoach(): void {
    this.progress.value = { ...this.progress.peek(), coachDone: true };
    saveProgress(this.progress.peek());
  }
}
