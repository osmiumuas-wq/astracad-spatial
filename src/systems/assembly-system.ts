/**
 * Assembly and motion on the bench, the way desktop CAD does it.
 *
 *  - Insert parts: the part on the bench (any template or free design) becomes
 *    an instance; the first one is grounded.
 *  - Mate: point the hand ray at a face or a round surface of one part, pinch,
 *    then at the part it goes onto, pinch. Flat + flat is coincident, round +
 *    round is concentric (the axis is fitted from the mesh). Hinge and slider
 *    leave one freedom free to drive. The part glides into place.
 *  - Clash: exact common volume of every pair of parts, shown red.
 *  - Explode: parts move out from the middle; again to put them back.
 *  - Motion: drive a hinge or slider by voice ("turn the hinge to 90"), add
 *    keyframes, play. A gear mate follows a hinge at a ratio.
 *
 * The solver is src/engine/assembly.ts; the clash check runs in the kernel.
 */

import { BufferAttribute, BufferGeometry, Color, createSystem, Group, Mesh, MeshStandardMaterial, Quaternion, Raycaster, SphereGeometry, MeshBasicMaterial, Vector3, VisibilityState } from '@iwsdk/core';
import { ctx, probe } from '../app/context.js';
import { CancelledError } from '../app/engine-client.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { COLORS, CSS } from '../app/palette.js';
import { makeButton, setButton } from '../app/ui3d.js';
import { massProperties } from '../engine/stability.js';
import { writeStep } from '../engine/step-export.js';
import { MATERIALS } from '../engine/materials.js';
import { decodeAssembly, encodeAssembly, fitAxis, IDENTITY, Instance, Mate, MateKind, Pose, Quat, Ref, solveAssembly } from '../engine/assembly.js';
import { loadAssembly, saveAssembly } from '../app/persistence.js';
import { JOBS } from '../engine/jobs.js';
import { addFeature, OPS } from '../engine/design.js';
import { jobById, Params } from '../engine/jobs.js';
import type { MeshData, Vec3 } from '../engine/types.js';

const PALETTE = [0xdfe6ee, 0x9fc9ff, 0xffd48a, 0xa8f0c6, 0xf3b4ff, 0xffb3a8];
type Tool = 'none' | 'mate' | 'hinge' | 'slider';

interface View {
  group: Group;
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  data: MeshData;
  size: number;
}

const TOOLS: [string, string, () => void][] = [];

export class AssemblySystem extends createSystem({}) {
  private active = false;
  private instances: Instance[] = [];
  private mates: Mate[] = [];
  private views = new Map<string, View>();
  private readonly root = new Group();
  private readonly strip = new Group();
  private tool: Tool = 'none';
  private first: { inst: string; ref: Ref } | null = null;
  private status!: TextLabel;
  private bom: TextLabel[] = [];
  private marker!: Mesh<SphereGeometry, MeshBasicMaterial>;
  private clashMeshes: Mesh[] = [];
  private exploded = false;
  private keys: { t: number; values: Record<string, number> }[] = [];
  private playing = -1;
  private nextId = 1;
  private readonly ray = new Raycaster();
  private readonly o = new Vector3();
  private readonly d = new Vector3();
  private readonly viewer = new Vector3();
  /** Smooth glide of poses after a solve. */
  private glide: { id: string; from: Pose; to: Pose; t: number }[] = [];
  private recentre = false;

