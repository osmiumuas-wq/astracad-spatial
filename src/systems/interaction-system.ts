/**
 * The bench's own hand gestures, built on raw joint data (src/app/hands.ts):
 *
 * - shape: pinch an amber handle and pull (1 mm steps); pinch the dial ring and
 *   turn it (0.05 mm per click); pinch the bench rim and swing it to turn the
 *   part; slide a flat open hand through the part to slice it open.
 * - measure: hold a real object between thumb and finger (span), or pinch its
 *   two ends with both hands (tape); hold still to lock. One-handed users pinch
 *   the two ends one after the other.
 * - test: push the part with an open palm. The first touch runs a solve at the
 *   contact; pushing deeper raises the load and the stress map follows.
 *
 * Every gesture also has a pointer path (rays, gaze, mouse) through buttons.
 */

import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  createSystem,
  Entity,
  Group,
  Hovered,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Quaternion,
  Raycaster,
  RayInteractable,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { UiButton } from '../components.js';
import { handleGain, paramDef } from '../engine/jobs.js';
import { ctx, probe } from '../app/context.js';
import { HandState, Side } from '../app/hands.js';
import { faceViewer, TextLabel } from '../app/labels.js';
import { COLORS, CSS } from '../app/palette.js';
import { makeButton, registerAction, setButton } from '../app/ui3d.js';

const MAX_HANDLES = 6;
const GRAB_RADIUS = 0.03;
const DIAL_RADIUS = 0.032;
const DETENT_DEG = 10;
const SAMPLE_WINDOW_S = 0.9;
const SAMPLES = 160;
/** Samples are taken at most this often, so the window length does not depend on frame rate, s. */
const SAMPLE_DT = 1 / 90;
/** Joint centres sit inside the hand: the palm's skin is about this far below them, m. */
const PALM_SKIN = 0.014;

type Grab =
  | { kind: 'handle'; side: Side; index: number; param: string; start: Vector3; startValue: number; last: number; limited: boolean }
  | { kind: 'dial'; side: Side; angle: number; acc: number }
  | { kind: 'rim'; side: Side; angle: number };

interface HandleVis {
  group: Group;
  ball: Mesh<SphereGeometry, MeshBasicMaterial>;
  cone: Mesh<ConeGeometry, MeshBasicMaterial>;
  entity: Entity;
  param: string;
}

/** Rolling window of measurement samples (value in mm, time in s). */
class Samples {
  private readonly v = new Float32Array(SAMPLES);
  private readonly t = new Float32Array(SAMPLES);
  private n = 0;
  private head = 0;

  clear(): void {
    this.n = 0;
    this.head = 0;
    this.last = -1;
  }

  private last = -1;

  push(value: number, time: number): void {
    if (this.n > 0 && time - this.last < SAMPLE_DT) return;
    this.last = time;
    this.v[this.head] = value;
    this.t[this.head] = time;
    this.head = (this.head + 1) % SAMPLES;
    this.n = Math.min(SAMPLES, this.n + 1);
  }

  /** Mean, standard deviation and range of the samples inside the window, if it is full enough. */
  stats(now: number): { mean: number; sd: number; range: number; span: number; count: number } | null {
    let count = 0;
    let sum = 0;
    let lo = Infinity;
    let hi = -Infinity;
    let oldest = now;
    for (let i = 0; i < this.n; i++) {
      if (now - this.t[i] > SAMPLE_WINDOW_S) continue;
      count++;
      sum += this.v[i];
      lo = Math.min(lo, this.v[i]);
      hi = Math.max(hi, this.v[i]);
      oldest = Math.min(oldest, this.t[i]);
    }
    if (count < 8) return null;
    const mean = sum / count;
    let ss = 0;
    for (let i = 0; i < this.n; i++) {
      if (now - this.t[i] > SAMPLE_WINDOW_S) continue;
      ss += (this.v[i] - mean) ** 2;
    }
    return { mean, sd: Math.sqrt(ss / Math.max(1, count - 1)), range: hi - lo, span: now - oldest, count };
  }
}

