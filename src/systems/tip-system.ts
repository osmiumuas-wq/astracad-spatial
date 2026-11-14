/**
 * Tip test: will the part stand, and how far can it lean before it falls?
 * The numbers come from src/engine/stability.ts (exact centre of mass of the
 * mesh, footprint hull, tip angle, tipping factor under the job's load). The
 * bench shows them: the footprint is drawn on the floor of the part, the
 * centre of mass is a bead with a plumb line straight down, and the part rocks
 * over its weakest edge to the tip angle, where the plumb line meets the edge,
 * then settles back.
 *
 * Only for parts that stand freely; a part that is screwed or bolted down is
 * refused with the reason.
 */

import {
  BufferAttribute,
  BufferGeometry,
  createSystem,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { ctx, probe } from '../app/context.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { COLORS, CSS } from '../app/palette.js';
import { setButton } from '../app/ui3d.js';
import type { LoadCase, Region } from '../engine/jobs.js';
import { Stability, stability } from '../engine/stability.js';
import type { Vec3 } from '../engine/types.js';

const FREE = /desk|resting|standing|floor/iu;
const RISE = 2.2;
const HOLD = 1.3;
const FALL = 1.1;

function regionCentre(r: Region): Vec3 {
  if (r.kind === 'box') return [(r.min[0] + r.max[0]) / 2, (r.min[1] + r.max[1]) / 2, (r.min[2] + r.max[2]) / 2];
  return [0, (r.y0 + r.y1) / 2, 0];
}

/** A flat band along a polyline at height y (mm), halfWidth mm either side. */
function band(points: [number, number][], y: number, halfWidth: number, closed: boolean): BufferGeometry {
  const n = closed ? points.length : points.length - 1;
  const pos = new Float32Array(n * 4 * 3);
  const idx = new Uint32Array(n * 6);
  for (let k = 0; k < n; k++) {
    const [ax, az] = points[k];
    const [bx, bz] = points[(k + 1) % points.length];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (-(bz - az) / len) * halfWidth;
    const nz = ((bx - ax) / len) * halfWidth;
    pos.set([ax + nx, y, az + nz, ax - nx, y, az - nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz], k * 12);
    const v = k * 4;
    idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], k * 6);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  return g;
}

export class TipSystem extends createSystem({}) {
  private active = false;
  private t = 0;
  private result: Stability | null = null;
  private tipRad = 0;
  /** +1 or -1: the rotation sense about the edge axis that leans the part over the edge. */
  private sense = 1;
  private footprint!: Mesh<BufferGeometry, MeshBasicMaterial>;
  private edge!: Mesh<BufferGeometry, MeshBasicMaterial>;
  private bead!: Mesh<SphereGeometry, MeshBasicMaterial>;
  private plumb!: Mesh<CylinderGeometry, MeshBasicMaterial>;
  private label!: TextLabel;
  private readonly v = new Vector3();
  private readonly axis = new Vector3();
  private readonly point = new Vector3();
  private readonly viewer = new Vector3();

  init(): void {
    const { app, bench } = ctx;
    const flat = (color: number): MeshBasicMaterial =>
      new MeshBasicMaterial({ color, toneMapped: false, depthTest: false, transparent: true, side: DoubleSide });
    this.footprint = new Mesh(new BufferGeometry(), flat(COLORS.green));
    this.edge = new Mesh(new BufferGeometry(), flat(COLORS.amber));
    this.bead = new Mesh(new SphereGeometry(1, 16, 12), flat(COLORS.amber));
    this.plumb = new Mesh(new CylinderGeometry(1, 1, 1, 8), flat(COLORS.amber));
    for (const m of [this.footprint, this.edge, this.bead, this.plumb]) {
      m.renderOrder = 26;
      m.frustumCulled = false;
      m.visible = false;
    }
    // Footprint, edge and bead ride with the part (mm); the plumb line stays vertical on the turntable.
    bench.part.pivot.add(this.footprint, this.edge, this.bead);
    bench.turntable.add(this.plumb);
    this.label = new TextLabel(0.015);
    this.label.visible = false;
    bench.turntable.add(this.label.mesh);
    this.cleanupFuncs.push(
      app.params.subscribe(() => this.end()),
      app.jobId.subscribe(() => this.end()),
    );
    app.actions.tip = () => this.toggle();
  }