  init(): void {
    const { app, bench } = ctx;
    this.root.name = 'Assembly';
    this.root.visible = false;
    bench.turntable.add(this.root);
    this.marker = new Mesh(new SphereGeometry(1.6, 12, 8), new MeshBasicMaterial({ color: COLORS.cyan, toneMapped: false, depthTest: false }));
    this.marker.renderOrder = 30;
    this.marker.visible = false;
    this.root.add(this.marker);
    this.status = new TextLabel(0.013);
    this.status.visible = false;
    this.status.mesh.position.set(0, 0.2, -0.05);
    bench.turntable.add(this.status.mesh);
    for (let i = 0; i < 8; i++) {
      const l = new TextLabel(0.0105);
      l.visible = false;
      l.mesh.position.set(0.19, 0.115 - i * 0.0135, 0.05);
      bench.root.add(l.mesh);
      this.bom.push(l);
    }
    // The assembly strip (left of the bench, where the design strip sits).
    this.strip.position.set(-0.205, 0.0, 0.05);
    this.strip.rotation.set(-0.7, 0.55, 0, 'YXZ');
    bench.root.add(this.strip);
    const e = this.world.createTransformEntity(this.strip, { parent: ctx.benchEntity, persistent: true });
    TOOLS.length = 0;
    TOOLS.push(
      ['asm:add', '+ This part', () => void this.addCurrent()],
      ['asm:mate', 'Mate', () => this.setTool('mate')],
      ['asm:hinge', 'Hinge', () => this.setTool('hinge')],
      ['asm:slider', 'Slider', () => this.setTool('slider')],
      ['asm:clash', 'Clash check', () => void this.clash()],
      ['asm:explode', 'Explode', () => this.explode()],
      ['asm:key', 'Keyframe', () => this.key()],
      ['asm:play', 'Play motion', () => this.playMotion()],
    );
    TOOLS.forEach(([key, label, fn], i) => {
      const b = makeButton(e, { key, label, width: 0.062, height: 0.022 }, () => {
        ctx.sfx.play('select');
        fn();
      });
      b.position.set((i % 2) * 0.068 - 0.034, 0.045 - Math.floor(i / 2) * 0.028, 0);
    });
    this.refreshUi();
    app.actions.assembly = () => this.toggle();
    app.assemblyCommand = (text) => this.command(text);
    app.assemblyLink = () => (this.active && this.instances.length ? encodeAssembly({ instances: this.instances, mates: this.mates }) : null);
    // Opened from a shared link: rebuild that assembly once the engine is up.
    const m = /[#&]asm=([A-Za-z0-9_-]+)/u.exec(globalThis.location?.hash ?? '');
    if (m) {
      const doc = decodeAssembly(m[1], (id) => JOBS.some((j) => j.id === id));
      if (doc) setTimeout(() => void this.restore(doc, 'Opened the shared assembly.'), 2500);
      else app.say('That assembly link is damaged; nothing was opened.', 'warn');
    }
  }

  // ----- modes ---------------------------------------------------------------------------------

  private toggle(): void {
    if (this.active) {
      this.setActive(false);
      return;
    }
    this.setActive(true);
    if (!this.instances.length) {
      const saved = loadAssembly();
      const doc = saved ? decodeAssembly(saved, (id) => JOBS.some((j) => j.id === id)) : null;
      if (doc?.instances.length) {
        void this.restore(doc, 'Your last assembly, as you left it.');
        return;
      }
      void this.addCurrent();
    }
    ctx.app.say('Assembly: "+ This part" inserts the part on the bench. Mate: pinch a face or a round surface of the part that moves, then of the part it goes onto. Or say "assembly demo".', 'info');
  }

  private setActive(on: boolean): void {
    const { bench } = ctx;
    this.active = on;
    this.root.visible = on;
    bench.part.mesh.visible = !on;
    bench.part.edges.visible = !on;
    this.tool = 'none';
    this.first = null;
    this.marker.visible = false;
    this.playing = -1;
    setButton('lab:assembly', { toggled: on });
    this.refreshUi();
  }

  private setTool(t: Tool): void {
    this.tool = this.tool === t ? 'none' : t;
    this.first = null;
    this.marker.visible = false;
    const say: Record<Tool, string> = {
      none: 'Mate tool off.',
      mate: 'Mate: pinch a flat face or round surface on the part that moves, then on the part it goes onto.',
      hinge: 'Hinge: pinch the pin or hole on the part that turns, then the hole or pin it turns in.',
      slider: 'Slider: pinch the flat face that slides, then the face it slides on.',
    };
    ctx.app.say(say[this.tool], 'info');
    this.refreshUi();
  }

  // ----- instances -----------------------------------------------------------------------------

  private async build(job: string, params: Params): Promise<MeshData> {
    const res = await ctx.app.engine.run<'built'>({ type: 'build', job, params });
    if (res.gate.verdict === 'refused') throw new Error(`That part is refused by the truth gate: ${res.gate.reason ?? ''}`);
    return res.mesh;
  }

  private async addInstance(job: string, params: Params, material: string, pose?: Pose, name?: string): Promise<Instance> {
    const data = await this.build(job, params);
    const id = `i${this.nextId++}`;
    // Next to what is there, along +X.
    let x = 0;
    for (const v of this.views.values()) {
      v.group.updateMatrixWorld();
      x = Math.max(x, v.group.position.x + v.size * 0.6);
    }
    const inst: Instance = {
      id,
      name: name ?? `${jobById(job).title} ${this.instances.filter((i) => i.job === job).length + 1}`,
      job,
      params: { ...params },
      material,
      pose: pose ?? { p: [this.instances.length ? x + 20 : 0, 0, 0], q: IDENTITY },
      grounded: this.instances.length === 0,
    };
    this.instances.push(inst);
    this.makeView(inst, data);
    this.reseat();
    this.refreshUi();
    this.persist();
    return inst;
  }

  private makeView(inst: Instance, data: MeshData): void {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(data.positions.slice(), 3));
    g.setAttribute('normal', new BufferAttribute(data.normals.slice(), 3));
    g.setIndex(new BufferAttribute(data.indices.slice(), 1));
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const color = PALETTE[(this.views.size) % PALETTE.length];
    const mesh = new Mesh(g, new MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.12 }));
    mesh.name = `Instance ${inst.name}`;
    const group = new Group();
    group.add(mesh);
    this.root.add(group);
    this.views.set(inst.id, { group, mesh, data, size: Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) });
    this.applyPose(inst.id, inst.pose);
  }

  private applyPose(id: string, pose: Pose): void {
    const v = this.views.get(id);
    if (!v) return;
    v.group.position.set(pose.p[0], pose.p[1], pose.p[2]);
    v.group.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
  }

  /** Keep the assembly in the browser, so it is there next time. */
  private persist(): void {
    saveAssembly(this.instances.length ? encodeAssembly({ instances: this.instances, mates: this.mates }) : null);
  }

  /** Rebuild an assembly from a saved or shared document. */
  private async restore(doc: { instances: Instance[]; mates: Mate[] }, message: string): Promise<void> {
    const { app } = ctx;
    if (!this.active) this.setActive(true);
    for (const v of this.views.values()) this.root.remove(v.group);
    this.views.clear();
    this.instances = [];
    this.mates = [];
    this.keys = [];
    try {
      for (const i of doc.instances) {
        const data = await this.build(i.job, i.params);
        this.instances.push({ ...i });
        this.makeView(i, data);
        this.nextId = Math.max(this.nextId, parseInt(i.id.replace(/\D/gu, ''), 10) + 1 || this.nextId);
      }
      this.mates = doc.mates.map((m) => ({ ...m }));
      this.recentre = true;
      this.solve(true);
      this.refreshUi();
      this.persist();
      app.say(`${message} ${this.instances.length} parts, ${this.mates.length} mates.`, 'good');
    } catch (e) {
      if (!(e instanceof CancelledError)) app.say(e instanceof Error ? e.message : String(e), 'warn');
    }
  }

  private async addCurrent(): Promise<void> {
    const { app } = ctx;
    try {
      const inst = await this.addInstance(app.jobId.peek(), app.params.peek(), app.material.peek());
      app.say(`Inserted ${inst.name}${inst.grounded ? ' (grounded: it stays put; the others mate to it)' : ''}.`, 'good');
    } catch (e) {
      if (!(e instanceof CancelledError)) app.say(e instanceof Error ? e.message : String(e), 'warn');
    }
  }

  /** Scale to the bench and stand the whole assembly on the turntable. */
  private reseat(): void {
    let min = Infinity;
    let size = 1;
    const c = new Vector3();
    const box = new Vector3();
    for (const v of this.views.values()) {
      v.group.updateMatrix();
      v.mesh.geometry.computeBoundingBox();
      const bb = v.mesh.geometry.boundingBox!.clone().applyMatrix4(v.group.matrix);
      min = Math.min(min, bb.min.y);
      bb.getCenter(box);
      c.add(box);
      size = Math.max(size, bb.max.x - bb.min.x, bb.max.z - bb.min.z, bb.max.y - bb.min.y);
    }
    c.divideScalar(Math.max(1, this.views.size));
    // Fit the assembly in about 0.22 m on the bench.
    const s = Math.min(0.001 * 1.5, 0.22 / Math.max(1, size * 1.3));
    this.root.scale.setScalar(s);
    this.root.position.set(-c.x * s, Number.isFinite(min) ? -min * s : 0, -c.z * s);
  }

  // ----- mates ---------------------------------------------------------------------------------

  /** The reference under a pick: a fitted axis on a round surface, else the flat face. */
  private refAt(view: View, local: Vector3, normal: Vector3): Ref {
    const axis = fitAxis(view.data.positions, view.data.normals, [local.x, local.y, local.z], Math.max(2, view.size * 0.12));
    if (axis && Math.abs(normal.dot(new Vector3(...axis.dir))) < 0.35) return axis;
    return { kind: 'plane', point: [local.x, local.y, local.z], dir: [normal.x, normal.y, normal.z] };
  }

  private pick(instId: string, ref: Ref, world: Vector3): void {
    const { app } = ctx;
    if (!this.first) {
      this.first = { inst: instId, ref };
      this.root.worldToLocal(this.marker.position.copy(world));
      this.marker.visible = true;
      app.say(`${ref.kind === 'axis' ? 'Round surface' : 'Flat face'} on ${this.name(instId)}. Now pinch where it goes.`, 'info');
      return;
    }
    if (this.first.inst === instId) {
      app.say('Pick the second reference on a different part.', 'warn');
      return;
    }
    const a = this.first;
    this.first = null;
    this.marker.visible = false;
    let kind: MateKind;
    if (this.tool === 'hinge') kind = 'hinge';
    else if (this.tool === 'slider') kind = 'slider';
    else kind = a.ref.kind === 'axis' && ref.kind === 'axis' ? 'concentric' : 'coincident';
    if ((kind === 'hinge' || kind === 'concentric') && (a.ref.kind !== 'axis' || ref.kind !== 'axis')) {
      app.say(`${kind === 'hinge' ? 'A hinge' : 'Concentric'} needs two round surfaces (a pin and a hole). Try again.`, 'warn');
      return;
    }
    if ((kind === 'coincident' || kind === 'slider') && (a.ref.kind !== 'plane' || ref.kind !== 'plane')) {
      app.say('That pairs a flat face with a round one. Pick two flat faces or two round surfaces.', 'warn');
      return;
    }
    // The grounded part never moves: if it was picked first, swap.
    let moving = a.inst;
    let mref = a.ref;
    let target = instId;
    let tref = ref;
    if (this.instances.find((i) => i.id === moving)?.grounded) {
      [moving, mref, target, tref] = [target, tref, moving, mref];
    }
    const mate: Mate = { id: `m${this.mates.length + 1}`, kind, a: moving, ra: mref, b: target, rb: tref, value: 0 };
    this.mates.push(mate);
    this.solve(true);
    this.persist();
    app.say(`${kind[0].toUpperCase()}${kind.slice(1)}: ${this.name(moving)} to ${this.name(target)}.${kind === 'hinge' ? ' Say "turn the hinge to 90", or add keyframes and play.' : ''}`, 'good');
    ctx.sfx.play('bind');
    this.refreshUi();
  }

  private name(id: string): string {
    return this.instances.find((i) => i.id === id)?.name ?? id;
  }

  private solve(glide: boolean): void {
    const r = solveAssembly(this.instances, this.mates);
    for (const inst of r.instances) {
      const old = this.instances.find((i) => i.id === inst.id)!;
      if (glide) this.glide.push({ id: inst.id, from: old.pose, to: inst.pose, t: 0 });
      else this.applyPose(inst.id, inst.pose);
      old.pose = inst.pose;
    }
    if (r.failed.length) ctx.app.say(`Not met: ${r.failed.map((f) => f.reason).join('; ')}.`, 'warn');
    probe.assembly = { parts: this.instances.length, mates: this.mates.map((m) => `${m.kind}:${m.a}->${m.b}${m.value !== undefined ? `=${m.value}` : ''}`), failed: r.failed.length };
  }

  // ----- clash, explode ------------------------------------------------------------------------

  private matrix(pose: Pose): number[] {
    const [x, y, z, w] = pose.q;
    const r = [
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
    ];
    // Column-major: columns are the images of the axes.
    return [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, pose.p[0], pose.p[1], pose.p[2], 1];
  }

  private async clash(): Promise<void> {
    const { app } = ctx;
    for (const m of this.clashMeshes) {
      this.root.remove(m);
      m.geometry.dispose();
    }
    this.clashMeshes = [];
    if (this.instances.length < 2) {
      app.say('A clash check needs two parts or more.', 'info');
      return;
    }
    try {
      const res = await app.engine.run<'interfered'>({
        type: 'interfere',
        job: this.instances[0].job,
        params: this.instances[0].params,
        parts: this.instances.map((i) => ({ job: i.job, params: i.params, matrix: this.matrix(i.pose) })),
      });
      const red = new MeshStandardMaterial({ color: COLORS.red, emissive: new Color(COLORS.red), emissiveIntensity: 0.6, transparent: true, opacity: 0.9, depthTest: false });
      for (const c of res.clashes) {
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(c.mesh.positions, 3));
        g.setAttribute('normal', new BufferAttribute(c.mesh.normals, 3));
        g.setIndex(new BufferAttribute(c.mesh.indices, 1));
        const m = new Mesh(g, red);
        m.renderOrder = 29;
        this.root.add(m);
        this.clashMeshes.push(m);
      }
      probe.clash = res.clashes.map((c) => ({ a: this.instances[c.i].name, b: this.instances[c.j].name, mm3: +c.volume.toFixed(2) }));
      app.say(
        res.clashes.length
          ? `Clash: ${res.clashes.map((c) => `${this.instances[c.i].name} and ${this.instances[c.j].name}, ${c.volume.toFixed(1)} mm3`).join('; ')}. Shown red.`
          : 'No clashes: no two parts share any volume.',
        res.clashes.length ? 'bad' : 'good',
      );
    } catch (e) {
      if (!(e instanceof CancelledError)) app.say(e instanceof Error ? e.message : String(e), 'warn');
    }
  }

  private explode(): void {
    this.exploded = !this.exploded;
    const centre = new Vector3();
    for (const i of this.instances) centre.add(new Vector3(...i.pose.p));
    centre.divideScalar(Math.max(1, this.instances.length));
    for (const i of this.instances) {
      const v = this.views.get(i.id)!;
      // The grounded part stays; the others move out from the middle and up, the way an exploded view reads.
      const out = i.grounded ? new Vector3() : new Vector3(...i.pose.p).sub(centre).setY(0);
      if (!i.grounded) {
        if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
        out.normalize().multiplyScalar(v.size * 0.35).add(new Vector3(0, v.size * 0.45 * (this.instances.indexOf(i)), 0));
      }
      if (!this.exploded) out.set(0, 0, 0);
      const to: Pose = { p: [i.pose.p[0] + out.x, i.pose.p[1] + out.y, i.pose.p[2] + out.z], q: i.pose.q };
      this.glide.push({ id: i.id, from: this.currentPose(i.id), to, t: 0 });
    }
    setButton('asm:explode', { toggled: this.exploded });
  }

  private currentPose(id: string): Pose {
    const v = this.views.get(id)!;
    return { p: [v.group.position.x, v.group.position.y, v.group.position.z], q: [v.group.quaternion.x, v.group.quaternion.y, v.group.quaternion.z, v.group.quaternion.w] };
  }

  // ----- motion --------------------------------------------------------------------------------

  private drivers(): Mate[] {
    return this.mates.filter((m) => m.kind === 'hinge' || m.kind === 'slider' || m.kind === 'screw');
  }

  private key(): void {
    const ds = this.drivers();
    if (!ds.length) {
      ctx.app.say('A motion study needs a hinge or a slider to drive.', 'info');
      return;
    }
    const values: Record<string, number> = {};
    for (const m of ds) values[m.id] = m.value ?? 0;
    this.keys.push({ t: this.keys.length * 1.5, values });
    ctx.app.say(`Keyframe ${this.keys.length} at ${((this.keys.length - 1) * 1.5).toFixed(1)} s: ${ds.map((m) => `${m.kind} ${values[m.id].toFixed(0)}${m.kind === 'hinge' ? '°' : ' mm'}`).join(', ')}.`, 'info');
  }

  private playMotion(): void {
    const ds = this.drivers();
    if (!ds.length) {
      ctx.app.say('A motion study needs a hinge or a slider to drive.', 'info');
      return;
    }
    if (this.keys.length < 2) {
      // No keyframes: sweep every driver through a full cycle.
      this.keys = [0, 1, 2].map((k) => ({ t: k * 1.8, values: Object.fromEntries(ds.map((m) => [m.id, m.kind === 'hinge' ? [0, 120, 0][k] : [0, 30, 0][k]])) }));
    }
    this.playing = 0;
    ctx.app.say(`Playing the motion: ${this.keys.length} keyframes, ${this.keys[this.keys.length - 1].t.toFixed(1)} s.`, 'good');
  }

  /** Voice: "turn the hinge to 90", "slide to 20", "assembly demo". */
  /** The part being edited from the assembly (its instance id), while the bench shows it alone. */
  private editing: string | null = null;

  /** Edit a part in place: the bench shows it with every tool; "back to the assembly" puts the change back. */
  private editPart(n: number): string {
    const inst = this.instances[n - 1];
    if (!inst) return `There are ${this.instances.length} parts.`;
    const { app } = ctx;
    this.editing = inst.id;
    this.setActive(false);
    app.selectJob(inst.job);
    app.replaceParams(inst.params);
    app.setMaterial(inst.material);
    return `Editing ${inst.name}. Change it with any tool, then say "back to the assembly".`;
  }

  private async backToAssembly(): Promise<void> {
    const { app } = ctx;
    const inst = this.instances.find((i) => i.id === this.editing);
    this.editing = null;
    if (!inst) return;
    inst.params = { ...app.params.peek() };
    inst.material = app.material.peek();
    this.setActive(true);
    try {
      const data = await this.build(inst.job, inst.params);
      const old = this.views.get(inst.id);
      if (old) this.root.remove(old.group);
      this.views.delete(inst.id);
      this.makeView(inst, data);
      this.solve(false);
      this.persist();
      app.say(`${inst.name} updated in the assembly; its mates are solved again.`, 'good');
    } catch (e) {
      if (!(e instanceof CancelledError)) app.say(e instanceof Error ? e.message : String(e), 'warn');
    }
  }

  /** The bill of materials as CSV: item, name, part, material, quantity, mass each (g). */
  private bomCsv(): string {
    const rows = new Map<string, { name: string; job: string; material: string; qty: number; mass: number }>();
    for (const i of this.instances) {
      const key = `${i.job}|${i.material}|${JSON.stringify(i.params)}`;
      const r = rows.get(key);
      if (r) {
        r.qty++;
        continue;
      }
      const v = this.views.get(i.id);
      const vol = v ? massProperties({ positions: v.data.positions, indices: v.data.indices }).volume : 0;
      const density = MATERIALS.find((m) => m.id === i.material)?.density ?? 1.24;
      rows.set(key, { name: i.name, job: jobById(i.job).title, material: i.material.toUpperCase(), qty: 1, mass: (vol / 1000) * density });
    }
    const lines = ['Item,Name,Part,Material,Quantity,Mass each (g)'];
    [...rows.values()].forEach((r, k) => lines.push(`${k + 1},"${r.name}","${r.job}",${r.material},${r.qty},${r.mass.toFixed(2)}`));
    return lines.join('\n') + '\n';
  }

  private download(text: string | Uint8Array, name: string, type: string): void {
    const url = URL.createObjectURL(new Blob([text as BlobPart], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  private command(text: string): string | null {
    const t = text.toLowerCase();
    if (this.editing && /\b(back to (the )?assembly|done editing|finish editing)\b/u.test(t)) {
      void this.backToAssembly();
      return 'Back to the assembly.';
    }
    if (this.active) {
      const ed = t.match(/\bedit part (\d+)\b/u);
      if (ed) return this.editPart(parseInt(ed[1], 10));
      if (/\b(export|save|download)\b.*\b(step|stp)\b/u.test(t)) {
        const bodies = this.instances.flatMap((inst) => {
          const v = this.views.get(inst.id);
          if (!v) return [];
          v.group.updateMatrix();
          const e = v.group.matrix.elements;
          const src = v.data.positions;
          const out = new Float32Array(src.length);
          for (let i = 0; i < src.length; i += 3) {
            const x = src[i], y = src[i + 1], z = src[i + 2];
            out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
            out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
            out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          }
          return [{ name: inst.name, positions: out, indices: v.data.indices }];
        });
        if (!bodies.length) return 'The assembly is empty.';
        this.download(writeStep(bodies, 'assembly.step'), 'assembly.step', 'model/step');
        return `Saved assembly.step: ${bodies.length} solids where they sit now.`;
      }
      if (/\b(bill of materials|bom|parts list)\b/u.test(t)) {
        this.download(this.bomCsv(), 'assembly-bom.csv', 'text/csv');
        return `Bill of materials saved: ${this.instances.length} parts.`;
      }
      const lim = t.match(/\blimit (?:the )?(hinge|slider|screw)?.*?(-?\d+(?:\.\d+)?)\s*(?:to|and)\s*(-?\d+(?:\.\d+)?)/u);
      if (lim) {
        const m = [...this.drivers()].reverse().find((d) => !lim[1] || d.kind === lim[1]);
        if (!m) return 'There is nothing to limit.';
        m.min = Math.min(parseFloat(lim[2]), parseFloat(lim[3]));
        m.max = Math.max(parseFloat(lim[2]), parseFloat(lim[3]));
        this.solve(true);
        this.persist();
        return `${m.kind} limited to ${m.min} to ${m.max}${m.kind === 'hinge' || m.kind === 'screw' ? ' degrees' : ' mm'}.`;
      }
      const sc = t.match(/\bscrew\b.*?\bpitch\s*(\d+(?:\.\d+)?)/u);
      if (sc) {
        const m = [...this.mates].reverse().find((d) => d.kind === 'hinge' || d.kind === 'concentric');
        if (!m) return 'Make a hinge first, then turn it into a screw.';
        m.kind = 'screw';
        m.pitch = parseFloat(sc[1]);
        this.solve(true);
        this.persist();
        return `A screw: ${m.pitch} mm along the axis per turn. Turning it now moves it along.`;
      }
      const rk = t.match(/\brack\b.*?\b(?:radius|pitch radius)\s*(\d+(?:\.\d+)?)/u);
      if (rk) {
        const s = [...this.mates].reverse().find((d) => d.kind === 'slider' || d.kind === 'rack');
        const h = this.mates.find((d) => d.kind === 'hinge');
        if (!s || !h) return 'A rack and pinion needs a hinge (the pinion) and a slider (the rack).';
        s.kind = 'rack';
        s.follows = h.id;
        s.ratio = (2 * Math.PI * parseFloat(rk[1])) / 360;
        this.solve(true);
        this.persist();
        return `Rack and pinion: the rack moves ${(s.ratio * 360).toFixed(1)} mm per turn of the pinion.`;
      }
    }
    if (/\b(linkage|four bar|4 bar)( demo)?\b/u.test(t)) {
      void this.linkage();
      return 'Building a four-bar linkage: a closed loop, solved as one.';
    }
    if (/\bassembly demo\b|\bdemo assembly\b/u.test(t)) {
      void this.demo();
      return 'Building a hinged arm on a base: a demo assembly.';
    }
    if (!this.active) return null;
    const n = t.match(/(-?\d+(?:\.\d+)?)/u);
    if (/\b(turn|rotate|swing|open)\b/u.test(t) && n) {
      const h = this.drivers().find((m) => m.kind === 'hinge');
      if (!h) return 'There is no hinge to turn.';
      h.value = parseFloat(n[1]);
      this.solve(true);
      this.persist();
      return `Hinge at ${h.value} degrees.`;
    }
    if (/\b(slide|move)\b/u.test(t) && n) {
      const s = this.drivers().find((m) => m.kind === 'slider');
      if (!s) return 'There is no slider to move.';
      s.value = parseFloat(n[1]);
      this.solve(true);
      this.persist();
      return `Slider at ${s.value} mm.`;
    }
    if (/\b(animate|play)\b/u.test(t)) {
      this.playMotion();
      return 'Playing the motion.';
    }
    if (/\b(clash|interference)\b/u.test(t)) {
      void this.clash();
      return 'Checking for clashes.';
    }
    if (/\bexplode\b/u.test(t)) {
      this.explode();
      return 'Exploded view.';
    }
    return null;
  }

  /**
   * A four-bar linkage: a frame with two pins 40 mm apart, a 15 mm crank, a 40 mm coupler and a 35 mm rocker.
   * The loop closes only when all four are solved together; turning the crank drives the rocker
   * (Grashof crank-rocker: 15 + 40 <= 35 + 40), the motion checked against Freudenstein's equation in the tests.
   */
  private async linkage(): Promise<void> {
    const { app } = ctx;
    if (!this.active) this.setActive(true);
    for (const v of this.views.values()) this.root.remove(v.group);
    this.views.clear();
    this.instances = [];
    this.mates = [];
    this.keys = [];
    const bar = (len: number, pinUp: boolean): Params => {
      let p: Params = { nf: 0 };
      p = addFeature(p, OPS.BOX, { a: len + 12, b: 10, c: 4, d: len / 2 });
      p = addFeature(p, OPS.FILLET, { a: 4.9, b: 0 });
      p = addFeature(p, OPS.HOLE, { a: 6.6, b: 0, d: 0, e: 0, f: 4 });
      p = pinUp ? addFeature(p, OPS.CYL, { a: 6, c: 8, d: len, e: 0, f: 4 }) : addFeature(p, OPS.HOLE, { a: 6.6, b: 0, d: len, e: 0, f: 4 });
      return p;
    };
    let frame: Params = { nf: 0 };
    frame = addFeature(frame, OPS.BOX, { a: 76, b: 24, c: 6, d: 0 });
    frame = addFeature(frame, OPS.FILLET, { a: 5, b: 0 });
    frame = addFeature(frame, OPS.CYL, { a: 6, c: 10, d: -20, e: 0, f: 6 });
    frame = addFeature(frame, OPS.CYL, { a: 6, c: 10, d: 20, e: 0, f: 6 });
    try {
      const f = await this.addInstance('design', frame, 'pla', undefined, 'Frame');
      const crank = await this.addInstance('design', bar(15, true), 'petg', { p: [-20, 6, 30], q: IDENTITY }, 'Crank');
      const rocker = await this.addInstance('design', bar(35, true), 'abs', { p: [20, 6, 30], q: [0, 0.7, 0, 0.71] }, 'Rocker');
      const coupler = await this.addInstance('design', bar(40, false), 'pla', { p: [-5, 10, 40], q: IDENTITY }, 'Coupler');
      const axisY = (x: number): Ref => ({ kind: 'axis', point: [x, 0, 0], dir: [0, 1, 0] });
      const face = (y: number, up: boolean): Ref => ({ kind: 'plane', point: [0, y, 0], dir: [0, up ? 1 : -1, 0] });
      this.mates = [
        { id: 'm1', kind: 'hinge', a: crank.id, ra: axisY(0), b: f.id, rb: axisY(-20), value: 30 },
        { id: 'm2', kind: 'coincident', a: crank.id, ra: face(0, false), b: f.id, rb: face(6, true) },
        { id: 'm3', kind: 'concentric', a: rocker.id, ra: axisY(0), b: f.id, rb: axisY(20) },
        { id: 'm4', kind: 'coincident', a: rocker.id, ra: face(0, false), b: f.id, rb: face(6, true) },
        { id: 'm5', kind: 'concentric', a: coupler.id, ra: axisY(0), b: crank.id, rb: axisY(15) },
        { id: 'm6', kind: 'coincident', a: coupler.id, ra: face(0, false), b: crank.id, rb: face(4, true) },
        { id: 'm7', kind: 'concentric', a: coupler.id, ra: axisY(40), b: rocker.id, rb: axisY(35) },
      ];
      this.recentre = true;
      this.solve(true);
      this.keys = Array.from({ length: 9 }, (_, k) => ({ t: k * 0.6, values: { m1: 30 + k * 45 } }));
      this.persist();
      app.say('Four-bar linkage: frame, crank, coupler and rocker, a closed loop solved together. Play motion turns the crank a full turn; the rocker rocks.', 'good');
    } catch (e) {
      if (!(e instanceof CancelledError)) app.say(e instanceof Error ? e.message : String(e), 'warn');
    }
  }

  /** A base with a pin, an arm hinged on it, and a link: built from free designs, mated by the solver. */
  private async demo(): Promise<void> {
    const { app } = ctx;
    if (!this.active) this.setActive(true);
    this.instances = [];
    this.mates = [];
    this.keys = [];
    for (const v of this.views.values()) this.root.remove(v.group);
    this.views.clear();
    let base: Params = { nf: 0 };
    base = addFeature(base, OPS.BOX, { a: 90, b: 50, c: 10 });
    base = addFeature(base, OPS.FILLET, { a: 6, b: 0 });
    base = addFeature(base, OPS.CYL, { a: 12, c: 22, d: -28, e: 0, f: 10 });
    let arm: Params = { nf: 0 };
    arm = addFeature(arm, OPS.BOX, { a: 80, b: 18, c: 6 });
    arm = addFeature(arm, OPS.FILLET, { a: 8, b: 0 });
    arm = addFeature(arm, OPS.HOLE, { a: 13, b: 0, d: -30, e: 0, f: 6 });
    arm = addFeature(arm, OPS.CYL, { a: 10, c: 14, d: 30, e: 0, f: 6 });
    let link: Params = { nf: 0 };
    link = addFeature(link, OPS.BOX, { a: 50, b: 14, c: 5 });
    link = addFeature(link, OPS.FILLET, { a: 6.5, b: 0 });
    link = addFeature(link, OPS.HOLE, { a: 11, b: 0, d: -18, e: 0, f: 5 });
    try {
      const b = await this.addInstance('design', base, 'pla', undefined, 'Base');
      const a = await this.addInstance('design', arm, 'petg', { p: [10, 60, 40], q: [0.2, 0.1, 0, 0.97] }, 'Arm');
      const l = await this.addInstance('design', link, 'abs', { p: [60, 90, -30], q: [0, 0.3, 0.2, 0.93] }, 'Link');
      const axisY = (x: number, z = 0): Ref => ({ kind: 'axis', point: [x, 0, z], dir: [0, 1, 0] });
      const face = (y: number, up: boolean): Ref => ({ kind: 'plane', point: [0, y, 0], dir: [0, up ? 1 : -1, 0] });
      this.mates = [
        { id: 'm1', kind: 'hinge', a: a.id, ra: axisY(-30), b: b.id, rb: axisY(-28), value: 0 },
        { id: 'm2', kind: 'coincident', a: a.id, ra: face(0, false), b: b.id, rb: face(10, true) },
        { id: 'm3', kind: 'hinge', a: l.id, ra: axisY(-18), b: a.id, rb: axisY(30), value: 0 },
        { id: 'm4', kind: 'coincident', a: l.id, ra: face(0, false), b: a.id, rb: face(6, true) },
      ];
      // The link counter-turns at ratio 2, like a gear train: a coupled motion.
      this.mates[2] = { ...this.mates[2], kind: 'gear', follows: 'm1', ratio: 2 };
      this.recentre = true;
      this.solve(true);
      this.keys = [
        { t: 0, values: { m1: 0 } },
        { t: 1.6, values: { m1: 90 } },
        { t: 3.2, values: { m1: -45 } },
        { t: 4.8, values: { m1: 0 } },
      ];
      this.persist();
      app.say('Demo: an arm hinged on the base, and a link geared to the arm at 2 to 1. Play motion, explode, or run a clash check.', 'good');
    } catch (e) {
      if (!(e instanceof CancelledError)) app.say(e instanceof Error ? e.message : String(e), 'warn');
    }
  }

  // ----- UI ------------------------------------------------------------------------------------

  private refreshUi(): void {
    for (const [key] of TOOLS) setButton(key, { visible: this.active });
    setButton('asm:mate', { toggled: this.tool === 'mate' });
    setButton('asm:hinge', { toggled: this.tool === 'hinge' });
    setButton('asm:slider', { toggled: this.tool === 'slider' });
    const lines = this.active ? ['ASSEMBLY', ...this.instances.map((i, k) => `${k + 1} ${i.name}${i.grounded ? ' (fixed)' : ''}`), ...this.mates.map((m) => `${m.kind} ${this.name(m.a)} > ${this.name(m.b)}`)] : [];
    this.bom.forEach((l, i) => {
      if (i < lines.length) {
        l.set(lines[i], { bg: CSS.panel, border: i === 0 ? CSS.cyan : CSS.panel });
        l.visible = true;
      } else l.visible = false;
    });
    this.status.visible = false;
  }

  // ----- per frame -----------------------------------------------------------------------------

  update(delta: number): void {
    if (!this.active) return;
    (this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.world.camera : this.player.head).getWorldPosition(this.viewer);
    for (const l of this.bom) if (l.visible) faceViewer(l.mesh, this.viewer);
    // Glides.
    if (this.glide.length) {
      for (const g of this.glide) {
        g.t = Math.min(1, g.t + delta / 0.45);
        const k = g.t * g.t * (3 - 2 * g.t);
        const p: Vec3 = [g.from.p[0] + (g.to.p[0] - g.from.p[0]) * k, g.from.p[1] + (g.to.p[1] - g.from.p[1]) * k, g.from.p[2] + (g.to.p[2] - g.from.p[2]) * k];
        const q = new Quaternion(...g.from.q).slerp(new Quaternion(...g.to.q), k);
        this.applyPose(g.id, { p, q: [q.x, q.y, q.z, q.w] as Quat });
      }
      this.glide = this.glide.filter((g) => g.t < 1);
      // Re-centre only after parts were added: the grounded part must not drift while things move.
      if (!this.glide.length && this.recentre) {
        this.recentre = false;
        this.reseat();
      }
    }
    // Motion playback.
    if (this.playing >= 0 && this.keys.length >= 2) {
      this.playing += delta;
      const end = this.keys[this.keys.length - 1].t;
      if (this.playing > end) {
        this.playing = -1;
        this.persist();
      } else {
        let k = 0;
        while (k + 1 < this.keys.length - 1 && this.keys[k + 1].t <= this.playing) k++;
        const a = this.keys[k];
        const b = this.keys[k + 1];
        const u = Math.min(1, Math.max(0, (this.playing - a.t) / (b.t - a.t || 1)));
        const s = u * u * (3 - 2 * u);
        for (const m of this.drivers()) {
          if (m.id in a.values && m.id in b.values) m.value = a.values[m.id] + (b.values[m.id] - a.values[m.id]) * s;
        }
        this.solve(false);
      }
    }
    // Picking with the hand ray while a mate tool is on.
    if (this.tool === 'none') return;
    const meshes = [...this.views.values()].map((v) => v.mesh);
    for (const side of ['right', 'left'] as const) {
      const space = this.player.raySpaces[side];
      if (!space) continue;
      space.getWorldPosition(this.o);
      space.getWorldDirection(this.d);
      this.d.negate();
      this.ray.set(this.o, this.d);
      const hit = this.ray.intersectObjects(meshes, false)[0];
      if (!hit || !ctx.hands.get(side).pinchStarted) continue;
      const entry = [...this.views.entries()].find(([, v]) => v.mesh === hit.object);
      if (!entry || !hit.face) continue;
      const local = hit.object.worldToLocal(hit.point.clone());
      this.pick(entry[0], this.refAt(entry[1], local, hit.face.normal.clone()), hit.point.clone());
      break;
    }
  }
}
