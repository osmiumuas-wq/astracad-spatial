/**
 * Application state and actions. Systems read the signals and call the
 * actions; nothing here touches Three.js, so the same controller drives the
 * immersive bench and the flat page.
 */

import { Signal, signal } from '@iwsdk/core';
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
  loadLibrary,
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
  method: 'span' | 'tape';
  samples: number;
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

export type Mode = 'shape' | 'measure' | 'test';

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
  readonly grown: Signal<GrownState | null> = signal(null);
  readonly agentLog: Signal<string[]> = signal([]);
  readonly notice: Signal<Notice | null> = signal(null);
  readonly fatal: Signal<string | null> = signal(null);
  readonly settings: Signal<Settings> = signal(loadSettings());
  readonly progress: Signal<Progress> = signal(loadProgress());
  readonly library: Signal<SavedPart[]> = signal(loadLibrary());
  readonly things: Signal<Thing[]> = signal(loadThings());
  /** True while a handle or dial is being moved. */
  readonly dragging = signal(false);
  /** Notes from the last clamp (why a value was limited). */
  readonly clampNotes: Signal<string[]> = signal([]);

  private noticeId = 0;
  private retestAfterBuild = false;

  constructor() {
    this.engine.onBuilt = (b) => this.onBuilt(b);
    this.engine.onBuildError = (message) => {
      this.refusal.value = message;
    };
    this.engine.onFatal = (message) => {
      this.fatal.value = message;
    };
    const shared = decodeShare(globalThis.location?.hash ?? '');
    if (shared) {
      this.jobId.value = shared.job.id;
      this.params.value = shared.params;
      this.material.value = shared.material;
      this.loadN.value = shared.job.loadCase(shared.params).newtons;
    }
    this.requestBuild();
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
    if (job.params.every((d) => Math.abs(params[d.id] - before[d.id]) < 1e-9)) {
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
    this.jobId.value = job.id;
    this.params.value = defaultParams(job);
    this.selected.value = null;
    this.rollback.value = null;
    this.bound.value = [];
    this.agentLog.value = [];
    this.loadN.value = job.loadCase(this.params.peek()).newtons;
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

  clearGrown(): void {
    if (this.grown.peek()) {
      this.grown.value = null;
      this.stress.value = null;
      this.refreshFindings();
    }
  }

  // ----- measure -------------------------------------------------------------

  lockMeasurement(m: Measurement): void {
    this.measurement.value = m;
    this.award('measure');
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
    saveLibrary(this.library.peek());
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
    this.say(
      daily.met
        ? `Saved, and today's job is met: ${part.grams.toFixed(1)} g.`
        : `Saved to your shelf: ${job.title}, ${part.grams.toFixed(1)} g.`,
      'good',
    );
    return part;
  }

  loadSaved(part: SavedPart): void {
    this.invalidateAnalysis();
    this.jobId.value = jobById(part.job).id;
    this.material.value = materialById(part.material).id;
    this.params.value = jobById(part.job).clamp(part.params).params;
    this.selected.value = null;
    this.rollback.value = null;
    this.bound.value = [];
    this.loadN.value = this.job.loadCase(this.params.peek()).newtons;
    this.requestBuild();
  }

  removeSaved(id: string): void {
    this.library.value = this.library.peek().filter((p) => p.id !== id);
    saveLibrary(this.library.peek());
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