  toggle(): void {
    if (this.active) {
      this.end();
      return;
    }
    const { app, bench } = ctx;
    if (!app.built.peek()) {
      app.say('The tip test works on the finished part.', 'warn');
      return;
    }
    const lc: LoadCase = app.job.loadCase(app.params.peek());
    if (!FREE.test(lc.fixtureLabel)) {
      app.say(`This part is ${lc.fixtureLabel.toLowerCase()}, so it cannot tip. The tip test is for parts that stand on their own.`, 'info');
      return;
    }
    const solid = bench.part.solid();
    const density = app.materialData.density;
    const alone = stability(solid, density);
    // The job's load, taken as a weight resting at its load point (a phone on a stand).
    const carried = lc.newtons > 0 ? [{ at: regionCentre(lc.region), newtons: lc.newtons }] : [];
    const r = carried.length ? stability(solid, density, [], 0.2, carried) : alone;
    this.result = r;
    probe.tip = {
      standsAlone: alone.standsAlone,
      tipDeg: alone.weakest ? +alone.weakest.tipDeg.toFixed(2) : null,
      loadedTipDeg: carried.length && r.weakest ? +r.weakest.tipDeg.toFixed(2) : null,
      com: r.com.map((x) => +x.toFixed(2)),
      comLoaded: r.comLoaded.map((x) => +x.toFixed(2)),
      mass: +r.mass.toFixed(2),
    };
    if (!r.weakest) {
      app.say('It has no flat footing to stand on.', 'warn');
      return;
    }
    const w = r.weakest;
    // Rock over the weakest edge: up to the tip angle when it stands, a small lean when it would fall anyway.
    this.tipRad = ((w.margin > 0 ? w.tipDeg : 12) * Math.PI) / 180;
    // The axis runs along the edge so that a positive angle lifts the part's far side, carrying the centre of mass over it.
    this.point.set(w.a[0], w.a[1], w.a[2]);
    this.axis.set(w.b[0] - w.a[0], 0, w.b[2] - w.a[2]).normalize();
    // Which way leans it over the edge: a small turn that lowers the centre of mass's distance to the edge.
    const com = new Vector3(r.comLoaded[0], r.comLoaded[1], r.comLoaded[2]).sub(this.point);
    const towards = new Vector3(-this.axis.z, 0, this.axis.x);
    const side = Math.sign(com.dot(towards)) || 1;
    const turned = com.clone().applyAxisAngle(this.axis, 0.05);
    this.sense = Math.sign(turned.dot(towards) * side - com.dot(towards) * side) < 0 ? 1 : -1;
    this.footprint.geometry.dispose();
    this.footprint.geometry = band(r.footprint, r.floor + 0.05, Math.max(0.4, bench.part.size * 0.006), true);
    this.edge.geometry.dispose();
    this.edge.geometry = band([[w.a[0], w.a[2]], [w.b[0], w.b[2]]], r.floor + 0.08, Math.max(0.7, bench.part.size * 0.012), false);
    const beadR = Math.max(1.2, bench.part.size * 0.035);
    this.bead.scale.setScalar(beadR);
    this.bead.position.set(r.comLoaded[0], r.comLoaded[1], r.comLoaded[2]);
    for (const m of [this.footprint, this.edge, this.bead, this.plumb]) m.visible = true;
    this.active = true;
    this.t = 0;
    setButton('lab:tip', { toggled: true });
    const a0 = alone.weakest;
    const lean = !a0 || a0.margin <= 0
      ? 'On its own it falls over: its centre of mass is outside its footprint.'
      : `On its own it stands, and tips at ${a0.tipDeg.toFixed(0)} degrees over its weakest edge.`;
    const loaded = carried.length
      ? w.margin > 0
        ? ` With ${lc.loadLabel.toLowerCase()} (${lc.newtons} N taken as a resting weight), it tips at ${w.tipDeg.toFixed(0)} degrees.`
        : ` With ${lc.loadLabel.toLowerCase()} (${lc.newtons} N taken as a resting weight), it falls over.`
      : '';
    const worst = w.margin <= 0 ? 0 : w.tipDeg;
    const tone = worst <= 0 ? 'bad' : worst < 10 ? 'warn' : 'good';
    app.say(`${lean}${loaded} Centre of mass ${(r.com[1] - r.floor).toFixed(0)} mm up, ${r.mass.toFixed(1)} g.`, tone);
    const head = w.margin > 0 ? `Tips at ${w.tipDeg.toFixed(0)}°` : 'Falls over';
    this.label.set(carried.length ? `${head} with the load` : head, { bg: CSS.panel, border: tone === 'good' ? CSS.green : tone === 'warn' ? CSS.amber : CSS.red });
    this.label.visible = true;
  }

  private end(): void {
    if (!this.active) return;
    this.active = false;
    this.result = null;
    ctx.bench.part.setTilt(this.point, this.axis, 0);
    for (const m of [this.footprint, this.edge, this.bead, this.plumb]) m.visible = false;
    this.label.visible = false;
    setButton('lab:tip', { toggled: false });
  }

  update(delta: number): void {
    if (!this.active || !this.result) return;
    const { bench } = ctx;
    this.t += delta;
    const reduce = ctx.app.settings.peek().reduceMotion;
    const cycle = RISE + HOLD + FALL + 1.2;
    const u = this.t % cycle;
    const ease = (x: number): number => x * x * (3 - 2 * x);
    let k = 0;
    if (!reduce) {
      if (u < RISE) k = ease(u / RISE);
      else if (u < RISE + HOLD) k = 1;
      else if (u < RISE + HOLD + FALL) k = 1 - ease((u - RISE - HOLD) / FALL);
    }
    bench.part.setTilt(this.point, this.axis, this.sense * this.tipRad * k);
    // Plumb line: from the centre of mass straight down to the turntable.
    this.bead.getWorldPosition(this.v);
    bench.turntable.worldToLocal(this.v);
    const h = Math.max(1e-4, this.v.y);
    this.plumb.position.set(this.v.x, h / 2, this.v.z);
    this.plumb.scale.set(0.0006, h, 0.0006);
    const { box } = bench.part;
    this.label.mesh.position.set(0, (box.max[1] - box.min[1]) * bench.part.scale + 0.035, 0);
    (this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.world.camera : this.player.head).getWorldPosition(this.viewer);
    faceViewer(this.label.mesh, this.viewer);
  }
}
