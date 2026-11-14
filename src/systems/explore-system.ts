/**
 * Explore: six variants of the current part, in an arc behind the bench.
 * src/engine/explore.ts picks them (the two most effective structural
 * parameters on a 3 x 2 grid). Each one is built and verified by the truth
 * gate, then stress-solved at its standard load, all in the analysis worker,
 * one after another. A variant shows its safety factor and mass, coloured from
 * red (would fail) to green (twice the load or more); a star marks the Pareto
 * front, the variants no other beats on both. "Use" adopts one.
 */

import {
  BufferAttribute,
  BufferGeometry,
  createSystem,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { ctx, probe } from '../app/context.js';
import { CancelledError } from '../app/engine-client.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { COLORS, CSS } from '../app/palette.js';
import { makeButton, setButton } from '../app/ui3d.js';
import { safetyFactor } from '../engine/agents.js';
import { paretoFront, Variant, variants } from '../engine/explore.js';
import type { Params } from '../engine/jobs.js';

const SLOTS = 6;
const RADIUS = 0.2;
const SPAN = (50 * Math.PI) / 180;
/** Largest dimension of a variant on the arc, m. */
const SIZE = 0.05;
/** The safety factor a recommended variant must reach. */
const TARGET = 2;

interface Slot {
  group: Group;
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  label: TextLabel;
  params: Params | null;
}

export class ExploreSystem extends createSystem({}) {
  private readonly ring = new Group();
  private slots: Slot[] = [];
  private status!: TextLabel;
  private active = false;
  private run = 0;
  private spin = 0;
  private readonly viewer = new Vector3();

  init(): void {
    const { app, bench } = ctx;
    this.ring.name = 'Explore ring';
    this.ring.visible = false;
    bench.root.add(this.ring);
    const ringEntity = this.world.createTransformEntity(this.ring, { parent: ctx.benchEntity, persistent: true });
    for (let i = 0; i < SLOTS; i++) {
      const a = -SPAN + (2 * SPAN * i) / (SLOTS - 1);
      const group = new Group();
      group.position.set(Math.sin(a) * RADIUS, 0.16 + 0.02 * Math.cos(a * 2), -Math.cos(a) * RADIUS * 0.75);
      const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ color: COLORS.part, roughness: 0.4, metalness: 0.1 }));
      group.add(mesh);
      const label = new TextLabel(0.0125);
      label.mesh.position.set(0, -0.012, 0);
      group.add(label.mesh);
      this.ring.add(group);
      const slotEntity = this.world.createTransformEntity(group, { parent: ringEntity, persistent: true });
      const btn = makeButton(slotEntity, { key: `explore:${i}`, label: 'Use', width: 0.036, height: 0.018 }, () => this.adopt(i));
      btn.position.set(0, -0.032, 0);
      this.slots.push({ group, mesh, label, params: null });
    }
    this.status = new TextLabel(0.013);
    this.status.mesh.position.set(0, 0.105, -0.13);
    this.ring.add(this.status.mesh);
    this.refreshButtons();
    this.cleanupFuncs.push(app.jobId.subscribe(() => this.end()));
    app.actions.explore = () => this.toggle();
  }

  toggle(): void {
    if (this.active) {
      this.end();
      return;
    }
    void this.explore();
  }

  private end(): void {
    this.run++;
    this.active = false;
    this.ring.visible = false;
    for (const s of this.slots) s.params = null;
    setButton('lab:explore', { toggled: false });
    this.refreshButtons();
  }

  private refreshButtons(): void {
    this.slots.forEach((s, i) => setButton(`explore:${i}`, { visible: this.active && s.params !== null }));
  }

  private adopt(i: number): void {
    const p = this.slots[i]?.params;
    if (!p) return;
    ctx.app.setParams(p);
    ctx.app.say('Variant adopted. Run Test to see its stress on the bench.', 'good');
    ctx.sfx.play('bind');
    this.end();
  }

  private async explore(): Promise<void> {
    const { app } = ctx;
    if (!app.built.peek()) {
      app.say('Explore works on the finished part.', 'warn');
      return;
    }
    const job = app.job;
    const list: Variant[] = variants(job, app.params.peek()).slice(0, SLOTS);
    if (!list.length) {
      app.say('This part has no structural sizes to explore.', 'info');
      return;
    }
    const run = ++this.run;
    this.active = true;
    this.ring.visible = true;
    setButton('lab:explore', { toggled: true });
    for (const s of this.slots) {
      s.params = null;
      s.group.visible = false;
    }
    this.refreshButtons();
    const material = app.materialData;
    const scores: { mass: number; factor: number; verdict: string }[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        this.status.set(`Exploring: building and testing ${i + 1} of ${list.length}`, { bg: CSS.panel, border: CSS.cyan });
        const v = list[i];
        const built = await app.engine.run<'built'>({ type: 'build', job: app.jobId.peek(), params: v.params });
        if (run !== this.run) return;
        const solved = await app.engine.run<'solved'>({ type: 'solve', job: app.jobId.peek(), params: v.params, material: app.material.peek() });
        if (run !== this.run) return;
        const loadN = job.loadCase(v.params).newtons;
        const factor = safetyFactor(material, solved.outcome, loadN);
        const mass = (built.props.volume / 1000) * material.density;
        scores.push({ mass, factor, verdict: built.gate.verdict });
        this.show(i, v, built.mesh.positions, built.mesh.normals, built.mesh.indices, factor, mass, built.gate.verdict);
      }
    } catch (e) {
      if (!(e instanceof CancelledError)) app.say(e instanceof Error ? e.message : String(e), 'bad');
      this.end();
      return;
    }
    const front = paretoFront(scores);
    // The pick: the lightest verified variant that holds the standard load twice over.
    let pick = -1;
    scores.forEach((sc, i) => {
      if (sc.verdict !== 'refused' && sc.factor >= TARGET && (pick < 0 || sc.mass < scores[pick].mass)) pick = i;
    });
    list.forEach((v, i) => this.caption(i, v, scores[i], front.includes(i), i === pick));
    const pickText = pick >= 0 ? `Pick: ${list[pick].label} (${scores[pick].mass.toFixed(1)} g, factor ${scores[pick].factor.toFixed(1)})` : `None reaches factor ${TARGET}`;
    this.status.set(`${pickText}.  ★ = best trade-off`, { bg: CSS.panel, border: pick >= 0 ? CSS.green : CSS.amber });
    probe.explorePick = pick;
    probe.explore = list.map((v, i) => ({ params: v.params, mass: +scores[i].mass.toFixed(2), factor: +scores[i].factor.toFixed(2), front: front.includes(i), verdict: scores[i].verdict }));
    app.say(`Explored ${list.length} variants of the ${job.title.toLowerCase()}. Starred ones are the best trade-offs between weight and strength. Pinch Use to adopt one.`, 'good');
    this.refreshButtons();
  }

  private show(i: number, v: Variant, positions: Float32Array, normals: Float32Array, indices: Uint32Array, factor: number, mass: number, verdict: string): void {
    const s = this.slots[i];
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions.slice(), 3));
    g.setAttribute('normal', new BufferAttribute(normals.slice(), 3));
    g.setIndex(new BufferAttribute(indices.slice(), 1));
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) || 1;
    // Centre it, stand it on the label line.
    g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    s.mesh.geometry.dispose();
    s.mesh.geometry = g;
    s.mesh.scale.setScalar(SIZE / size);
    s.mesh.material.color.setHex(verdict === 'refused' ? COLORS.red : factor < 1 ? COLORS.red : factor < 2 ? COLORS.amber : COLORS.green);
    s.params = v.params;
    s.group.visible = true;
    this.caption(i, v, { mass, factor, verdict }, false, false);
    this.refreshButtons();
  }

  private caption(i: number, v: Variant, sc: { mass: number; factor: number; verdict: string }, star: boolean, pick: boolean): void {
    void v;
    const f = Number.isFinite(sc.factor) ? sc.factor.toFixed(1) : '-';
    const text = `${pick ? 'PICK ' : star ? '★ ' : ''}factor ${f} · ${sc.mass.toFixed(1)} g`;
    this.slots[i].label.set(text, {
      bg: CSS.panel,
      border: pick ? CSS.cyan : sc.verdict === 'refused' || sc.factor < 1 ? CSS.red : sc.factor < 2 ? CSS.amber : CSS.green,
    });
  }

  update(delta: number): void {
    if (!this.active) return;
    this.spin += delta * 0.6;
    (this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.world.camera : this.player.head).getWorldPosition(this.viewer);
    for (const s of this.slots) {
      if (!s.group.visible) continue;
      s.mesh.rotation.y = this.spin;
      faceViewer(s.label.mesh, this.viewer);
    }
    faceViewer(this.status.mesh, this.viewer);
  }
}
