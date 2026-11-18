/**
 * Application state and actions. Systems read the signals and call the
 * actions; nothing here touches Three.js, so the same controller drives the
 * immersive bench and the flat page.
 */

import { SketchBench } from './sketch-bench.js';
import { Appearance, appearanceOf } from './appearance.js';
import { draftAnalysis, partingLine } from '../engine/mould.js';
import { toBinaryStl } from '../engine/exporters.js';
import { toThreeMF } from '../engine/threemf.js';
import { stressColor } from './palette.js';
import { writeStep } from '../engine/step-export.js';
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
import { DEFAULT_GDT, drawingSvg, GdtScheme } from '../engine/drawing.js';
import { answer, blockParams, Described, describe } from '../engine/describe.js';
import { Action, deicticEdit, HELP, parseCommand, wordsToDigits } from '../engine/commands.js';
import { fitReply, fitZoom, nextZoom, parseZoom, zoomReply } from './view-zoom.js';
import { Style, styleOf, styleParams } from '../engine/style.js';
import { addFeature, designFlatPattern, designMembers, edgeNear, featureDefs, normalCode, OPS, parseDesign } from '../engine/design.js';
import { applyEquations, emptyEquations, EquationSet, evalExpr, spokenToExpr } from '../engine/equations.js';
import { cutListCsv, parseProfile } from '../engine/weldment.js';
import { flatPatternDxf, flatPatternSvg } from '../engine/sheetmetal.js';
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

  /** Replace the parameters outright (a free design removing a feature drops its keys). */
  replaceParams(next: Params): void {
    const { params, notes } = this.job.clamp(next);
    this.clampNotes.value = notes;
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
      // Through the job's own rules: a free design fills in its starting block here.
      this.params.value = job.clamp(defaultParams(job)).params;
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

  /**
   * A mesh convergence study: the standard load solved on three grids (about 3 500, 12 000 and
   * 28 000 cells), the change over the last refinement, and a Richardson extrapolation (second
   * order) of deflection and stress. The finest result becomes the part's stress map.
   */
  async convergenceStudy(): Promise<string> {
    const lc = this.job.loadCase(this.params.peek());
    this.loadN.value = lc.newtons;
    const key = this.key();
    this.engine.cancelAnalysis();
    const rows: { elements: number; maxDisp: number; stressP99: number }[] = [];
    try {
      for (const target of [3500, 16000, 32000]) {
        this.busy.value = { kind: 'solve', label: `Convergence study: ${target.toLocaleString('en')} cells`, progress: -1 };
        const res = await this.engine.run<'solved'>({ type: 'solve', job: this.jobId.peek(), params: this.params.peek(), material: this.material.peek(), target });
        if (key !== this.key()) {
          this.busy.value = null;
          return 'The part changed, so the study stopped.';
        }
        rows.push(res.outcome);
        if (target === 32000) {
          this.stress.value = { ...res.outcome, custom: false, key, onGrown: false };
          this.refreshFindings();
        }
      }
    } catch (e) {
      this.busy.value = null;
      if (e instanceof CancelledError) return 'Stopped.';
      return e instanceof Error ? e.message : String(e);
    }
    this.busy.value = null;
    const [a, b, c] = rows;
    const r = Math.cbrt(c.elements / b.elements);
    const pct = (fb: number, fc: number): number => (Math.abs(fc - fb) / Math.abs(fc)) * 100;
    const fmtN = (v: number, d = 3): string => v.toPrecision(d);
    // Richardson (second order) only when the results move one way; otherwise the spread is the uncertainty.
    const describe = (name: string, unit: string, va: number, vb: number, vc: number): string => {
      const steady = Math.sign(vb - va) === Math.sign(vc - vb);
      const tail = steady
        ? `last change ${pct(vb, vc).toFixed(1)} %, extrapolated ${fmtN(vc + (vc - vb) / (r * r - 1))} ${unit}`
        : `not settling one way: between ${fmtN(Math.min(va, vb, vc))} and ${fmtN(Math.max(va, vb, vc))} ${unit}, a spread of ${((Math.max(va, vb, vc) / Math.min(va, vb, vc) - 1) * 100).toFixed(0)} %`;
      return `${name} ${fmtN(va)}, ${fmtN(vb)}, ${fmtN(vc)} ${unit} (${tail})`;
    };
    const ok = pct(b.maxDisp, c.maxDisp) < 2 && pct(b.stressP99, c.stressP99) < 5;
    this.award('test');
    return (
      `Convergence study at ${lc.newtons} N on ${rows.map((x) => x.elements.toLocaleString('en')).join(', ')} cells. ` +
      `${describe('Deflection', 'mm', a.maxDisp, b.maxDisp, c.maxDisp)}. ${describe('Stress P99', 'MPa', a.stressP99, b.stressP99, c.stressP99)}. ` +
      (ok ? 'Converged: the two finest grids agree within a few percent.' : 'Not converged: treat the range as the uncertainty of this preview.')
    );
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
   * Turn the imported STEP model into an editable part. A block or a cylinder
   * (recognised from its exact volume) becomes a fully parametric part; any
   * other closed solid becomes the base body of a free design, so holes,
   * bosses, pockets, fillets and chamfers can be added to it.
   */
  makeEditable(): string {
    const m = this.reference.peek();
    if (!m) return 'Import a STEP file first.';
    const r = recognise(m);
    if (!r) {
      if (!m.closed) return `${m.name} is not one closed solid (its surfaces do not meet), so it stays a reference model.`;
      const slot = Math.floor(Date.now() / 1000) % 1000000;
      this.engine.registerMesh(`imp${slot}`, m.positions, m.indices);
      const b = m.box;
      const params = addFeature({ nf: 0 }, OPS.BASE, { a: slot, b: b.min[0], c: b.max[0], d: b.min[1], e: b.max[1], f: b.min[2], g: b.max[2] });
      this.reference.value = null;
      this.adoptShared({ job: 'design', params, material: this.material.peek() });
      return `${m.name} is now the base of a free design: point at any face to drill a hole, sketch a boss or pocket, or fillet and chamfer its edges. Its own faces keep their shape; "export step" saves the result. It is kept for this session.`;
    }
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
  /**
   * Physics-guided style: the style reshapes the part, then the structure agent
   * reinforces only as far as the standard load needs, and the result is tested.
   */
  async applyStyle(style: Style): Promise<void> {
    const changes = styleParams(this.job, this.params.peek(), style);
    if (!Object.keys(changes).length) {
      this.say(`This part has no sizes that give it a ${style} look.`, 'info');
      return;
    }
    this.setParams(changes);
    this.loadN.value = this.job.loadCase(this.params.peek()).newtons;
    const listed = Object.entries(changes)
      .map(([id, v]) => `${paramDef(this.job, id)?.label ?? id} ${+v.toFixed(2)}`)
      .join(', ');
    this.say(`${style[0].toUpperCase()}${style.slice(1)}: ${listed}. Now checking it holds its standard load.`, 'info');
    // Wait for the rebuild, then let Marcus reinforce what the load needs.
    await new Promise((r) => setTimeout(r, 600));
    await this.autoReinforce();
  }

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

  /** The open assembly as a link fragment (src/systems/assembly-system.ts), or null when none is open. */
  assemblyLink: (() => string | null) | null = null;

  shareUrl(): string {
    const base = `${location.origin}${location.pathname}`;
    const asm = this.assemblyLink?.();
    if (asm) return `${base}#asm=${asm}`;
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
  pointed: { param: string; at: number; mm?: [number, number, number]; normal?: [number, number, number] } | null = null;

  /** Free design: the flat face an air sketch is drawn on (part mm origin, normal code), set by "sketch here". */
  sketchFace: { origin: [number, number, number]; code: number } | null = null;

  /** Assembly voice commands (src/systems/assembly-system.ts); returns a reply, or null when not about the assembly. */
  assemblyCommand: ((text: string) => string | null) | null = null;

  private gcs: Promise<import('@salusoft89/planegcs').GcsWrapper> | null = null;

  /** FreeCAD's 2D constraint solver (planeGCS, WebAssembly), loaded on first use. */
  loadGcs(): Promise<import('@salusoft89/planegcs').GcsWrapper> {
    this.gcs ??= (async () => {
      const [{ make_gcs_wrapper }, { default: wasm }] = await Promise.all([
        import('@salusoft89/planegcs'),
        import('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url'),
      ]);
      return make_gcs_wrapper(wasm);
    })();
    return this.gcs;
  }

  /** The sketch workbench while a sketch is open (src/app/sketch-bench.ts), else null. */
  sketchBench: SketchBench | null = null;
  /** Bumped when the workbench opens or closes, for the view. */
  readonly sketchBenchOpen: Signal<boolean> = signal(false);

  /** The top of the built part (mm): where a sketch opens when nothing is pointed at. */
  private partTop(): number {
    const m = this.built.peek()?.mesh;
    if (!m) return 0;
    let top = -Infinity;
    for (let i = 1; i < m.positions.length; i += 3) top = Math.max(top, m.positions[i]);
    return Number.isFinite(top) ? top : 0;
  }

  /** Open a sketch on a face: precise tools (line, rectangle, circle, arc, slot, polygon), relations and dimensions. */
  async openSketchBench(origin: [number, number, number], code: number): Promise<string> {
    const gcs = await this.loadGcs();
    this.sketchBench = new SketchBench(origin, code, gcs);
    // Sketch mode: pinches go to the sketch, not to the part's handles.
    this.mode.value = 'sketch';
    this.sketchBenchOpen.value = true;
    const face = ['top', 'bottom', 'right', 'left', 'front', 'back'][code];
    return `Sketch on the ${face} face. ${this.sketchBench.status} Tools: line, rectangle, circle, arc, tangent arc, slot, polygon; select, smart dimension, delete. Then extrude, cut or revolve.`;
  }

  closeSketchBench(): void {
    this.sketchBench = null;
    this.sketchBenchOpen.value = false;
    if (this.mode.peek() === 'sketch') this.mode.value = 'shape';
  }

  /** Finish the open sketch as a feature. */
  finishSketchBench(op: 'extrude' | 'cut' | 'revolve', size: number): string {
    return this.benchApply((b, p) => b.finish(p, op, size));
  }

  /** Run a finishing step of the sketch workbench (a feature from the sketch), close it and build. */
  benchApply(fn: (b: SketchBench, p: Params) => { params: Params; reply: string }): string {
    const b = this.sketchBench;
    if (!b) return 'No sketch is open.';
    try {
      const r = fn(b, this.params.peek());
      this.closeSketchBench();
      this.replaceParams(r.params);
      return r.reply;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  /**
   * Give one side of an air-sketched outline a length; FreeCAD's solver keeps the
   * rest of the drawing's intent (square corners, equal sides). `edge` is 0-based.
   */
  async dimensionSketch(edge: number, length: number): Promise<void> {
    const p = this.params.peek();
    if (this.jobId.peek() !== 'sketch' || p.kind !== 0) {
      this.say('Side lengths are for a drawn outline (an air sketch with straight sides).', 'info');
      return;
    }
    const n = Math.round(p.n);
    if (edge < 0 || edge >= n) {
      this.say(`This outline has ${n} sides.`, 'warn');
      return;
    }
    const pts: [number, number][] = Array.from({ length: n }, (_, i) => [p[`x${i}`], p[`y${i}`]]);
    try {
      this.gcs ??= (async () => {
        const [{ make_gcs_wrapper }, { default: wasm }] = await Promise.all([
          import('@salusoft89/planegcs'),
          import('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url'),
        ]);
        return make_gcs_wrapper(wasm);
      })();
      const gcs = await this.gcs;
      const { solveOutline } = await import('../engine/constrain.js');
      const r = solveOutline(gcs, pts, [{ edge, length }]);
      if (!r.ok) {
        this.say(`That length conflicts with the rest of the outline${r.conflicting.length ? ` (${r.conflicting.join(', ')})` : ''}.`, 'warn');
        return;
      }
      const next: Params = {};
      r.pts.forEach(([x, y], i) => {
        next[`x${i}`] = Math.round(x * 100) / 100;
        next[`y${i}`] = Math.round(y * 100) / 100;
      });
      this.setParams(next);
      const kept = r.applied.filter((c) => c.kind !== 'equal').length;
      const eq = r.applied.length - kept;
      const reply = `Side ${edge + 1} set to ${length} mm. Kept ${kept} square edge${kept === 1 ? '' : 's'}${eq ? ` and ${eq} equal pair${eq === 1 ? '' : 's'}` : ''}.`;
      this.say(reply, 'good');
      this.speakReply(reply);
    } catch (e) {
      this.say(e instanceof Error ? e.message : String(e), 'bad');
    }
  }

  runCommand(sentence: string): string {
    const job = this.job;
    const before = { ...this.params.peek() };
    // The view's zoom by hand or voice: "true size", "zoom in", "zoom 2 times", "toggle zoom". Any job.
    const zoom = parseZoom(sentence);
    if (zoom) {
      const built = this.built.peek();
      if ('fit' in zoom && !built) {
        const reply = 'The part is still building; try fit view again when it is ready.';
        this.say(reply, 'warn');
        return reply;
      }
      const width = built ? built.props.bbox.max[0] - built.props.bbox.min[0] : 0;
      const height = built ? built.props.bbox.max[1] - built.props.bbox.min[1] : 0;
      const depth = built ? built.props.bbox.max[2] - built.props.bbox.min[2] : 0;
      const z = 'fit' in zoom && built ? fitZoom(width, height, depth) : nextZoom(this.viewZoom.peek(), zoom);
      this.viewZoom.value = z;
      const reply = 'fit' in zoom ? fitReply(width, height, depth, z) : zoomReply(z);
      this.say(reply, 'info');
      return reply;
    }
    // Assembly: "assembly demo", "turn the hinge to 90", "play", "clash check"...
    const asm = this.assemblyCommand?.(sentence) ?? null;
    if (asm) return asm;
    // "two more bolts" on a part with no bolts: say so, rather than let a guess replace the part.
    const counted = wordsToDigits(sentence).toLowerCase().match(/\b(more|fewer|less|extra)\b.*?\b(bolts?|holes?|screws?|spokes?)\b/u);
    if (counted && job.id !== 'design' && !job.params.some((d) => d.unit === '' && /bolt|hole|screw|spoke/iu.test(d.label))) {
      const noun = counted[2].endsWith('s') ? counted[2] : `${counted[2]}s`;
      const reply = `The ${job.title.toLowerCase()} has no ${noun} to add or remove. Say a size to change, or "next part" for another part.`;
      this.say(reply, 'info');
      return reply;
    }
    // The sketch workbench takes its own words while a sketch is open.
    if (this.sketchBench) {
      const s = wordsToDigits(sentence).toLowerCase();
      const bench = this.sketchBench;
      // Sweep a rod or bar along the sketched path: "sweep 8", "sweep a rectangle 10 by 6 bend 12".
      if (/\bsweep\b/u.test(s)) {
        const rect = s.match(/\b(?:rectangle|bar|square)\D*?(\d+(?:\.\d+)?)\s*(?:by|x)\s*(\d+(?:\.\d+)?)/u);
        const bend = s.match(/\bbend\s*(?:radius\s*)?(\d+(?:\.\d+)?)/u);
        const dia = s.replace(/\bbend\s*(?:radius\s*)?\d+(?:\.\d+)?/u, '').match(/(\d+(?:\.\d+)?)/u);
        const reply = this.benchApply((b, p) => b.finishSweep(p, dia ? parseFloat(dia[1]) : 8, bend ? parseFloat(bend[1]) : undefined, rect ? [parseFloat(rect[1]), parseFloat(rect[2])] : undefined));
        this.say(reply, 'info');
        return reply;
      }
      // Weldment from the sketch's lines: "weldment square tube 20 by 2", "frame of angle 30 by 3".
      if (/\b(weldment|structural member|members|frame of)\b/u.test(s)) {
        const prof = parseProfile(s) ?? { kind: 'square' as const, w: 20, h: 20, t: 2 };
        const reply = this.benchApply((b, p) => b.finishWeldment(p, prof));
        this.say(reply, 'info');
        return reply;
      }
      // Sheet metal from the sketch: "sheet metal 2" (thickness), "bend 3".
      if (/\bsheet ?metal\b/u.test(s)) {
        const th = s.match(/\bthick(?:ness)?\s*(\d+(?:\.\d+)?)/u) ?? s.match(/(\d+(?:\.\d+)?)/u);
        const bd = s.match(/\bbend(?: radius)?\s*(\d+(?:\.\d+)?)/u);
        const t = th ? parseFloat(th[1]) : 2;
        const reply = this.benchApply((b, p) => b.finishSheet(p, t, bd ? parseFloat(bd[1]) : t));
        this.say(reply, 'info');
        return reply;
      }
      // Loft: "loft 25" keeps this profile and opens the second sketch 25 mm out; "finish loft" makes it.
      if (/\bloft\b/u.test(s)) {
        if (bench.loftFrom && (/\b(finish|done|end|make|close)\b/u.test(s) || !/\d/u.test(s))) {
          const reply = this.benchApply((b, p) => b.finishLoft(p));
          this.say(reply, 'info');
          return reply;
        }
        const d = s.match(/(\d+(?:\.\d+)?)/u);
        try {
          const reply = bench.startLoft(d ? parseFloat(d[1]) : 20);
          this.say(reply, 'info');
          return reply;
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      }
      // Angled planes: "tilt plane 30", "turn plane 45".
      const tp = s.match(/\b(tilt|turn|rotate)\b.*?\bplane\b\D*?(-?\d+(?:\.\d+)?)|\bplane\b.*?\b(tilt|turn|rotate|at)\b\D*?(-?\d+(?:\.\d+)?)/u);
      if (tp) {
        const verb = tp[1] ?? tp[3];
        const deg = parseFloat(tp[2] ?? tp[4]);
        const reply = verb === 'turn' || verb === 'rotate' ? bench.turnPlane(deg) : bench.tiltPlane(deg);
        this.say(reply, 'info');
        return reply;
      }
      // Offset reference plane: "plane 10" (out of the face), "plane in 5".
      const pl = s.match(/\b(?:offset |reference )?plane\b\D*?(-?\d+(?:\.\d+)?)/u);
      if (pl) {
        const d = parseFloat(pl[1]) * (/\b(in|down|back|below|inside)\b/u.test(s) ? -1 : 1);
        const reply = bench.offsetPlane(d);
        this.say(reply, 'info');
        return reply;
      }
      const fin = s.match(/\b(extrude|boss|pull|cut|pocket|revolve)\b(?:\D*?(\d+(?:\.\d+)?))?/u);
      if (fin) {
        const op = /\b(cut|pocket)\b/u.test(fin[1]) ? 'cut' : fin[1] === 'revolve' ? 'revolve' : 'extrude';
        const size = fin[2] ? parseFloat(fin[2]) : op === 'revolve' ? 360 : 10;
        const reply = this.finishSketchBench(op, size);
        this.say(reply, 'info');
        return reply;
      }
      if (/\b(exit|cancel|close|leave|discard) (the )?sketch\b/u.test(s)) {
        this.closeSketchBench();
        return 'Sketch closed without a feature.';
      }
      const r = this.sketchBench.command(s);
      if (r) {
        this.say(r, 'info');
        return r;
      }
    }
    if (/\b(convergence|converge|fine (analysis|mesh|test)|refine (the )?(mesh|test|analysis))\b/u.test(sentence.toLowerCase())) {
      void this.convergenceStudy().then((reply) => {
        this.say(reply, /Not converged|stopped|changed/u.test(reply) ? 'warn' : 'good');
        this.speakReply(reply.split('. ').slice(-1)[0]);
      });
      return 'Running a convergence study: three grids, each finer than the last.';
    }
    // STL or 3MF for the slicer: "export stl", "save the 3mf", "download stl".
    if (/\b(export|save|download|give me)\b.*\b(stl|3mf)\b|\b(stl|3mf) (file|export)\b/u.test(sentence.toLowerCase())) {
      if (/3mf/u.test(sentence.toLowerCase())) return this.export3mf();
      void this.exportFiles().then((f) => {
        if (!f) return;
        this.download(f.stl, `${f.name}.stl`, 'model/stl');
        this.say(`Saved ${f.name}.stl for your slicer.`, 'good');
      });
      return 'Saving the STL.';
    }
    if (/\b(export|save|download)\b.*\b(step|stp)\b/u.test(sentence.toLowerCase())) {
      const s = this.exportStep();
      if (!s) return 'Nothing to export yet.';
      this.download(s.step, `${s.name}.step`, 'model/step');
      return `Saved ${s.name}.step: a solid with ${s.faces} faces, ready for SOLIDWORKS, CATIA or Creo.`;
    }
    // Moulds and castings: "draft analysis 2" (degrees, pull up; "pull z" for another direction), "parting line",
    // "make mould margin 15 shrink 0.5".
    const ms = sentence.toLowerCase();
    if (/\b(draft analysis|check draft|draft check|parting line|make (?:a )?mou?ld|core and cavity|mou?ld halves)\b/u.test(ms)) {
      const built = this.built.peek();
      if (!built) return 'Build a part first.';
      const axis = ms.match(/\bpull\s*(?:along\s*)?([-+]?)\s*([xyz])\b/u);
      const pull: [number, number, number] = [0, 0, 0];
      pull[axis ? 'xyz'.indexOf(axis[2]) : 1] = axis && axis[1] === '-' ? -1 : 1;
      const m = built.mesh;
      if (/\bdraft\b/u.test(ms) && !/\bmou?ld\b/u.test(ms)) {
        const deg = ms.match(/(\d*\.?\d+)\s*(?:deg|degrees|°)?/u);
        const r = draftAnalysis(m.positions, m.normals, m.indices, pull, deg ? parseFloat(deg[1]) : 1);
        this.draftColors.value = r.colors;
        const tot = r.positive + r.negative + r.insufficient;
        return `Draft analysis (pull ${axis ? axis[0] : 'up'}, ${deg ? deg[1] : 1} degrees): green ${((100 * r.positive) / tot).toFixed(0)} % releases with the pull, blue ${((100 * r.negative) / tot).toFixed(0)} % against it, amber ${((100 * r.insufficient) / tot).toFixed(0)} % (${r.insufficient.toFixed(0)} mm2) needs more draft.`;
      }
      const pl = partingLine(m.positions, m.indices, pull);
      if (/\bparting line\b/u.test(ms) && !/\bmou?ld\b/u.test(ms)) {
        this.partingLines.value = pl.segments;
        return pl.length ? `Parting line: ${pl.length.toFixed(0)} mm round the part, at ${pl.level.toFixed(1)} mm along the pull (shown in amber).` : 'No parting line: nothing turns away from that pull.';
      }
      const mg = ms.match(/\bmargin\s*(\d+(?:\.\d+)?)/u);
      const sh = ms.match(/\bshrink(?:age)?\s*(\d*\.?\d+)\s*(%|percent)?/u);
      const shrink = sh ? parseFloat(sh[1]) / 100 : 0.005;
      void this.engine
        .run<'moulded'>({ type: 'mould', job: this.jobId.peek(), params: this.params.peek(), pull, margin: mg ? parseFloat(mg[1]) : 15, shrink, level: pl.length ? pl.level : 0 })
        .then((r) => {
          this.download(toBinaryStl(r.cavity.positions, r.cavity.indices, 'cavity'), `${this.job.id}-cavity.stl`, 'model/stl');
          this.download(toBinaryStl(r.core.positions, r.core.indices, 'core'), `${this.job.id}-core.stl`, 'model/stl');
          this.say(`Mould saved: cavity ${(r.cavityVolume / 1000).toFixed(1)} cm3 and core ${(r.coreVolume / 1000).toFixed(1)} cm3, split at the parting line, ${(shrink * 100).toFixed(2)} % shrinkage allowed.`, 'good');
        })
        .catch((e: unknown) => this.say(e instanceof Error ? e.message : String(e), 'bad'));
      return 'Making the core and cavity.';
    }
    // Appearance: "appearance brushed aluminium", "make it anodised red", "make it blue", "paint it red",
    // "finish carbon fibre", "no appearance".
    if (/\b(appearance|finish|looks? like|render(?:ed)? (?:in|as)|make it (?:look )?(?:brushed|anodi[sz]ed|chrome|polished|matte?|gloss|carbon|wood|rubber|glass|red|blue|green|black|white|orange|yellow|purple|gr[ae]y|silver|gold|teal|pink)|(?:paint|colou?r) it)\b/u.test(sentence.toLowerCase()) && !/\bsurface finish\b/u.test(sentence.toLowerCase())) {
      const t = sentence.toLowerCase();
      if (/\b(no|plain|default|bench) (appearance|finish|look)\b/u.test(t)) {
        this.appearance.value = null;
        return 'Back to the bench look.';
      }
      const a = appearanceOf(t);
      if (a) {
        this.appearance.value = a;
        return `Appearance: ${a.name}. It is how it looks; the material for strength and mass is still ${this.materialData.name}.`;
      }
    }
    // Equations, variables and configurations.
    const eqr = this.equationCommand(wordsToDigits(sentence).toLowerCase());
    if (eqr) {
      this.say(eqr, 'info');
      return eqr;
    }
    // Geometric tolerancing on drawings.
    const gd = this.gdtCommand(sentence.toLowerCase());
    if (gd) {
      this.say(gd, 'info');
      return gd;
    }
    // A weldment's cut list: members grouped by profile and length.
    if (/\bcut ?list\b/u.test(sentence.toLowerCase()) && this.jobId.peek() === 'design') {
      const members = designMembers(this.params.peek());
      if (!members.length) return 'There are no weldment members.';
      const cl = cutListCsv(members, this.materialData.density);
      this.download(cl.csv, 'cut-list.csv', 'text/csv');
      return `Cut list saved: ${cl.count} members, ${cl.total.toFixed(0)} mm of stock in all.`;
    }
    // Sheet metal's flat pattern: DXF for the laser or punch, and an SVG to look at.
    if (/\b(flat pattern|unfold|flatten)\b/u.test(sentence.toLowerCase()) && this.jobId.peek() === 'design') {
      const fp = designFlatPattern(this.params.peek());
      if (!fp) return 'There is no sheet-metal part to unfold.';
      this.download(flatPatternDxf(fp), 'flat-pattern.dxf', 'application/dxf');
      this.download(flatPatternSvg(fp, this.job.title), 'flat-pattern.svg', 'image/svg+xml');
      return `Flat pattern saved (DXF and SVG): ${fp.size[0].toFixed(1)} by ${fp.size[1].toFixed(1)} mm, ${fp.bends.length / 2} bend${fp.bends.length === 2 ? '' : 's'}, bend lines on their own layer.`;
    }
    if (/^\s*(assembly|assemble|open (the )?assembly)\s*$/u.test(sentence.toLowerCase())) {
      this.actions.assembly?.();
      return 'Assembly.';
    }
    // Free design: "add a box 40 by 30 by 10", "drill a 5 mm hole here", "fillet 3"...
    if (/\b(free design|new design|design (a|my own|something)|start designing)\b/u.test(sentence.toLowerCase())) {
      this.selectJob('design');
      return 'Free design: a 60 by 40 by 20 block to start. Add boxes, cylinders, holes, fillets, shells and patterns by voice or from the design strip.';
    }
    // "Sketch here": the sketch workbench on the face pointed at (precise tools, relations, dimensions).
    if (this.jobId.peek() === 'design' && /\b(sketch|draw) (here|on (this|that|the) face)\b/u.test(sentence.toLowerCase()) && !/\d/u.test(wordsToDigits(sentence)) && !/\bfreehand\b/u.test(sentence.toLowerCase())) {
      const pt = this.pointed && performance.now() - this.pointed.at < 8000 ? this.pointed : null;
      const top = this.built.peek()?.props;
      const code = pt?.normal ? normalCode(pt.normal) : 0;
      if (pt?.normal && code < 0) return 'That face is not flat along a main direction; point at a flat face.';
      const origin: [number, number, number] = pt?.mm ? [Math.round(pt.mm[0] * 2) / 2, pt.mm[1], Math.round(pt.mm[2] * 2) / 2] : [0, top ? this.partTop() : 0, 0];
      if (pt?.mm) {
        const k = [1, 0, 2][code >> 1];
        origin[k] = pt.mm[k];
        for (let j = 0; j < 3; j++) if (j !== k) origin[j] = Math.round(pt.mm[j] * 2) / 2;
      }
      void this.openSketchBench(origin, Math.max(0, code)).then((r) => {
        this.say(r, 'info');
        this.speakReply(r.split('. ')[0]);
      });
      return 'Opening a sketch on that face.';
    }
    // "Draw freehand here": the air sketch (a hand-drawn outline, cleaned up).
    if (this.jobId.peek() === 'design' && /\b(sketch|draw) (freehand )?(here|on (this|that|the) face)\b/u.test(sentence.toLowerCase()) && !/\d/u.test(wordsToDigits(sentence))) {
      const pt = this.pointed && performance.now() - this.pointed.at < 8000 ? this.pointed : null;
      if (!pt?.mm || !pt.normal) return 'Point at a flat face of the part, then say "sketch here".';
      const code = normalCode(pt.normal);
      if (code < 0) return 'That face is not flat along a main direction; point at a flat face.';
      this.sketchFace = { origin: pt.mm, code };
      this.mode.value = 'sketch';
      const reply = `Sketch on the ${['top', 'bottom', 'right', 'left', 'front', 'back'][code]} face: pinch near it and draw a closed outline, then let go.`;
      this.say(reply, 'info');
      return reply;
    }
    if (this.jobId.peek() === 'design') {
      const raw = this.pointed && performance.now() - this.pointed.at < 8000 ? this.pointed.mm : undefined;
      const nrm0 = this.pointed && performance.now() - this.pointed.at < 8000 ? this.pointed.normal : undefined;
      // Hands are good to a few millimetres: the point on the face snaps to a 0.5 mm grid (its depth stays on the face).
      const k0 = nrm0 ? Math.max(0, normalCode(nrm0)) >> 1 : -1;
      const axis = k0 === 0 ? 1 : k0 === 1 ? 0 : k0 === 2 ? 2 : -1;
      const grid = (v: number, j: number): number => (j === axis ? v : Math.round(v * 2) / 2);
      const pointedAtEdge = /\b(this|that) edge\b|\bedge here\b|\b(rim|hole edge)\b/u.test(sentence.toLowerCase());
      const here = raw && !pointedAtEdge ? (raw.map(grid) as [number, number, number]) : raw;
      const mesh = this.built.peek()?.mesh;
      const edgeAt = mesh ? (at: [number, number, number], reach?: number) => edgeNear(mesh.edges, at, reach) : undefined;
      const nrm = this.pointed && performance.now() - this.pointed.at < 8000 ? this.pointed.normal : undefined;
      const code = nrm ? Math.max(0, normalCode(nrm)) : 0;
      const edit = parseDesign(wordsToDigits(sentence), this.params.peek(), here, edgeAt, code);
      if (edit) {
        this.replaceParams(edit.params);
        this.say(edit.reply, 'info');
        this.speakReply(edit.reply);
        return edit.reply;
      }
    }
    // A style ("make it sleek"): reshape, then let the structure agent keep it strong.
    const style = styleOf(sentence);
    if (style) {
      void this.applyStyle(style);
      return `Making it ${style}, then checking it still holds.`;
    }
    // "this side 40" on an air-sketched outline: a driving dimension for the constraint solver.
    const side = wordsToDigits(sentence).toLowerCase().match(/\b(?:(this|that)\s+(?:side|edge|line)|side\s+(\d+))\b[^\d]*(\d+(?:\.\d+)?)/u);
    if (side && this.jobId.peek() === 'sketch' && this.params.peek().kind === 0) {
      const p0 = this.params.peek();
      const n = Math.round(p0.n);
      let edge = side[2] ? parseInt(side[2], 10) - 1 : -1;
      if (edge < 0) {
        const mm = this.pointed && performance.now() - this.pointed.at < 8000 ? this.pointed.mm : undefined;
        if (!mm) return 'Point at a side of the outline, then say "this side 40".';
        // The sketch's plane: u = X, v = -Z in part millimetres.
        const q: [number, number] = [mm[0], -mm[2]];
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < n; i++) {
          const ax = p0[`x${i}`], ay = p0[`y${i}`], bx = p0[`x${(i + 1) % n}`], by = p0[`y${(i + 1) % n}`];
          const dx = bx - ax, dy = by - ay;
          const t = Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(ax + t * dx - q[0], ay + t * dy - q[1]);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        edge = best;
      }
      void this.dimensionSketch(edge, parseFloat(side[3]));
      return `Setting side ${edge + 1} to ${side[3]} mm.`;
    }
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
    } else if (u.kind === 'confirm') {
      // Not sure enough to change the part on a guess: say what it would do, and how to ask for it.
      reply = `Did you mean ${u.intent.label}? To do that, say "${u.intent.phrases[0]}".`;
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
  /** A draft analysis's colours for the part (null when none is shown). */
  readonly draftColors: Signal<Float32Array | null> = signal(null);
  /** A parting line to draw over the part (segments, mm), or null. */
  readonly partingLines: Signal<number[] | null> = signal(null);
  /** The bench view's zoom (1 = true size); voice, the ribbon and the desktop wheel all set it. */
  readonly viewZoom: Signal<number> = signal(1);

  /** The part's appearance (src/app/appearance.ts), or null for the bench look. */
  readonly appearance: Signal<Appearance | null> = signal(null);

  /** Global variables and the equations that drive dimensions from them (src/engine/equations.ts). */
  equations: EquationSet = emptyEquations();
  /** Named configurations of the design: its parameters and variables. */
  private configs: Map<string, { params: Params; globals: Record<string, number> }> | null = null;

  private loadConfigs(): Map<string, { params: Params; globals: Record<string, number> }> {
    if (this.configs) return this.configs;
    this.configs = new Map();
    try {
      const raw = localStorage.getItem('astracad:configs');
      if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, { params: Params; globals: Record<string, number> }>)) this.configs.set(k, v);
    } catch {
      // Storage blocked or empty: configurations live for the session.
    }
    return this.configs;
  }

  private saveConfigs(): void {
    try {
      localStorage.setItem('astracad:configs', JSON.stringify(Object.fromEntries(this.loadConfigs())));
    } catch {
      // Not stored; still usable this session.
    }
  }

  /** Apply the equations to the part; the reply names what moved. */
  private applyEq(lead: string): string {
    const r = applyEquations(this.params.peek(), this.equations);
    if (r.changed.length) this.replaceParams(r.params);
    const tail = r.errors.length ? ` Not applied: ${r.errors.join('; ')}.` : r.changed.length ? ` Updated: ${r.changed.join(', ')}.` : '';
    return `${lead}${tail}`;
  }

  /**
   * Equations and configurations by voice: "variable width 60", "width equals 80", "feature 2 height equals width
   * divided by 3", "show equations", "save configuration long", "configuration short", "design table".
   */
  equationCommand(t: string): string | null {
    const eq = this.equations;
    const v1 = t.match(/\b(?:variable|global|let)\s+([a-z][a-z0-9_]*)\s*(?:=|equals|to|is|be)?\s*(-?\d+(?:\.\d+)?)/u) ?? (() => {
      const m = t.match(/^\s*([a-z][a-z0-9_]*)\s*(?:=|equals|is now)\s*(-?\d+(?:\.\d+)?)\s*$/u);
      return m && m[1] in eq.globals ? m : null;
    })();
    if (v1) {
      eq.globals[v1[1]] = parseFloat(v1[2]);
      return this.applyEq(`${v1[1]} = ${v1[2]}.`);
    }
    const rule = t.match(/\bfeature\s+(\d+)\s+(.+?)\s+(?:=|equals|is)\s+(.+)$/u);
    if (rule && this.jobId.peek() === 'design') {
      const k = parseInt(rule[1], 10) - 1;
      const defs = featureDefs(this.params.peek(), k);
      const words = rule[2].replace(/\bthe\b/gu, '').trim();
      const def = defs.find((d) => d.label.toLowerCase() === words) ?? defs.find((d) => d.label.toLowerCase().includes(words));
      if (!def) return `Feature ${k + 1} has: ${defs.map((d) => d.label.toLowerCase()).join(', ') || 'no sizes'}.`;
      const expr = spokenToExpr(rule[3]);
      try {
        evalExpr(expr, eq.globals);
      } catch (e) {
        return `That equation does not work yet: ${e instanceof Error ? e.message : String(e)}.`;
      }
      eq.rules = eq.rules.filter((r) => r.target !== def.id);
      eq.rules.push({ target: def.id, expr, label: `feature ${k + 1} ${def.label.toLowerCase()}` });
      return this.applyEq(`Feature ${k + 1} ${def.label.toLowerCase()} = ${expr}.`);
    }
    if (/\b(show|list) (the )?(equations|variables)\b/u.test(t)) {
      const g = Object.entries(eq.globals).map(([k, v]) => `${k} = ${v}`);
      const r = eq.rules.map((x) => `${x.label} = ${x.expr}`);
      return g.length || r.length ? `Variables: ${g.join(', ') || 'none'}. Equations: ${r.join('; ') || 'none'}.` : 'No variables or equations yet: say "variable width 60".';
    }
    if (/\b(clear|remove|delete) (all )?(the )?equations\b/u.test(t)) {
      this.equations = emptyEquations();
      return 'Equations and variables cleared.';
    }
    const save = t.match(/\bsave (?:as )?(?:a )?configuration\s+([a-z0-9][a-z0-9 _-]*)/u);
    if (save) {
      const name = save[1].trim();
      this.loadConfigs().set(name, { params: { ...this.params.peek() }, globals: { ...eq.globals } });
      this.saveConfigs();
      return `Configuration "${name}" saved (${this.loadConfigs().size} in all).`;
    }
    if (/\b(list|show) (the )?configurations\b/u.test(t)) {
      const names = [...this.loadConfigs().keys()];
      return names.length ? `Configurations: ${names.join(', ')}.` : 'No configurations yet: say "save configuration long".';
    }
    const use = t.match(/\b(?:switch to |use |show |open )?configuration\s+([a-z0-9][a-z0-9 _-]*)/u);
    if (use) {
      const name = use[1].trim();
      const c = this.loadConfigs().get(name);
      if (!c) return `There is no configuration "${name}". ${this.loadConfigs().size ? `There are: ${[...this.loadConfigs().keys()].join(', ')}.` : ''}`;
      this.equations.globals = { ...c.globals };
      this.replaceParams({ ...c.params });
      return `Configuration "${name}".`;
    }
    if (/\bdesign table\b/u.test(t)) {
      const cfgs = [...this.loadConfigs()];
      if (cfgs.length < 2) return 'A design table needs two configurations or more.';
      const keys = [...new Set(cfgs.flatMap(([, c]) => Object.keys(c.params)))].filter((k) => new Set(cfgs.map(([, c]) => c.params[k])).size > 1);
      const lines = [['Configuration', ...keys].join(','), ...cfgs.map(([n, c]) => [n, ...keys.map((k) => c.params[k] ?? '')].join(','))];
      this.download(lines.join('\n') + '\n', 'design-table.csv', 'text/csv');
      return `Design table saved: ${cfgs.length} configurations, ${keys.length} values that differ.`;
    }
    return null;
  }

  /** The drawing's geometric tolerancing (datums A, B, C and the frames' tolerances), or null for none. */
  gdt: GdtScheme | null = { ...DEFAULT_GDT };

  /** "Position tolerance 0.05", "flatness 0.02", "perpendicularity 0.03", "tolerance class fine", "no gd&t". */
  gdtCommand(t: string): string | null {
    if (/\b(no|remove|turn off|hide) (gd ?& ?t|gdt|geometric toleranc\w*)\b/u.test(t)) {
      this.gdt = null;
      return 'Drawings without geometric tolerancing.';
    }
    const g = (this.gdt ??= { ...DEFAULT_GDT });
    const num = (re: RegExp): number | null => {
      const m = t.match(re);
      return m ? parseFloat(m[1]) : null;
    };
    const pos = num(/\bposition(?: tolerance)?\s*(\d*\.?\d+)/u);
    if (pos !== null) {
      g.position = pos;
      return `Hole position tolerance \u2300${pos} to A, B, C.`;
    }
    const fl = num(/\bflatness\s*(\d*\.?\d+)/u);
    if (fl !== null) {
      g.flatness = fl;
      return `Flatness of the top face ${fl} mm.`;
    }
    const pp = num(/\bperpendicularity\s*(\d*\.?\d+)/u);
    if (pp !== null) {
      g.perpendicularity = pp;
      return `Face B square to A within ${pp} mm.`;
    }
    const cls = t.match(/\b(?:tolerance class|general tolerance)\s*(fine|medium|coarse|very coarse)\b/u);
    if (cls) {
      g.general = cls[1] === 'fine' ? 'f' : cls[1] === 'medium' ? 'm' : cls[1] === 'coarse' ? 'c' : 'v';
      return `General tolerances ISO 2768-${g.general}K.`;
    }
    if (/\b(gd ?& ?t|gdt|geometric toleranc\w*) on\b|\badd (gd ?& ?t|gdt)\b/u.test(t)) return 'Drawings carry datums A, B, C and feature control frames.';
    return null;
  }

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
        gdt: this.gdt,
      });
      return { svg, name: job.id, holes: holes.reduce((s, h) => s + h.count, 0) };
    } catch (e) {
      this.say(e instanceof Error ? e.message : String(e), 'bad');
      return null;
    }
  }

  /** Build the STL and the JSON record for the current part. */
  /** The part as a STEP file (AP214 B-rep, millimetres) that SOLIDWORKS, CATIA, Creo and Fusion open. */
  exportStep(): { step: string; name: string; faces: number } | null {
    const built = this.built.peek();
    const grown = this.grown.peek();
    const mesh = grown?.final ? grown.mesh : built?.mesh;
    if (!mesh) {
      this.say('Build a part first, then export it.', 'warn');
      return null;
    }
    const name = this.job.id;
    const step = writeStep([{ name: this.job.title, positions: mesh.positions, indices: mesh.indices }], `${name}.step`);
    const faces = (step.match(/ADVANCED_FACE\(/gu) ?? []).length;
    return { step, name, faces };
  }

  /** Save text or bytes to the downloads folder (works in the headset browser too). */
  download(data: string | Uint8Array, name: string, type: string): void {
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /** Save the part as 3MF, with the stress map as vertex colours when it has been tested. Returns the reply. */
  export3mf(): string {
    const built = this.built.peek();
    const grown = this.grown.peek();
    const mesh = grown?.final ? grown.mesh : built?.mesh;
    if (!mesh) return 'Nothing to export yet.';
    const s = this.stress.peek();
    let colors: Float32Array | null = null;
    if (s && s.vertexStress.length * 3 === mesh.positions.length) {
      colors = new Float32Array(mesh.positions.length);
      const k = this.loadN.peek() / s.newtons / this.materialData.yield;
      const safe = this.settings.peek().colorSafe;
      for (let v = 0; v < s.vertexStress.length; v++) stressColor(s.vertexStress[v] * k, safe, colors, v * 3);
    }
    const res = toThreeMF(mesh.positions, mesh.indices, colors, this.job.title);
    this.download(res.bytes, `${this.job.id}${colors ? '_stress' : ''}.3mf`, 'model/3mf');
    const reply = colors ? `3MF saved with ${res.colors} stress colours.` : '3MF saved. Run a load test first to include stress colours.';
    this.say(reply, 'good');
    return reply;
  }

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
