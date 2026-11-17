/**
 * Drill template: the part's mounting face, life-size, stuck on a real
 * surface. The engine sections the solid just inside the face the fixture
 * holds (src/engine/template.ts); the outline and round holes are drawn where
 * the hand's ray meets the wall (WebXR hit test), oriented with the part's up
 * pointing up the wall, and seen as if through the wall (as the part will sit).
 * Each hole gets a crosshair and its size; mark the centres, then drill.
 */

import { BufferAttribute, BufferGeometry, createSystem, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Vector3, VisibilityState } from '@iwsdk/core';
import { ctx, probe } from '../app/context.js';
import { CancelledError } from '../app/engine-client.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { COLORS, CSS } from '../app/palette.js';
import { setButton } from '../app/ui3d.js';
import type { Vec2 } from '../engine/types.js';

type Side = 'left' | 'right';

/** A flat ribbon (in the XY plane, z = 0) along a polyline, w metres wide. */
function ribbon(points: Vec2[], w: number, closed: boolean): BufferGeometry {
  const n = closed ? points.length : points.length - 1;
  const pos = new Float32Array(n * 12);
  const idx = new Uint32Array(n * 6);
  for (let k = 0; k < n; k++) {
    const [ax, ay] = points[k];
    const [bx, by] = points[(k + 1) % points.length];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / len) * (w / 2);
    const ny = ((bx - ax) / len) * (w / 2);
    pos.set([ax + nx, ay + ny, 0, ax - nx, ay - ny, 0, bx + nx, by + ny, 0, bx - nx, by - ny, 0], k * 12);
    const v = k * 4;
    idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], k * 6);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  return g;
}

export class TemplateSystem extends createSystem({}) {
  private state: 'off' | 'loading' | 'aim' | 'placed' = 'off';
  private sheet = new Group();
  private reticle!: Mesh<RingGeometry, MeshBasicMaterial>;
  private label!: TextLabel;
  private holeLabels: TextLabel[] = [];
  private data: { outline: Vec2[]; holes: { c: Vec2; d: number }[]; text: string } | null = null;
  private readonly byInput = new Map<XRInputSource, XRHitTestSource>();
  private readonly requested = new Set<XRInputSource>();
  private session: XRSession | null = null;
  private readonly m = new Matrix4();
  private readonly hit = new Vector3();
  private readonly normal = new Vector3();
  private readonly q = new Quaternion();
  private readonly eye = new Vector3();
  private warned = false;

  init(): void {
    this.sheet.name = 'Drill template';
    this.sheet.visible = false;
    this.world.createTransformEntity(this.sheet, { persistent: true });
    this.reticle = new Mesh(new RingGeometry(0.004, 0.0055, 32), new MeshBasicMaterial({ color: COLORS.cyan, toneMapped: false, depthTest: false }));
    this.reticle.renderOrder = 40;
    this.reticle.visible = false;
    this.world.createTransformEntity(this.reticle, { persistent: true });
    this.label = new TextLabel(0.014);
    this.label.visible = false;
    this.world.createTransformEntity(this.label.mesh, { persistent: true });
    ctx.app.actions.template = () => void this.toggle();
  }

  private async toggle(): Promise<void> {
    const { app } = ctx;
    if (this.state !== 'off') {
      this.end();
      return;
    }
    this.state = 'loading';
    setButton('lab:template', { toggled: true });
    try {
      const res = await app.engine.run<'templated'>({ type: 'template', job: app.jobId.peek(), params: app.params.peek() });
      if (this.state !== 'loading') return;
      if (!res.outline.length) throw new Error('This part has no face to make a template from.');
      this.data = { outline: res.outline, holes: res.holes, text: res.label };
      probe.template = { holes: res.holes.map((h) => ({ c: h.c.map((v) => +v.toFixed(2)), d: +h.d.toFixed(2) })), label: res.label };
      this.state = 'aim';
      app.say(`Drill template: ${res.label}. Point at the wall and pinch to stick it there, life-size.`, 'info');
    } catch (e) {
      if (!(e instanceof CancelledError)) app.say(e instanceof Error ? e.message : String(e), 'warn');
      this.end();
    }
  }

  private end(): void {
    this.state = 'off';
    this.sheet.visible = false;
    this.reticle.visible = false;
    this.label.visible = false;
    for (const l of this.holeLabels) l.visible = false;
    setButton('lab:template', { toggled: false });
  }

  private ensureSources(session: XRSession): void {
    if (session !== this.session) {
      this.byInput.forEach((s) => s.cancel());
      this.byInput.clear();
      this.requested.clear();
      this.session = session;
    }
    if (typeof session.requestHitTestSource !== 'function') return;
    for (const src of session.inputSources) {
      if ((src.handedness !== 'left' && src.handedness !== 'right') || this.requested.has(src)) continue;
      this.requested.add(src);
      session
        .requestHitTestSource({ space: src.targetRaySpace })
        ?.then((s) => this.byInput.set(src, s))
        .catch(() => this.requested.delete(src));
    }
  }

