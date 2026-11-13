/**
 * The workspace around the bench: proof and agent panels, the tool strip, the
 * feature-history rail, the dial's buttons, the share code, the coach and the
 * captions. Also places the bench in the room when a session starts and snaps
 * it onto a detected table.
 *
 * Layout is in bench coordinates (metres): the user sits at +Z, about 0.42 m
 * from the bench centre. Everything stays within about 35 degrees of the
 * bench, which fits the view of Quest 3 and the narrower Meta VR Glasses.
 */

import {
  createSystem,
  effect,
  Entity,
  Group,
  Quaternion,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import { AGENTS, Finding } from '../engine/agents.js';
import { dailyBrief } from '../engine/daily.js';
import { JOBS, paramDef } from '../engine/jobs.js';
import { MATERIALS } from '../engine/materials.js';
import { ctx } from '../app/context.js';
import { CSS } from '../app/palette.js';
import { today, Settings } from '../app/persistence.js';
import { Line, makeButton, setButton, setUiStyle, TextPanel, tickPanels } from '../app/ui3d.js';
import { drawQr } from '../flat/flat-ui.js';
import type { Mode } from '../app/app.js';
import { CALIBRATION_READINGS, CARD_MM } from '../engine/calibration.js';
import { CaptureSystem } from './capture-system.js';
import { FlowSystem } from './flow-system.js';
import { DrawingSystem } from './drawing-system.js';
import { HingeSystem } from './hinge-system.js';
import { ModeSystem } from './mode-system.js';
import { PrintSystem } from './print-system.js';

const FEATURE_NAMES: Record<string, string> = {
  'sketch.loops': 'Profile sketch',
  'sketch.rectangle': 'Rectangle sketch',
  'sketch.circle': 'Circle sketch',
  'sketch.profile': 'Half-profile sketch',
  'feature.extrude': 'Extrude',
  'feature.cut': 'Pocket cut',
  'feature.revolve': 'Revolve',
  'feature.hole': 'Holes',
  'feature.pattern.circular': 'Circular pattern',
  'feature.pattern.linear': 'Linear pattern',
  'ref.plane': 'Reference plane',
};

const COACH: { skill: string; text: string }[] = [
  { skill: 'shape', text: 'Pinch an amber handle and pull it.' },
  { skill: 'dial', text: 'Turn the dial ring, or swipe your thumb along your index finger: 0.05 mm per click.' },
  { skill: 'measure', text: 'Tap Measure, then pinch both ends of a real object.' },
  { skill: 'test', text: 'Tap Test, then push the part with an open palm.' },
  { skill: 'fix', text: 'Pinch a Fix on an agent card.' },
  { skill: 'save', text: 'Tap Save. The part goes on your shelf.' },
];

const SEVERITY_COLOR: Record<string, string> = {
  ok: CSS.green,
  info: CSS.cyan,
  warn: CSS.amber,
  fail: CSS.red,
};

const f1 = (v: number): string => v.toFixed(1);

export class WorkspaceSystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  private ui!: Group;
  private uiEntity!: Entity;
  private proof!: TextPanel;
  private agents!: TextPanel;
  private coach!: TextPanel;
  private caption!: TextPanel;
  private qr!: TextPanel;
  private qrCanvas!: HTMLCanvasElement;
  private qrOpen = false;
  private co!: TextPanel;
  private note!: TextPanel;
  private noteUntil = 0;
  private coCanvas!: HTMLCanvasElement;
  private coOpen = false;
  private settingsOpen = false;
  private captionText = '';
  private captionUntil = 0;
  private placedAt = -1;
  private snapped = false;
  private readonly head = new Vector3();
  private readonly fwd = new Vector3();
  private readonly q = new Quaternion();
  private readonly tmp = new Vector3();
  private elapsed = 0;
  private historyCount = 0;

  init(): void {
    const { app, bench, benchEntity, sfx } = ctx;
    this.ui = new Group();
    this.ui.name = 'Workspace UI';
    bench.root.add(this.ui);
    this.uiEntity = this.world.createTransformEntity(this.ui, { parent: benchEntity, persistent: true });

    // Panels turn to face the seated user's eyes: 0.34 m above and 0.42 m in front of the bench centre.
    bench.root.updateMatrixWorld(true);
    const eye = bench.root.localToWorld(new Vector3(0, 0.34, 0.42));
    const facing = (g: Group, x: number, y: number, z: number): void => {
      g.position.set(x, y, z);
      bench.root.add(g);
      g.updateMatrixWorld(true);
      g.lookAt(eye);
      bench.root.remove(g);
    };

    // ----- panels ------------------------------------------------------------
    this.proof = new TextPanel(0.22, 0.18, 'Proof panel');
    this.agents = new TextPanel(0.25, 0.24, 'Agents panel');
    this.coach = new TextPanel(0.27, 0.075, 'Coach panel');
    this.caption = new TextPanel(0.27, 0.034, 'Caption');
    this.qr = new TextPanel(0.2, 0.25, 'Share panel');
    this.qrCanvas = document.createElement('canvas');
    this.note = new TextPanel(0.3, 0.05, 'Notice panel');
    this.co = new TextPanel(0.2, 0.25, 'Co-design panel');
    this.coCanvas = document.createElement('canvas');
    for (const [p, x, y, z] of [
      [this.proof, -0.26, 0.14, -0.02],
      [this.agents, 0.27, 0.22, -0.02],
      [this.coach, 0, 0.27, -0.12],
      [this.caption, 0, 0.217, -0.11],
      [this.qr, 0.27, 0.22, -0.008],
      [this.co, 0.27, 0.22, -0.008],
      [this.note, 0, 0.33, -0.13],
    ] as [TextPanel, number, number, number][]) {
      facing(p.group, x, y, z);
      this.ui.add(p.group);
      this.world.createTransformEntity(p.group, { parent: this.uiEntity, persistent: true });
    }
    this.qr.group.visible = false;
    this.co.group.visible = false;
    this.note.group.visible = false;

    // ----- voice: a Talk button left of the tool strip ------------------------
    const talkGroup = new Group();
    talkGroup.position.set(-0.205, 0.012, 0.2);
    talkGroup.rotation.set(-0.95, 0, 0);
    this.ui.add(talkGroup);
    const talkEntity = this.world.createTransformEntity(talkGroup, { parent: this.uiEntity, persistent: true });
    makeButton(talkEntity, { key: 'act:talk', label: 'Talk', width: 0.058, height: 0.052, tone: 'primary' }, () => void ctx.talk()).position.set(0, 0.015, 0);
    this.caption.group.visible = false;

    // ----- fix buttons under the agent panel ---------------------------------
    const fixRow = new Group();
    facing(fixRow, 0.27, 0.083, -0.01);
    this.ui.add(fixRow);
    const fixEntity = this.world.createTransformEntity(fixRow, { parent: this.uiEntity, persistent: true });
    (['marcus', 'elena', 'viktor'] as const).forEach((agent, i) => {
      const b = makeButton(fixEntity, { key: `fix:${agent}`, label: `Fix (${AGENTS[agent].name})`, width: 0.25, height: 0.022, tone: 'warn' }, () => {
        const f = app.findings.peek().find((x) => x.agent === agent && x.fix);
        if (f) {
          sfx.play('fix');
          app.applyFix(f);
        }
      });
      b.position.set(0, -i * 0.025, 0);
    });
    const autoBtn = makeButton(fixEntity, { key: 'act:reinforce', label: 'Marcus: reinforce until it holds', width: 0.25, height: 0.022, tone: 'default' }, () => {
      sfx.play('solve');
      void app.autoReinforce();
    });
    autoBtn.position.set(0, -0.072, 0);

    // ----- tool strip in front of the bench ----------------------------------
    const strip = new Group();
    strip.position.set(0, 0.012, 0.2);
    strip.rotation.set(-0.95, 0, 0);
    this.ui.add(strip);
    const stripEntity = this.world.createTransformEntity(strip, { parent: this.uiEntity, persistent: true });
    // Four rows of at most five: about 0.31 m wide, so the strip stays within the
    // central view of Quest 3 and the narrower Meta VR Glasses.
    const row = (keys: [string, string, () => void, number?][], y: number): void => {
      const widths = keys.map((k) => k[3] ?? 0.058);
      const total = widths.reduce((a, b) => a + b, 0) + 0.006 * (keys.length - 1);
      let x = -total / 2;
      keys.forEach(([key, label, fn], i) => {
        const b = makeButton(stripEntity, { key, label, width: widths[i], height: 0.024 }, fn);
        b.position.set(x + widths[i] / 2, y, 0);
        x += widths[i] + 0.006;
      });
    };
    row(
      [
        ['mode:shape', 'Shape', () => this.setMode('shape')],
        ['mode:measure', 'Measure', () => this.setMode('measure')],
        ['mode:test', 'Test', () => this.setMode('test')],
        ['mode:sketch', 'Sketch', () => this.setMode('sketch')],
        ['mode:capture', 'Capture', () => this.setMode('capture')],
      ],
      0.045,
    );
    row(
      [
        ['act:grow', 'Grow bone', () => { if (app.grown.peek()) { app.clearGrown(); } else { sfx.play('grow'); void app.grow(0.55); } }],
        ['act:flow', 'Air flow', () => this.world.getSystem(FlowSystem)?.toggle()],
        ['act:modes', 'Vibration', () => this.world.getSystem(ModeSystem)?.toggle()],
        ['act:print', 'Print preview', () => this.world.getSystem(PrintSystem)?.toggle()],
        ['act:swing', 'Swing', () => this.world.getSystem(HingeSystem)?.toggle()],
      ],
      0.015,
    );
    row(
      [
        ['act:job', 'Next part', () => this.nextJob(), 0.052],
        ['act:mat', 'PLA', () => this.nextMaterial(), 0.052],
        ['act:save', 'Save', () => { if (app.save()) sfx.play('save'); }, 0.052],
        ['act:share', 'Share', () => { this.qrOpen = !this.qrOpen; this.coOpen = false; this.refreshShare(); }, 0.052],
        ['act:co', 'Co-design', () => { this.coOpen = !this.coOpen; this.qrOpen = false; this.refreshShare(); }, 0.052],
        ['act:drawing', 'Drawing', () => void this.world.getSystem(DrawingSystem)?.toggle(), 0.052],
      ],
      -0.015,
    );
    row(
      [
        ['act:undo', 'Undo', () => app.undo(), 0.05],
        ['act:redo', 'Redo', () => app.redo(), 0.05],
        ['act:daily', 'Daily job', () => app.startDaily()],
        ['act:place', 'Bring bench here', () => this.place(), 0.08],
        ['act:settings', 'Access', () => { this.settingsOpen = !this.settingsOpen; this.refreshSettings(); }],
      ],
      -0.045,
    );

    // ----- accessibility settings (a second strip, shown on demand) ----------
    const settingsStrip = new Group();
    settingsStrip.position.set(0.215, 0.012, 0.19);
    settingsStrip.rotation.set(-0.95, -0.35, 0, 'YXZ');
    this.ui.add(settingsStrip);
    const setEntity = this.world.createTransformEntity(settingsStrip, { parent: this.uiEntity, persistent: true });
    const toggles: [keyof Settings, string][] = [
      ['colorSafe', 'Colour-safe'],
      ['captions', 'Captions'],
      ['sound', 'Sound'],
      ['dwell', 'Dwell select'],
      ['largeText', 'Large text'],
      ['highContrast', 'Contrast'],
      ['reduceMotion', 'Less motion'],
      ['handed', 'Left-handed'],
      ['occlusion', 'Real occlusion'],
    ];
    toggles.forEach(([key, label], i) => {
      const b = makeButton(setEntity, { key: `set:${key}`, label, width: 0.06, height: 0.022 }, () => {
        const s = app.settings.peek();
        if (key === 'handed') {
          app.setSetting('handed', s.handed === 'left' ? 'right' : 'left');
        } else {
          app.setSetting(key, !s[key] as never);
        }
      });
      b.position.set((i % 2) * 0.066 - 0.033, 0.042 - Math.floor(i / 2) * 0.028, 0);
    });
    makeButton(setEntity, { key: 'act:calib', label: 'Calibrate with a card', width: 0.126, height: 0.022, tone: 'default' }, () => {
      this.settingsOpen = false;
      this.refreshSettings();
      app.startCalibration();
    }).position.set(0, 0.042 - 5 * 0.028, 0);

    // ----- coach skip --------------------------------------------------------
    const coachBtns = new Group();
    facing(coachBtns, 0.115, 0.218, -0.1);
    this.ui.add(coachBtns);
    const coachEntity = this.world.createTransformEntity(coachBtns, { parent: this.uiEntity, persistent: true });
    makeButton(coachEntity, { key: 'coach:skip', label: 'Skip', width: 0.035, height: 0.018, tone: 'ghost' }, () => app.finishCoach());

    // ----- share close -------------------------------------------------------
    const shareBtns = new Group();
    facing(shareBtns, 0.27, 0.083, 0.0);
    this.ui.add(shareBtns);
    const shareEntity = this.world.createTransformEntity(shareBtns, { parent: this.uiEntity, persistent: true });
    makeButton(shareEntity, { key: 'share:close', label: 'Close', width: 0.06, height: 0.022 }, () => {
      this.qrOpen = false;
      this.refreshShare();
    });

    // ----- co-design: room buttons and a keypad for a partner's code ---------
    const { codesign } = ctx;
    const coBtns = new Group();
    facing(coBtns, 0.27, 0.083, 0.0);
    this.ui.add(coBtns);
    const coEntity = this.world.createTransformEntity(coBtns, { parent: this.uiEntity, persistent: true });
    makeButton(coEntity, { key: 'co:host', label: 'Start a room', width: 0.09, height: 0.022, tone: 'default' }, () => {
      sfx.play('select');
      void codesign.host();
    }).position.set(-0.05, 0, 0);
    makeButton(coEntity, { key: 'co:leave', label: 'Leave room', width: 0.09, height: 0.022, tone: 'warn' }, () => codesign.leave()).position.set(-0.05, 0, 0);
    makeButton(coEntity, { key: 'co:close', label: 'Close', width: 0.06, height: 0.022 }, () => {
      this.coOpen = false;
      this.refreshShare();
    }).position.set(0.06, 0, 0);
    const keypad = new Group();
    facing(keypad, 0.27, 0.152, -0.002);
    this.ui.add(keypad);
    const padEntity = this.world.createTransformEntity(keypad, { parent: this.uiEntity, persistent: true });
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'join'].forEach((k, i) => {
      const label = k === 'del' ? 'Del' : k === 'join' ? 'Join' : k;
      makeButton(padEntity, { key: `co:k${k}`, label, width: 0.04, height: 0.024, tone: k === 'join' ? 'default' : 'ghost', poke: true }, () => {
        sfx.play('select');
        codesign.key(k);
      }).position.set(((i % 3) - 1) * 0.046, 0.042 - Math.floor(i / 3) * 0.028, 0);
    });

    // ----- history rail ------------------------------------------------------
    const rail = new Group();
    rail.position.set(-0.26, 0.026, 0.0);
    rail.rotation.set(0, Math.atan2(0.26, 0.42), 0);
    this.ui.add(rail);
    const railEntity = this.world.createTransformEntity(rail, { parent: this.uiEntity, persistent: true });
    for (let k = 1; k <= 6; k++) {
      const b = makeButton(railEntity, { key: `hist:${k}`, label: `${k}`, width: 0.026, height: 0.022 }, () => {
        sfx.play('select');
        app.setRollback(k >= this.historyCount ? null : k);
      });
      b.position.set(-0.08 + (k - 1) * 0.032, 0, 0);
    }

    // ----- reactions ---------------------------------------------------------
    sfx.onCaption = (text) => {
      this.captionText = text;
      this.captionUntil = this.elapsed + 2.5;
    };

    this.cleanupFuncs.push(
      effect(() => this.drawProof()),
      effect(() => this.drawAgents()),
      effect(() => this.drawCoach()),
      effect(() => this.refreshTools()),
      effect(() => this.drawCo()),
      effect(() => {
        // Every notice (results, replies) shows in the room for a few seconds.
        const n = app.notice.value;
        if (!n) return;
        const color = n.tone === 'good' ? CSS.green : n.tone === 'warn' ? CSS.amber : n.tone === 'bad' ? CSS.red : CSS.cyan;
        this.note.draw([{ text: n.text, size: 3.8, weight: 600 }], color);
        this.noteUntil = this.elapsed + Math.min(10, 5 + n.text.length / 20);
      }),
      effect(() => {
        // The Talk button shows what the voice layer is doing; the panel shows what it heard.
        const v = ctx.voice;
        const st = v.state.value;
        const heard = v.heard.value;
        const pct = v.loading.value;
        setButton('act:talk', {
          toggled: st === 'listening',
          label: st === 'listening' ? 'Listening' : st === 'thinking' ? 'Thinking' : st === 'loading' ? `Voice ${pct}%` : 'Talk',
        });
        if (st === 'listening' || st === 'thinking') {
          this.note.draw([{ text: heard ? `"${heard}"` : st === 'listening' ? 'Listening... say a command' : 'Working it out...', size: 3.6, weight: 600, color: CSS.text }], CSS.violet);
          this.noteUntil = this.elapsed + 30;
        }
      }),
      effect(() => {
        const s = app.settings.value;
        setUiStyle(s.highContrast, s.largeText ? 1.25 : 1);
        sfx.enabled = s.sound;
        this.refreshSettings();
        this.drawProof();
        this.drawAgents();
        this.drawCoach();
      }),
      effect(() => {
        void app.params.value;
        void app.jobId.value;
        void app.material.value;
        if (this.qrOpen) this.refreshShare();
      }),
      this.world.visibilityState.subscribe((state) => {
        // The flat page has its own interface; the spatial one belongs to the session.
        this.ui.visible = state !== VisibilityState.NonImmersive;
        if (state === VisibilityState.Visible && this.placedAt < 0) {
          this.placedAt = 0;
        }
        if (state === VisibilityState.NonImmersive) {
          this.placedAt = -1;
          this.snapped = false;
        }
      }),
    );
    this.refreshShare();
    this.refreshSettings();
  }

  // ----- actions ---------------------------------------------------------------

  private setMode(mode: Mode): void {
    const { app } = ctx;
    // Measure again while measuring: switch between fingers and the laser tape.
    if (mode === 'measure' && app.mode.peek() === 'measure') {
      app.laser.value = !app.laser.peek();
      return;
    }
    if (mode !== 'measure') app.laser.value = false;
    app.mode.value = mode;
    if (mode === 'test' && !app.stress.peek() && !app.busy.peek()) {
      ctx.sfx.play('solve');
      void app.runTest();
    }
  }

  private nextJob(): void {
    const { app } = ctx;
    const i = JOBS.findIndex((j) => j.id === app.jobId.peek());
    app.selectJob(JOBS[(i + 1) % JOBS.length].id);
  }

  private nextMaterial(): void {
    const { app } = ctx;
    const i = MATERIALS.findIndex((m) => m.id === app.material.peek());
    app.setMaterial(MATERIALS[(i + 1) % MATERIALS.length].id);
  }

  /** Put the bench in front of the user, at a comfortable seated height. */
  place(): void {
    const { bench } = ctx;
    const head = this.player.head;
    head.getWorldPosition(this.head);
    head.getWorldQuaternion(this.q);
    this.fwd.set(0, 0, -1).applyQuaternion(this.q);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-6) {
      this.fwd.set(0, 0, -1);
    }
    this.fwd.normalize();
    bench.root.position.set(
      this.head.x + this.fwd.x * 0.42,
      this.head.y - 0.34,
      this.head.z + this.fwd.z * 0.42,
    );
    bench.root.rotation.set(0, Math.atan2(-this.fwd.x, -this.fwd.z), 0);
    bench.root.updateMatrixWorld(true);
    this.snapped = false;
    this.placedAt = this.elapsed;
    // No XRAnchor here: IWSDK's anchored group restores an earlier session's
    // pose, which moved the bench out of view. The bench is placed relative to
    // the user each session, in the session's local-floor space.
  }

  /** Lower or raise the bench onto a detected horizontal surface under it. */
  private snapToTable(): boolean {
    const { bench } = ctx;
    const root = bench.root;
    let best: number | null = null;
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlane, '_plane') as { orientation?: string } | undefined;
      const obj = e.object3D;
      if (!plane || !obj || plane.orientation !== 'horizontal') {
        continue;
      }
      obj.getWorldPosition(this.tmp);
      const dx = this.tmp.x - root.position.x;
      const dz = this.tmp.z - root.position.z;
      const below = this.head.y - this.tmp.y;
      if (below < 0.25 || below > 0.9 || Math.hypot(dx, dz) > 1.2) {
        continue;
      }
      if (best === null || this.tmp.y > best) {
        best = this.tmp.y;
      }
    }
    if (best === null) {
      return false;
    }
    root.position.y = best + 0.006;
    root.updateMatrixWorld(true);
    ctx.app.say('Bench placed on your table.', 'good');
    return true;
  }

  // ----- drawing -----------------------------------------------------------------

  private drawProof(): void {
    const { app } = ctx;
    const built = app.built.value;
    const refusal = app.refusal.value;
    const rolled = app.rollback.value;
    const mat = MATERIALS.find((m) => m.id === app.material.value) ?? MATERIALS[0];
    const job = JOBS.find((j) => j.id === app.jobId.value) ?? JOBS[0];
    const grown = app.grown.value;
    const lines: Line[] = [{ text: 'TRUTH GATE', size: 3.4, color: CSS.cyan, weight: 700 }, { text: job.title, size: 6, weight: 700, gapAfter: 1 }];
    let accent: string = CSS.cyan;
    if (refusal) {
      accent = CSS.red;
      lines.push({ text: 'Refused', band: 'rgba(255,77,79,0.25)', weight: 700 }, { text: refusal, size: 3.6, color: CSS.dim });
    } else if (!built) {
      lines.push({ text: 'Building...' });
    } else if (rolled !== null) {
      accent = CSS.violet;
      lines.push(
        { text: `History: ${built.applied} of ${built.features.length}`, band: 'rgba(155,123,255,0.22)', weight: 700 },
        { text: FEATURE_NAMES[built.features[built.applied - 1]?.op] ?? '', color: CSS.dim },
        { text: 'A rolled-back view is not judged.', size: 3.6, color: CSS.dim },
      );
    } else {
      const g = built.gate;
      accent = g.verdict === 'verified' ? CSS.green : g.verdict === 'refused' ? CSS.red : CSS.amber;
      lines.push({
        text: g.verdict === 'verified' ? 'Verified' : g.verdict === 'refused' ? 'Refused' : 'Kernel only',
        band: g.verdict === 'verified' ? 'rgba(61,220,132,0.22)' : g.verdict === 'refused' ? 'rgba(255,77,79,0.25)' : 'rgba(255,176,32,0.2)',
        weight: 700,
        gapAfter: 1,
      });
      const form = g.checks.find((c) => c.id === 'job-formula') ?? g.checks.find((c) => c.id === 'closed-form');
      const expected = form?.detail.match(/expected ([\d.]+)/u)?.[1];
      lines.push(
        { text: 'Closed form', value: expected ? `${Number(expected).toFixed(2)} mm3` : 'n/a', size: 4 },
        { text: 'Kernel', value: `${built.props.volume.toFixed(2)} mm3`, size: 4 },
        { text: 'Difference', value: form?.delta !== undefined ? form.delta.toExponential(1) : '-', size: 4, valueColor: accent },
      );
      if (g.verdict === 'refused' && g.reason) {
        lines.push({ text: g.reason, size: 3.4, color: CSS.red });
      }
      const b = built.props.bbox;
      const vol = grown?.final ? grown.props.volume : built.props.volume;
      lines.push(
        { text: 'Size', value: `${f1(b.max[0] - b.min[0])} x ${f1(b.max[1] - b.min[1])} x ${f1(b.max[2] - b.min[2])}`, size: 4 },
        { text: grown?.final ? 'Mass (grown)' : 'Mass', value: `${((vol / 1000) * mat.density).toFixed(1)} g ${mat.name.split(' ')[0]}`, size: 4 },
      );
    }
    this.proof.draw(lines, accent);
    this.historyCount = built?.features.length ?? 0;
    for (let k = 1; k <= 6; k++) {
      const visible = k <= this.historyCount;
      setButton(`hist:${k}`, {
        visible,
        toggled: visible && (rolled === null ? k === this.historyCount : k === rolled),
      });
    }
  }

  private drawAgents(): void {
    const { app } = ctx;
    const findings = app.findings.value;
    const busy = app.busy.value;
    const stress = app.stress.value;
    const log = app.agentLog.value;
    const lines: Line[] = [{ text: 'AGENTS', size: 3.4, color: CSS.cyan, weight: 700, gapAfter: 1 }];
    const head = (agent: Finding['agent']) => findings.find((f) => f.agent === agent);
    for (const agent of ['marcus', 'elena', 'viktor'] as const) {
      const f = head(agent);
      if (!f) continue;
      lines.push(
        { text: `${AGENTS[agent].name}  ${f.title}`, size: 4.3, weight: 700, color: SEVERITY_COLOR[f.severity] },
        { text: f.detail, size: 3.3, color: CSS.dim, gapAfter: 1.5 },
      );
      setButton(`fix:${agent}`, { visible: !!f.fix && !busy, label: f.fix ? `Fix: ${f.fix.label}` : '' });
    }
    if (busy) {
      lines.push({ text: `${busy.label}${busy.progress >= 0 ? ` ${(busy.progress * 100).toFixed(0)} %` : '...'}`, size: 3.8, color: CSS.amber });
    } else if (log.length) {
      lines.push({ text: log[log.length - 1], size: 3.6, color: CSS.green });
    } else if (stress) {
      const sf = app.factor();
      lines.push({
        text: `${stress.loadLabel}: ${app.loadN.value.toFixed(0)} N, factor ${sf === null ? '-' : sf.toFixed(2)}`,
        size: 3.6,
        color: sf !== null && sf < 1 ? CSS.red : CSS.text,
      });
    }
    this.agents.draw(lines, CSS.cyan);
    const m = head('marcus');
    setButton('act:reinforce', { visible: !busy && !!m && (m.severity === 'fail' || m.severity === 'warn') && !!stress });
    for (const k of ['fix:marcus', 'fix:elena', 'fix:viktor', 'act:reinforce']) {
      if (this.qrOpen || this.coOpen) setButton(k, { visible: false });
    }
  }

  private drawCoach(): void {
    const { app } = ctx;
    const p = app.progress.value;
    const mode = app.mode.value;
    const job = JOBS.find((j) => j.id === app.jobId.value) ?? JOBS[0];
    const lines: Line[] = [];
    if (mode === 'capture') {
      void app.coachTick.value;
      const step = this.world.getSystem(CaptureSystem)?.prompt ?? '';
      lines.push(
        { text: 'CAPTURE A REAL OBJECT', size: 3.2, color: CSS.cyan, weight: 700 },
        { text: step, size: 4.2, weight: 600 },
      );
      this.coach.draw(lines, CSS.cyan);
      setButton('coach:skip', { visible: false });
      return;
    }
    if (mode === 'sketch') {
      lines.push(
        { text: 'AIR SKETCH', size: 3.2, color: CSS.amber, weight: 700 },
        { text: 'Pinch just above the bench and draw a closed outline. Let go to finish.', size: 4.2, weight: 600 },
      );
      this.coach.draw(lines, CSS.amber);
      setButton('coach:skip', { visible: false });
      return;
    }
    const calibrating = app.calibrating.value;
    if (mode === 'measure' && calibrating) {
      lines.push(
        { text: `CALIBRATE  ${calibrating.readings.length + 1} OF ${CALIBRATION_READINGS}`, size: 3.2, color: CSS.violet, weight: 700 },
        { text: `Measure the long edge of a bank card: ${CARD_MM.toFixed(2)} mm.`, size: 4.4, weight: 600 },
      );
      this.coach.draw(lines, CSS.violet);
      setButton('coach:skip', { visible: false });
      return;
    }
    if (mode === 'measure' && app.laser.value) {
      lines.push(
        { text: 'LASER TAPE', size: 3.2, color: CSS.amber, weight: 700 },
        { text: 'Point at a real surface and pinch, then pinch the other end. Press Laser again for finger measuring.', size: 4, weight: 600 },
      );
      this.coach.draw(lines, CSS.amber);
      setButton('coach:skip', { visible: false });
      return;
    }
    if (mode === 'measure') {
      const target = app.selected.value ? paramDef(job, app.selected.value) : undefined;
      const def = target?.measure ? target : job.params.find((d) => d.measure);
      lines.push(
        { text: 'MEASURE', size: 3.2, color: CSS.cyan, weight: 700 },
        { text: def?.prompt ?? 'This part has nothing to measure.', size: 4.4, weight: 600 },
      );
      this.coach.draw(lines, CSS.cyan);
      setButton('coach:skip', { visible: false });
      return;
    }
    if (!p.coachDone) {
      const step = COACH.findIndex((c) => !(p.skills as Record<string, number | undefined>)[c.skill]);
      if (step < 0) {
        app.finishCoach();
        return;
      }
      lines.push(
        { text: `GETTING STARTED  ${step + 1} OF ${COACH.length}`, size: 3.2, color: CSS.amber, weight: 700 },
        { text: COACH[step].text, size: 4.6, weight: 600 },
      );
      this.coach.draw(lines, CSS.amber);
      setButton('coach:skip', { visible: true });
      return;
    }
    const brief = dailyBrief(today());
    lines.push(
      { text: p.dailyDone === brief.date ? `DAILY JOB DONE  (${p.dailyCount} so far)` : 'DAILY JOB', size: 3.2, color: CSS.green, weight: 700 },
      { text: brief.text, size: 4.4, weight: 600 },
    );
    this.coach.draw(lines, CSS.green);
    setButton('coach:skip', { visible: false });
  }

  private refreshTools(): void {
    const { app } = ctx;
    const mode = app.mode.value;
    const busy = app.busy.value;
    const grown = app.grown.value;
    const mat = MATERIALS.find((m) => m.id === app.material.value) ?? MATERIALS[0];
    setButton('mode:shape', { toggled: mode === 'shape' });
    setButton('mode:measure', { toggled: mode === 'measure', label: mode === 'measure' && app.laser.value ? 'Laser' : 'Measure' });
    setButton('mode:test', { toggled: mode === 'test' });
    setButton('mode:sketch', { toggled: mode === 'sketch' });
    setButton('mode:capture', { toggled: mode === 'capture' });
    setButton('act:swing', { visible: app.jobId.value === 'hinge' });
    setButton('act:undo', { disabled: !app.history.canUndo.value });
    setButton('act:redo', { disabled: !app.history.canRedo.value });
    setButton('act:grow', { label: grown ? 'Back to solid' : 'Grow bone', disabled: busy !== null && busy.kind !== 'grow' });
    setButton('act:mat', { label: mat.name.split(' ')[0] });
    setButton('act:save', { disabled: app.built.value?.gate.verdict === 'refused' });
  }

  private drawCo(): void {
    const { codesign } = ctx;
    const status = codesign.status.value;
    const code = codesign.code.value;
    const typed = codesign.typed.value;
    const error = codesign.error.value;
    const role = codesign.role.value;
    const open = this.coOpen;
    setButton('act:co', { toggled: open || status === 'connected', label: status === 'connected' ? 'Co-design on' : 'Co-design' });
    const inRoom = status === 'waiting' || status === 'connected' || status === 'starting' || status === 'joining';
    setButton('co:host', { visible: open && !inRoom });
    setButton('co:leave', { visible: open && inRoom });
    setButton('co:close', { visible: open });
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'join']) {
      setButton(`co:k${k}`, { visible: open && !inRoom, disabled: k === 'join' && typed.length !== 6 });
    }
    if (!open) return;
    const spaced = (c: string): string => `${c.slice(0, 3)} ${c.slice(3)}`;
    const lines: Line[] = [{ text: 'CO-DESIGN', size: 3.2, color: CSS.violet, weight: 700 }];
    let accent: string = CSS.violet;
    if (status === 'waiting' && code) {
      lines.push(
        { text: `Room ${spaced(code)}`, size: 7, weight: 700 },
        { text: 'Your partner types this code on their bench, or scans this from a phone or PC.', size: 3.3, color: CSS.dim },
      );
      drawQr(this.coCanvas, codesign.joinUrl(code), 300);
      this.co.draw(lines, accent);
      this.co.drawImage(this.coCanvas, 112, 100);
      return;
    }
    if (status === 'connected') {
      accent = CSS.green;
      lines.push(
        { text: 'Connected', band: 'rgba(61,220,132,0.22)', weight: 700, gapAfter: 1 },
        { text: role === 'host' ? `Room ${spaced(code ?? '')}. You started it.` : `Room ${spaced(code ?? '')}. You joined.`, size: 3.6 },
        { text: 'One shared part. Changes either of you make appear on both benches. Your partner sits across the bench; their fingertips show in violet.', size: 3.4, color: CSS.dim },
        { text: 'Load tests run on each bench separately, on the same part.', size: 3.2, color: CSS.dim },
      );
    } else if (status === 'starting' || status === 'joining') {
      lines.push({ text: status === 'starting' ? 'Opening a room...' : `Joining ${spaced(code ?? '')}...`, size: 4.4, weight: 600 });
    } else {
      lines.push(
        { text: 'Start a room, or type your partner\'s code:', size: 3.6 },
        { text: typed.padEnd(6, '_').split('').join(' '), size: 7, weight: 700, color: CSS.amber },
      );
      if (error) {
        accent = CSS.red;
        lines.push({ text: error, size: 3.2, color: CSS.red });
      }
    }
    this.co.draw(lines, accent);
  }

  private refreshShare(): void {
    this.qr.group.visible = this.qrOpen;
    this.co.group.visible = this.coOpen;
    this.agents.group.visible = !this.qrOpen && !this.coOpen;
    setButton('share:close', { visible: this.qrOpen });
    setButton('act:share', { toggled: this.qrOpen });
    setButton('act:reinforce', { visible: false });
    this.drawCo();
    if (this.coOpen) {
      for (const k of ['fix:marcus', 'fix:elena', 'fix:viktor']) setButton(k, { visible: false });
      return;
    }
    if (!this.qrOpen) {
      this.drawAgents();
      return;
    }
    for (const k of ['fix:marcus', 'fix:elena', 'fix:viktor']) setButton(k, { visible: false });
    drawQr(this.qrCanvas, ctx.app.shareUrl(), 400);
    this.qr.draw([
      { text: 'TAKE IT WITH YOU', size: 3.2, color: CSS.cyan, weight: 700 },
      { text: 'Scan with a phone camera.', size: 3.6, color: CSS.dim },
    ]);
    this.qr.drawImage(this.qrCanvas, 22, 120);
    ctx.app.award('save');
  }

  private refreshSettings(): void {
    const s = ctx.app.settings.peek();
    setButton('act:settings', { toggled: this.settingsOpen });
    setButton('act:calib', { visible: this.settingsOpen });
    for (const key of ['colorSafe', 'captions', 'sound', 'dwell', 'largeText', 'highContrast', 'reduceMotion', 'handed', 'occlusion'] as const) {
      setButton(`set:${key}`, {
        visible: this.settingsOpen,
        toggled: key === 'handed' ? s.handed === 'left' : Boolean(s[key]),
      });
    }
  }

  update(delta: number): void {
    this.elapsed += delta;
    if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      return;
    }
    tickPanels(delta, ctx.app.settings.peek().reduceMotion);
    const showNote = this.elapsed < this.noteUntil;
    if (showNote !== this.note.group.visible) this.note.group.visible = showNote;
    // Place the bench once the head pose has settled, then look for a table for a few seconds.
    if (this.placedAt === 0 && this.elapsed > 0.6) {
      this.place();
    } else if (this.placedAt > 0 && !this.snapped && this.elapsed - this.placedAt < 6) {
      this.snapped = this.snapToTable();
    }
    const show = ctx.app.settings.peek().captions && this.elapsed < this.captionUntil;
    if (show !== this.caption.group.visible) {
      this.caption.group.visible = show;
    }
    if (show) {
      this.caption.draw([{ text: this.captionText, size: 3.6, color: CSS.text }], CSS.dim);
    }
  }
}