export class InteractionSystem extends createSystem({
  hoveredHandles: { required: [UiButton, Hovered] },
}) {
  private handles: HandleVis[] = [];
  private handleLabel!: TextLabel;
  private dial!: Group;
  private dialTicks!: Group;
  private dialLabel!: TextLabel;
  private caliper!: Line<BufferGeometry, LineBasicMaterial>;
  private caliperEnds!: Mesh<SphereGeometry, MeshBasicMaterial>[];
  private caliperLabel!: TextLabel;
  private pushLabel!: TextLabel;
  private grab: Grab | null = null;
  private time = 0;
  private readonly samples = new Samples();
  private lockedUntil = 0;
  private needRearm = false;
  private tapeA: Vector3 | null = null;
  private tapeSum = new Vector3();
  private tapeCount = 0;
  private measureQueue: string[] = [];
  private pushSide: Side | null = null;
  private pushPoint = new Vector3();
  private pushPending = false;
  private yielded = false;
  private lastRefresh = 0;
  private readonly microLeft = new Uint8Array(10);
  private readonly microRight = new Uint8Array(10);
  private sliceHold = 0;
  private slicing = false;
  private readonly clip = new Plane();
  private readonly ray = new Raycaster();
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  private readonly v3 = new Vector3();
  private readonly q1 = new Quaternion();

  init(): void {
    const { bench, app } = ctx;
    const ballGeo = new SphereGeometry(0.0062, 20, 14);
    const coneGeo = new ConeGeometry(0.0045, 0.011, 16);
    for (let i = 0; i < MAX_HANDLES; i++) {
      const group = new Group();
      group.name = `Handle ${i}`;
      const ball = new Mesh(ballGeo, new MeshBasicMaterial({ color: COLORS.amber, toneMapped: false }));
      const cone = new Mesh(coneGeo, new MeshBasicMaterial({ color: COLORS.amber, toneMapped: false, transparent: true, opacity: 0.8 }));
      cone.position.y = 0.012;
      group.add(ball, cone);
      group.visible = false;
      bench.turntable.add(group);
      const entity = this.world.createTransformEntity(group, { parent: ctx.turntableEntity, persistent: true });
      entity.addComponent(RayInteractable);
      entity.addComponent(UiButton, { key: `handle:${i}` });
      const vis: HandleVis = { group, ball, cone, entity, param: '' };
      registerAction(`handle:${i}`, () => {
        if (vis.param) {
          app.selected.value = vis.param;
          app.mode.value = 'shape';
          ctx.sfx.play('select');
        }
      });
      this.handles.push(vis);
    }
    this.handleLabel = new TextLabel(0.013);
    this.handleLabel.visible = false;
    bench.root.add(this.handleLabel.mesh);

    // ----- dial ----------------------------------------------------------------
    this.dial = new Group();
    this.dial.name = 'Micrometer dial';
    this.dial.position.set(0.19, 0.075, 0.075);
    this.dial.rotation.set(-0.35, Math.atan2(-0.19, 0.345), 0, 'YXZ');
    const ring = new Mesh(
      new TorusGeometry(DIAL_RADIUS, 0.0035, 12, 72),
      new MeshBasicMaterial({ color: COLORS.cyan, toneMapped: false, transparent: true, opacity: 0.85 }),
    );
    this.dialTicks = new Group();
    const tickGeo = new SphereGeometry(0.0016, 8, 6);
    const tickMat = new MeshBasicMaterial({ color: COLORS.white, toneMapped: false });
    for (let i = 0; i < 36; i++) {
      const t = new Mesh(tickGeo, tickMat);
      const a = (i * 10 * Math.PI) / 180;
      t.position.set(Math.cos(a) * DIAL_RADIUS, Math.sin(a) * DIAL_RADIUS, 0.004);
      t.scale.setScalar(i % 9 === 0 ? 1.8 : 1);
      this.dialTicks.add(t);
    }
    this.dial.add(ring, this.dialTicks);
    this.dialLabel = new TextLabel(0.012);
    this.dial.add(this.dialLabel.mesh);
    this.dial.visible = false;
    bench.root.add(this.dial);
    const dialEntity = this.world.createTransformEntity(this.dial, { parent: ctx.benchEntity, persistent: true });
    const step = (detents: number, coarse: boolean) => () => {
      const id = app.selected.peek();
      if (id) {
        app.nudge(id, detents, coarse);
        ctx.sfx.play(coarse ? 'step' : 'tick');
        app.award('dial');
      }
    };
    (
      [
        ['dial:--', '-1', -1, true],
        ['dial:-', '-.05', -1, false],
        ['dial:+', '+.05', 1, false],
        ['dial:++', '+1', 1, true],
      ] as [string, string, number, boolean][]
    ).forEach(([key, label, d, coarse], i) => {
      const b = makeButton(dialEntity, { key, label, width: 0.022, height: 0.017, poke: true }, step(d, coarse));
      b.position.set((i - 1.5) * 0.024, -DIAL_RADIUS - 0.018, 0);
    });
    const close = makeButton(dialEntity, { key: 'dial:close', label: 'Done', width: 0.03, height: 0.015, tone: 'ghost' }, () => {
      app.selected.value = null;
    });
    close.position.set(0, DIAL_RADIUS + 0.03, 0);

    // ----- caliper -------------------------------------------------------------
    const lineGeo = new BufferGeometry();
    lineGeo.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    this.caliper = new Line(lineGeo, new LineBasicMaterial({ color: COLORS.cyan, toneMapped: false, depthTest: false }));
    this.caliper.frustumCulled = false;
    this.caliper.renderOrder = 30;
    this.caliper.visible = false;
    const endGeo = new SphereGeometry(0.003, 12, 8);
    this.caliperEnds = [0, 1].map(() => {
      const m = new Mesh(endGeo, new MeshBasicMaterial({ color: COLORS.cyan, toneMapped: false, depthTest: false }));
      m.renderOrder = 30;
      m.visible = false;
      return m;
    });
    this.caliperLabel = new TextLabel(0.016);
    this.caliperLabel.visible = false;
    this.pushLabel = new TextLabel(0.015);
    this.pushLabel.visible = false;
    for (const o of [this.caliper, ...this.caliperEnds, this.caliperLabel.mesh, this.pushLabel.mesh]) {
      this.world.createTransformEntity(o, { persistent: true });
    }

    this.cleanupFuncs.push(
      app.mode.subscribe((mode) => {
        this.endGrab();
        this.samples.clear();
        this.tapeA = null;
        this.needRearm = false;
        if (mode === 'measure') {
          const job = app.job;
          this.measureQueue = job.params.filter((d) => d.measure).map((d) => d.id);
          app.selected.value = this.measureQueue[0] ?? null;
        }
        if (mode !== 'test') {
          this.endPush(true);
        }
        if (mode !== 'shape') {
          this.setSlice(false);
        }
      }),
      app.jobId.subscribe(() => {
        if (app.mode.peek() === 'measure') {
          this.measureQueue = app.job.params.filter((d) => d.measure).map((d) => d.id);
          app.selected.value = this.measureQueue[0] ?? null;
        }
      }),
      app.stress.subscribe((s) => {
        if (s && this.pushPending) {
          this.pushPending = false;
        }
      }),
    );
  }

  // ----- helpers -------------------------------------------------------------

  private get immersive(): boolean {
    return this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
  }

  private dominant(): Side {
    return ctx.app.settings.peek().handed === 'left' ? 'left' : 'right';
  }

  private endGrab(): void {
    if (this.grab) {
      if (this.grab.kind === 'handle' && Math.abs(this.grab.last - this.grab.startValue) > 1e-9) {
        ctx.app.award('shape');
      }
      this.grab = null;
      ctx.app.dragging.value = false;
      ctx.sfx.play('release');
    }
  }

  /** World position of a part point given in millimetres. */
  private partToWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
    const part = ctx.bench.part;
    out.set(x, y, z).multiplyScalar(part.scale).add(part.pivot.position);
    return ctx.bench.turntable.localToWorld(out);
  }

  // ----- per frame ----------------------------------------------------------------

  update(delta: number): void {
    this.time += delta;
    const { world } = this;
    const { app, hands, sfx } = ctx;
    const head = this.player.head;
    head.getWorldPosition(this.v1);
    this.v2.set(0, 0, -1).applyQuaternion(head.getWorldQuaternion(this.q1));
    sfx.setListener({ x: this.v1.x, y: this.v1.y, z: this.v1.z, fx: this.v2.x, fy: this.v2.y, fz: this.v2.z });

    const frame = world.xrFrame;
    const session = world.session;
    const ref = world.xrReferenceSpace;
    if (!this.immersive || !frame || !session || !ref) {
      hands.clear();
      this.updateHandles(false);
      this.dial.visible = false;
      this.caliper.visible = false;
      this.caliperLabel.visible = false;
      this.caliperEnds.forEach((m) => (m.visible = false));
      this.pushLabel.visible = false;
      return;
    }
    this.player.updateMatrixWorld();
    const input = world.input.xr;
    hands.update(frame, session, ref, this.player.matrixWorld, delta, (side) => {
      try {
        return input.getSelectState(side).active;
      } catch {
        return undefined;
      }
    });

    const mode = app.mode.peek();
    this.updateMicrogestures(session, mode);
    this.updateHandles(mode === 'shape');
    this.updateDial();
    this.updateGrabs(mode);
    this.updateMeasure(mode);
    this.updatePush(mode);
    this.updateSlice(mode);
  }

  /**
   * Quest microgestures: the thumb swipes or taps on the side of the curled
   * index finger, and the runtime reports it as hand gamepad buttons
   * 5 to 9 (left, right, forward, backward, tap). Here they drive the dial
   * without lifting the arm: forward and backward step 0.05 mm, left and
   * right step 1 mm, a tap moves to the next dimension.
   */
  private updateMicrogestures(session: XRSession, mode: string): void {
    const { app, sfx } = ctx;
    for (const source of session.inputSources) {
      if (!source.hand || !source.gamepad || (source.handedness !== 'left' && source.handedness !== 'right')) continue;
      const prev = source.handedness === 'left' ? this.microLeft : this.microRight;
      const buttons = source.gamepad.buttons;
      for (let b = 5; b <= 9; b++) {
        const now = buttons[b]?.pressed === true;
        const was = prev[b] === 1;
        prev[b] = now ? 1 : 0;
        if (!now || was || mode !== 'shape') continue;
        const job = app.job;
        let id = app.selected.peek();
        if (b === 9 || !id) {
          const i = id ? job.params.findIndex((d) => d.id === id) : -1;
          id = job.params[(i + 1) % job.params.length].id;
          app.selected.value = id;
          sfx.play('select');
          if (b === 9) continue;
        }
        const detents = b === 7 || b === 6 ? 1 : -1;
        const coarse = b === 5 || b === 6;
        const before = app.params.peek()[id];
        app.nudge(id, detents, coarse);
        const after = app.params.peek()[id];
        if (after !== before) {
          sfx.play(coarse ? 'step' : 'tick', undefined, after > before ? 1.08 : 0.92);
          app.award('dial');
        } else {
          sfx.play('limit');
        }
        probe.microgesture = b;
      }
    }
  }

  private updateHandles(show: boolean): void {
    const { app, bench } = ctx;
    const job = app.job;
    const params = app.params.peek();
    const selected = app.selected.peek();
    let labelled = false;
    for (let i = 0; i < MAX_HANDLES; i++) {
      const h = this.handles[i];
      const def = job.handles[i];
      const visible = show && !!def && app.rollback.peek() === null && !app.grown.peek() && bench.part.mesh.visible;
      if (h.group.visible !== visible) {
        h.group.visible = visible;
        if (visible && !h.entity.hasComponent(RayInteractable)) h.entity.addComponent(RayInteractable);
        if (!visible && h.entity.hasComponent(RayInteractable)) h.entity.removeComponent(RayInteractable);
      }
      if (!visible) continue;
      h.param = def.param;
      const at = def.at(params);
      const part = bench.part;
      h.group.position.set(at[0], at[1], at[2]).multiplyScalar(part.scale).add(part.pivot.position);
      // Point the arrow along the handle's axis.
      h.group.quaternion.setFromUnitVectors(this.v3.set(0, 1, 0), this.v2.set(def.axis[0], def.axis[1], def.axis[2]));
      const held = this.grab?.kind === 'handle' && this.grab.index === i;
      const hovered = h.entity.hasComponent(Hovered);
      const active = held || hovered || selected === def.param;
      h.ball.scale.setScalar(held ? 1.35 : hovered ? 1.2 : 1);
      h.ball.material.color.setHex(held ? COLORS.white : active ? COLORS.amber : 0xd28a10);
      if (active && !labelled && (held || hovered)) {
        const d = paramDef(job, def.param);
        if (d) {
          h.group.getWorldPosition(this.v1);
          bench.root.worldToLocal(this.v1);
          this.handleLabel.mesh.position.copy(this.v1).add(this.v2.set(0, 0.022, 0));
          this.handleLabel.set(`${d.label} ${params[def.param].toFixed(d.unit === 'deg' ? 1 : 2)} ${d.unit}`, { border: CSS.amber });
          labelled = true;
        }
      }
    }
    this.handleLabel.visible = labelled;
    if (labelled) {
      this.player.head.getWorldPosition(this.v1);
      faceViewer(this.handleLabel.mesh, this.v1);
    }
  }

  private updateDial(): void {
    const { app } = ctx;
    const id = app.selected.peek();
    const def = id ? paramDef(app.job, id) : undefined;
    const show = !!def && app.mode.peek() === 'shape';
    if (this.dial.visible !== show) {
      this.dial.visible = show;
      for (const k of ['dial:--', 'dial:-', 'dial:+', 'dial:++', 'dial:close']) setButton(k, { visible: show });
    }
    if (!show || !def || !id) return;
    const v = app.params.peek()[id];
    this.dialTicks.rotation.z = (-(v / def.fine) * DETENT_DEG * Math.PI) / 180;
    this.dialLabel.set(`${def.label}  ${v.toFixed(def.unit === 'deg' ? 2 : 2)} ${def.unit}`, { border: CSS.cyan });
    this.dialLabel.mesh.position.set(0, 0, 0.006);
  }

  private updateGrabs(mode: string): void {
    const { app, hands, bench, sfx } = ctx;
    // Release.
    if (this.grab) {
      const hand = hands.get(this.grab.side);
      if (!hand.tracked || !hand.pinching) {
        this.endGrab();
      }
    }
    // Start (the air sketch owns every pinch over the bench while it is active).
    if (!this.grab && mode !== 'sketch' && mode !== 'capture') {
      for (const side of [this.dominant(), this.dominant() === 'left' ? 'right' : 'left'] as Side[]) {
        const hand = hands.get(side);
        if (!hand.tracked || !hand.pinchStarted) continue;
        const p = hand.pinchPoint;
        // 1. handles
        if (mode === 'shape') {
          let best = -1;
          let bestD = GRAB_RADIUS;
          this.handles.forEach((h, i) => {
            if (!h.group.visible) return;
            h.group.getWorldPosition(this.v1);
            const d = this.v1.distanceTo(p);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          if (best >= 0) {
            const param = this.handles[best].param;
            const value = app.params.peek()[param];
            this.grab = { kind: 'handle', side, index: best, param, start: p.clone(), startValue: value, last: value, limited: false };
            app.selected.value = param;
            app.dragging.value = true;
            sfx.play('grab', p);
            break;
          }
        }
        // 2. dial
        if (this.dial.visible) {
          this.dial.getWorldPosition(this.v1);
          if (this.v1.distanceTo(p) < DIAL_RADIUS + 0.022) {
            this.v2.copy(p);
            this.dial.worldToLocal(this.v2);
            this.grab = { kind: 'dial', side, angle: Math.atan2(this.v2.y, this.v2.x), acc: 0 };
            app.dragging.value = true;
            sfx.play('grab', p);
            break;
          }
        }
        // 3. bench rim
        this.v2.copy(p);
        bench.root.worldToLocal(this.v2);
        const r = Math.hypot(this.v2.x, this.v2.z);
        if (r > 0.1 && r < 0.165 && Math.abs(this.v2.y) < 0.045) {
          this.grab = { kind: 'rim', side, angle: Math.atan2(this.v2.x, this.v2.z) };
          sfx.play('grab', p);
          break;
        }
      }
    }
    // Drag.
    const g = this.grab;
    if (!g) return;
    const hand = hands.get(g.side);
    const p = hand.pinchPoint;
    if (g.kind === 'handle') {
      const def = app.job.handles[g.index];
      const pdef = paramDef(app.job, g.param);
      if (!def || !pdef) return;
      // Handle axis in world space.
      this.v1.set(def.axis[0], def.axis[1], def.axis[2]).transformDirection(bench.turntable.matrixWorld);
      const travelMm = this.v2.copy(p).sub(g.start).dot(this.v1) / bench.part.scale;
      const raw = g.startValue + travelMm * handleGain(def, app.params.peek());
      const snapped = Math.round(raw / pdef.step) * pdef.step;
      if (Math.abs(snapped - g.last) > 1e-9) {
        app.setParam(g.param, snapped);
        const got = app.params.peek()[g.param];
        if (Math.abs(got - g.last) > 1e-9) {
          g.last = got;
          g.limited = false;
          sfx.play('step', p, 0.8 + 0.4 * ((got - pdef.min) / (pdef.max - pdef.min)));
        } else if (!g.limited) {
          g.limited = true;
          sfx.play('limit', p);
        }
      }
    } else if (g.kind === 'dial') {
      const id = app.selected.peek();
      this.v2.copy(p);
      this.dial.worldToLocal(this.v2);
      if (Math.hypot(this.v2.x, this.v2.y) < 0.008 || !id) return;
      const angle = Math.atan2(this.v2.y, this.v2.x);
      let d = angle - g.angle;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      g.angle = angle;
      // Clockwise, as seen by the user, increases the value.
      g.acc -= (d * 180) / Math.PI;
      const detents = Math.trunc(g.acc / DETENT_DEG);
      if (detents !== 0) {
        g.acc -= detents * DETENT_DEG;
        const before = app.params.peek()[id];
        app.nudge(id, detents);
        const after = app.params.peek()[id];
        if (after !== before) {
          sfx.play('tick', p, after > before ? 1.08 : 0.92);
          app.award('dial');
        } else {
          sfx.play('limit', p);
        }
      }
    } else {
      this.v2.copy(p);
      bench.root.worldToLocal(this.v2);
      const angle = Math.atan2(this.v2.x, this.v2.z);
      let d = angle - g.angle;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      g.angle = angle;
      bench.turntable.rotation.y += d;
    }
  }

  // ----- measuring ----------------------------------------------------------------

  private showCaliper(a: Vector3, b: Vector3, text: string, locked: boolean): void {
    const arr = this.caliper.geometry.getAttribute('position') as BufferAttribute;
    const f = arr.array as Float32Array;
    f[0] = a.x; f[1] = a.y; f[2] = a.z; f[3] = b.x; f[4] = b.y; f[5] = b.z;
    arr.needsUpdate = true;
    this.caliper.visible = true;
    this.caliper.material.color.setHex(locked ? COLORS.green : COLORS.cyan);
    this.caliperEnds[0].position.copy(a);
    this.caliperEnds[1].position.copy(b);
    this.caliperEnds.forEach((m) => {
      m.visible = true;
      m.material.color.setHex(locked ? COLORS.green : COLORS.cyan);
    });
    this.caliperLabel.mesh.position.copy(a).add(b).multiplyScalar(0.5).add(this.v3.set(0, 0.03, 0));
    this.caliperLabel.set(text, { border: locked ? CSS.green : CSS.cyan });
    this.caliperLabel.visible = true;
    this.player.head.getWorldPosition(this.v3);
    faceViewer(this.caliperLabel.mesh, this.v3);
  }

  private hideCaliper(): void {
    this.caliper.visible = false;
    this.caliperEnds.forEach((m) => (m.visible = false));
    if (this.time > this.lockedUntil) this.caliperLabel.visible = false;
  }

  private lock(value: number, sd: number, method: 'span' | 'tape', a: Vector3, b: Vector3): void {
    const { app, sfx } = ctx;
    const id = app.selected.peek();
    app.lockMeasurement({ value, spread: sd, method, samples: 0 });
    sfx.play('lock', a);
    this.showCaliper(a, b, `Locked ${value.toFixed(1)} mm  +/- ${Math.max(0.1, sd).toFixed(1)}`, true);
    this.lockedUntil = this.time + 1.6;
    this.needRearm = true;
    this.samples.clear();
    if (id && app.bindMeasurement(id)) {
      sfx.play('bind', a);
    }
    // Next value to measure, or back to shaping.
    this.measureQueue = this.measureQueue.filter((p) => p !== id);
    const next = this.measureQueue[0];
    if (next) {
      app.selected.value = next;
    } else {
      // Every dimension is measured: lift the object's box out of the real world.
      app.extractFrom.value = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
      setTimeout(() => {
        if (app.mode.peek() === 'measure') app.mode.value = 'shape';
      }, 1200);
    }
  }

  private updateMeasure(mode: string): void {
    // The laser tape (src/systems/laser-system.ts) owns the pinches while it is on.
    if (mode !== 'measure' || ctx.app.laser.peek()) {
      this.hideCaliper();
      return;
    }
    const { app, hands } = ctx;
    const id = app.selected.peek();
    const def = id ? paramDef(app.job, id) : undefined;
    probe.measure = { id, kind: def?.measure, rearm: this.needRearm, wait: +(this.lockedUntil - this.time).toFixed(2), queue: this.measureQueue.join(',') };
    if (!def?.measure) {
      this.hideCaliper();
      return;
    }
    if (this.time < this.lockedUntil) return;
    const dom = hands.get(this.dominant());
    const off = hands.other(this.dominant());

    if (def.measure === 'span') {
      const hand = dom.tracked ? dom : off;
      if (!hand.tracked || hand.pinching) {
        if (hand.pinching) this.needRearm = false;
        this.hideCaliper();
        this.samples.clear();
        return;
      }
      const mm = hand.gap * 1000;
      if (mm < 2 || mm > 160) {
        this.needRearm = false;
        this.hideCaliper();
        this.samples.clear();
        return;
      }
      if (this.needRearm) {
        this.hideCaliper();
        return;
      }
      this.samples.push(mm, this.time);
      const st = this.samples.stats(this.time);
      this.showCaliper(hand.thumbTip, hand.indexTip, `${mm.toFixed(1)} mm  hold still`, false);
      if (st && st.span > SAMPLE_WINDOW_S * 0.85 && st.range < 1.5) {
        this.lock(st.mean, st.sd, 'span', hand.thumbTip, hand.indexTip);
      }
      return;
    }

    // Tape: both hands pinching, or one hand pinching twice.
    if (dom.pinching && off.pinching) {
      this.tapeA = null;
      const mm = dom.pinchPoint.distanceTo(off.pinchPoint) * 1000;
      if (this.needRearm) {
        this.hideCaliper();
        return;
      }
      this.samples.push(mm, this.time);
      const st = this.samples.stats(this.time);
      this.showCaliper(dom.pinchPoint, off.pinchPoint, `${mm.toFixed(1)} mm  hold still`, false);
      if (st && st.span > SAMPLE_WINDOW_S * 0.85 && st.range < 2.5) {
        this.lock(st.mean, st.sd, 'tape', dom.pinchPoint, off.pinchPoint);
      }
      return;
    }
    if (!dom.pinching && !off.pinching) this.needRearm = false;
    this.samples.clear();
    // One-handed tape.
    const single = dom.tracked && !off.pinching ? dom : off.tracked ? off : null;
    if (!single || off.pinching === dom.pinching) {
      if (this.tapeA) {
        this.showCaliper(this.tapeA, this.tapeA, 'Now pinch the other end', false);
      } else {
        this.hideCaliper();
      }
      return;
    }
    if (single.pinchStarted) {
      this.tapeSum.set(0, 0, 0);
      this.tapeCount = 0;
    }
    if (single.pinching) {
      this.tapeSum.add(single.pinchPoint);
      this.tapeCount++;
    }
    if (single.pinchEnded && this.tapeCount > 3) {
      const pt = this.tapeSum.clone().divideScalar(this.tapeCount);
      if (!this.tapeA) {
        this.tapeA = pt;
        ctx.sfx.play('select', pt);
      } else {
        const mm = this.tapeA.distanceTo(pt) * 1000;
        const a = this.tapeA;
        this.tapeA = null;
        this.lock(mm, 1, 'tape', a, pt);
      }
    }
    if (this.tapeA) {
      this.showCaliper(this.tapeA, single.pinchPoint, `${(this.tapeA.distanceTo(single.pinchPoint) * 1000).toFixed(1)} mm`, false);
    }
  }

  // ----- palm push -------------------------------------------------------------------

  /**
   * A controller in the pushing hand pulses with the utilisation (hands have no
   * motors; with controllers the buzz grows towards yield). Throttled.
   */
  private buzzAt = 0;
  private buzz(side: 'left' | 'right', util: number): void {
    if (this.time < this.buzzAt || util < 0.3) return;
    this.buzzAt = this.time + 0.12;
    const session = this.world.renderer.xr.getSession?.();
    if (!session) return;
    for (const src of session.inputSources) {
      if (src.handedness !== side) continue;
      const act = (src.gamepad as unknown as { hapticActuators?: { pulse(v: number, ms: number): Promise<boolean> }[] } | undefined)?.hapticActuators?.[0];
      void act?.pulse(Math.min(1, util), 60).catch(() => undefined);
    }
  }

  private endPush(refresh: boolean): void {
    ctx.sfx.strain(null);
    if (this.pushSide !== null) {
      this.pushSide = null;
      if (refresh) ctx.app.refreshFindings();
    }
    this.pushLabel.visible = false;
  }

  /** Distance (m) from the palm plane to the part surface along the palm normal, or null. */
  private palmContact(hand: HandState): { dist: number; point: Vector3 } | null {
    const part = ctx.bench.part;
    const back = 0.05;
    this.v1.copy(hand.palmNormal).multiplyScalar(-back).add(hand.palm);
    this.ray.set(this.v1, hand.palmNormal);
    this.ray.far = back + PALM_SKIN + 0.03;
    const hits = this.ray.intersectObject(part.mesh, false);
    if (!hits.length) return null;
    return { dist: hits[0].distance - back - PALM_SKIN, point: hits[0].point };
  }

  private updatePush(mode: string): void {
    const { app, hands, bench, sfx } = ctx;
    if (mode !== 'test' || app.grown.peek()?.final === false) {
      this.endPush(false);
      return;
    }
    let touching: { side: Side; dist: number; point: Vector3 } | null = null;
    for (const side of ['right', 'left'] as Side[]) {
      const hand = hands.get(side);
      probe[`open_${side}`] = hand.open;
      if (!hand.tracked || hand.pinching || hand.openTime < 0.1) continue;
      const c = this.palmContact(hand);
      probe[`palm_${side}`] = c ? +c.dist.toFixed(4) : null;
      if (c && c.dist < 0.006 && (!touching || c.dist < touching.dist)) {
        touching = { side, dist: c.dist, point: c.point.clone() };
      }
    }
    if (!touching) {
      this.endPush(true);
      return;
    }
    const hand = hands.get(touching.side);
    const job = app.job;
    const standard = job.loadCase(app.params.peek()).newtons;
    // 10 mm of push = the part's standard load; linear statics makes the scaling exact.
    const pushMm = Math.max(0, -touching.dist * 1000 + 1);
    const newtons = Math.min(standard * 20, (standard * pushMm) / 10);
    const stress = app.stress.peek();
    const moved = this.pushSide !== null && this.pushPoint.distanceTo(touching.point) > 0.02;
    if (this.pushSide === null || moved || !stress?.custom) {
      if (!this.pushPending && !app.busy.peek()) {
        this.pushSide = touching.side;
        this.pushPoint.copy(touching.point);
        this.pushPending = true;
        // Contact point and push direction in part millimetres.
        this.v2.copy(touching.point);
        bench.turntable.worldToLocal(this.v2);
        bench.part.toPart(this.v2, this.v2);
        bench.turntable.getWorldQuaternion(this.q1).invert();
        this.v3.copy(hand.palmNormal).applyQuaternion(this.q1).normalize();
        sfx.play('solve', touching.point);
        void app.pushTest(
          [this.v2.x, this.v2.y, this.v2.z],
          [this.v3.x, this.v3.y, this.v3.z],
          Math.max(4, bench.part.size * 0.12),
        );
      }
    }
    this.pushSide = touching.side;
    let text: string;
    if (this.pushPending || app.busy.peek()?.kind === 'solve') {
      text = 'Solving your push...';
    } else {
      app.setLoad(newtons, false);
      // Keep the agent cards in step with the push, a few times a second.
      if (this.time - this.lastRefresh > 0.3) {
        this.lastRefresh = this.time;
        app.refreshFindings();
      }
      const sf = app.factor();
      const s = app.stress.peek();
      const peak = s ? (s.stressP99 * newtons) / s.newtons : 0;
      text = `${newtons.toFixed(0)} N   ${peak.toFixed(1)} MPa   factor ${sf === null || !Number.isFinite(sf) ? '-' : sf.toFixed(1)}`;
      // Hear and feel it: a tone that climbs with the utilisation, and a buzz in the hand's controller (if it has one).
      const util = sf === null || !Number.isFinite(sf) ? 0 : 1 / Math.max(1e-6, sf);
      sfx.strain(util, touching.point);
      this.buzz(touching.side, util);
      probe.strain = +util.toFixed(3);
      if (sf !== null && sf < 1 && !this.yielded) {
        this.yielded = true;
        sfx.play('yield', touching.point);
      } else if (sf !== null && sf >= 1.1) {
        this.yielded = false;
      }
    }
    this.pushLabel.mesh.position.copy(touching.point).add(this.v1.set(0, 0.06, 0));
    this.pushLabel.set(text, { border: this.yielded ? CSS.red : CSS.amber });
    this.pushLabel.visible = true;
    this.player.head.getWorldPosition(this.v1);
    faceViewer(this.pushLabel.mesh, this.v1);
  }

  // ----- knife-hand slicer ---------------------------------------------------------

  private setSlice(on: boolean): void {
    if (on === this.slicing) return;
    this.slicing = on;
    ctx.app.slicing = on;
    probe.slicing = on;
    ctx.bench.part.setClip(on ? this.clip : null);
    if (on) {
      ctx.sfx.play('slice');
      ctx.app.award('slice');
    }
  }

  private updateSlice(mode: string): void {
    const { hands, bench } = ctx;
    if (mode !== 'shape' || this.grab) {
      this.setSlice(false);
      return;
    }
    let blade: HandState | null = null;
    for (const side of ['left', 'right'] as Side[]) {
      const hand = hands.get(side);
      if (!hand.tracked || !hand.open || hand.openTime < 0.15) continue;
      if (Math.abs(hand.palmNormal.y) > 0.55) continue;
      // Any point along the blade (palm to fingertip) inside the part's box, grown by 1 cm.
      const b = bench.part.box;
      const pad = 10;
      let inside = false;
      for (const t of [0, 0.5, 1]) {
        this.v1.copy(hand.palm).lerp(hand.middleTip, t);
        bench.turntable.worldToLocal(this.v1);
        bench.part.toPart(this.v1, this.v1);
        if (
          this.v1.x > b.min[0] - pad && this.v1.x < b.max[0] + pad &&
          this.v1.y > b.min[1] - pad && this.v1.y < b.max[1] + pad &&
          this.v1.z > b.min[2] - pad && this.v1.z < b.max[2] + pad
        ) {
          inside = true;
          break;
        }
      }
      if (inside) {
        blade = hand;
        break;
      }
    }
    if (blade) {
      this.sliceHold = 0.3;
      this.v2.copy(blade.palmNormal).negate();
      this.clip.setFromNormalAndCoplanarPoint(this.v2, blade.palm);
      this.setSlice(true);
    } else if (this.slicing) {
      this.sliceHold -= 1 / 72;
      if (this.sliceHold <= 0) this.setSlice(false);
    }
  }
}