  /** Lay the template on the surface at `point` with outward normal `n` (world). */
  private place(point: Vector3, n: Vector3): void {
    const d = this.data;
    if (!d) return;
    for (const c of [...this.sheet.children]) {
      this.sheet.remove(c);
      (c as Mesh).geometry?.dispose();
    }
    // The face sits against the wall: its outward normal z' points into the wall.
    const zIn = n.clone().negate();
    const worldUp = new Vector3(0, 1, 0);
    let v = worldUp.clone().sub(n.clone().multiplyScalar(worldUp.dot(n)));
    if (v.lengthSq() < 0.05) {
      // A horizontal surface: "up" on the template points away from the viewer.
      this.player.head.getWorldDirection(v);
      v.negate().setY(0);
    }
    v = v.normalize();
    const u = new Vector3().crossVectors(v, zIn).normalize();
    this.m.makeBasis(u, v, zIn);
    this.sheet.quaternion.setFromRotationMatrix(this.m);
    // Centre the outline on the point, a millimetre off the surface.
    let cx = 0;
    let cy = 0;
    for (const [x, y] of d.outline) {
      cx += x;
      cy += y;
    }
    cx /= d.outline.length;
    cy /= d.outline.length;
    this.sheet.position.copy(point).add(n.clone().multiplyScalar(0.001));
    const s = 0.001;
    const mm = (p: Vec2): Vec2 => [(p[0] - cx) * s, (p[1] - cy) * s];
    const mat = (color: number): MeshBasicMaterial => new MeshBasicMaterial({ color, toneMapped: false, side: DoubleSide, depthTest: false, transparent: true, forceSinglePass: true });
    const add = (g: BufferGeometry, color: number): void => {
      const mesh = new Mesh(g, mat(color));
      mesh.renderOrder = 41;
      this.sheet.add(mesh);
    };
    add(ribbon(d.outline.map(mm), 0.0015, true), COLORS.cyan);
    this.holeLabels.forEach((l) => (l.visible = false));
    d.holes.forEach((h, i) => {
      const [x, y] = mm(h.c);
      const r = (h.d / 2) * s;
      const circle: Vec2[] = Array.from({ length: 40 }, (_, k) => [x + r * Math.cos((2 * Math.PI * k) / 40), y + r * Math.sin((2 * Math.PI * k) / 40)]);
      add(ribbon(circle, 0.0008, true), COLORS.amber);
      const arm = r + 0.006;
      add(ribbon([[x - arm, y], [x + arm, y]], 0.0006, false), COLORS.amber);
      add(ribbon([[x, y - arm], [x, y + arm]], 0.0006, false), COLORS.amber);
      if (!this.holeLabels[i]) {
        this.holeLabels[i] = new TextLabel(0.008);
        this.world.createTransformEntity(this.holeLabels[i].mesh, { persistent: true });
      }
      const l = this.holeLabels[i];
      l.set(`⌀${h.d.toFixed(1)}`, { bg: CSS.panel, border: CSS.amber });
      this.sheet.localToWorld(l.mesh.position.set(x + r + 0.012, y + r + 0.006, 0));
      l.visible = true;
    });
    this.sheet.visible = true;
    this.label.set(`Life-size template: ${d.text}`, { bg: CSS.panel, border: CSS.cyan });
    this.label.mesh.position.copy(this.sheet.position).add(v.clone().multiplyScalar(0.07)).add(n.clone().multiplyScalar(0.01));
    this.label.visible = true;
    this.state = 'placed';
    ctx.sfx.play('bind', point);
    ctx.app.say(`Template placed. Mark the ${d.holes.length === 1 ? 'centre' : 'centres'} of the crosshairs and drill. Pinch again to move it.`, 'good');
    probe.templatePlaced = { at: point.toArray().map((x) => +x.toFixed(3)), normal: n.toArray().map((x) => +x.toFixed(3)) };
  }

  update(): void {
    if (this.state === 'off' || this.state === 'loading') return;
    if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) return;
    const { hands, app } = ctx;
    this.player.head.getWorldPosition(this.eye);
    if (this.label.visible) faceViewer(this.label.mesh, this.eye);
    for (const l of this.holeLabels) if (l.visible) faceViewer(l.mesh, this.eye);
    const frame = this.world.xrFrame;
    const session = this.world.session;
    const ref = this.world.xrReferenceSpace;
    if (!frame || !session || !ref) return;
    this.ensureSources(session);
    if (!this.byInput.size) {
      if (!this.warned && typeof session.requestHitTestSource !== 'function') {
        this.warned = true;
        app.say('This headset gives the page no surface hits, so the template cannot be stuck on a wall here.', 'warn');
      }
      return;
    }
    this.player.updateMatrixWorld();
    // The dominant hand's ray first; whichever hand pinches while its ray is on a surface places it.
    const order: Side[] = app.settings.peek().handed === 'left' ? ['left', 'right'] : ['right', 'left'];
    let shown = false;
    for (const want of order) {
      for (const [src, hts] of this.byInput) {
        if (src.handedness !== want) continue;
        const pose = frame.getHitTestResults(hts)[0]?.getPose(ref);
        if (!pose) continue;
        this.m.fromArray(pose.transform.matrix).premultiply(this.player.matrixWorld);
        this.hit.setFromMatrixPosition(this.m);
        // A hit pose's +Y axis is the surface normal.
        this.normal.set(this.m.elements[4], this.m.elements[5], this.m.elements[6]).normalize();
        if (!shown) {
          this.reticle.position.copy(this.hit).add(this.normal.clone().multiplyScalar(0.002));
          this.q.setFromUnitVectors(new Vector3(0, 0, 1), this.normal);
          this.reticle.quaternion.copy(this.q);
          this.reticle.visible = true;
          shown = true;
        }
        if (hands.get(want).pinchStarted) {
          this.place(this.hit.clone(), this.normal.clone());
          return;
        }
      }
    }
    if (!shown) this.reticle.visible = false;
  }
}
