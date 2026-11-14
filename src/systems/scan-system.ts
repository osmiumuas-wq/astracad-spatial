/**
 * Ray scan: pinch and sweep the hand's ray over a real object and the table
 * around it; let go. The surface hits (WebXR hit test) are fitted with an
 * oriented box (src/engine/scan.ts), drawn round the object with its rough
 * size. "Box for it" makes a project box that fits it with 1 mm all round.
 * Hit tests are good to about a centimetre, and the label says so: for a fit
 * that matters, measure with your fingers.
 */

import { BufferAttribute, BufferGeometry, createSystem, Group, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, VisibilityState } from '@iwsdk/core';
import { ctx, probe } from '../app/context.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { COLORS, CSS } from '../app/palette.js';
import { makeButton, setButton } from '../app/ui3d.js';
import { ScanBox, scanBox } from '../engine/scan.js';

type Side = 'left' | 'right';
const MAX_HITS = 4000;

export class ScanSystem extends createSystem({}) {
  private state: 'off' | 'ready' | 'sweeping' | 'done' = 'off';
  private hits: [number, number, number][] = [];
  private sweeping: Side | null = null;
  private dots!: Mesh<SphereGeometry, MeshBasicMaterial>[];
  private dotIndex = 0;
  private box!: LineSegments<BufferGeometry, LineBasicMaterial>;
  private label!: TextLabel;
  private result: ScanBox | null = null;
  private readonly byInput = new Map<XRInputSource, XRHitTestSource>();
  private readonly requested = new Set<XRInputSource>();
  private session: XRSession | null = null;
  private readonly m = new Matrix4();
  private readonly v = new Vector3();
  private readonly eye = new Vector3();
  private readonly btnGroup = new Group();

  init(): void {
    const add = <T extends Mesh | LineSegments>(o: T): T => {
      o.frustumCulled = false;
      o.visible = false;
      this.world.createTransformEntity(o, { persistent: true });
      return o;
    };
    const dotMat = new MeshBasicMaterial({ color: COLORS.cyan, toneMapped: false, transparent: true, opacity: 0.85 });
    const dotGeo = new SphereGeometry(0.0018, 6, 4);
    this.dots = Array.from({ length: 160 }, () => add(new Mesh(dotGeo, dotMat)));
    this.box = add(new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: COLORS.amber, toneMapped: false })));
    this.box.renderOrder = 40;
    this.label = new TextLabel(0.016);
    this.label.visible = false;
    this.world.createTransformEntity(this.label.mesh, { persistent: true });
    this.btnGroup.visible = true;
    const e = this.world.createTransformEntity(this.btnGroup, { persistent: true });
    makeButton(e, { key: 'scan:box', label: 'Box for it', width: 0.07, height: 0.024, tone: 'primary' }, () => this.boxForIt());
    setButton('scan:box', { visible: false });
    ctx.app.actions.scan = () => this.toggle();
  }

  private toggle(): void {
    if (this.state !== 'off') {
      this.end();
      return;
    }
    this.state = 'ready';
    this.hits = [];
    setButton('lab:scan', { toggled: true });
    ctx.app.say('Ray scan: point at the object, pinch, and sweep the ray over it and the table round it. Let go to measure.', 'info');
  }

  private end(): void {
    this.state = 'off';
    this.sweeping = null;
    this.box.visible = false;
    this.label.visible = false;
    for (const d of this.dots) d.visible = false;
    setButton('lab:scan', { toggled: false });
    setButton('scan:box', { visible: false });
  }

  private boxForIt(): void {
    const r = this.result;
    if (!r) return;
    const { app } = ctx;
    const t = 2;
    const gap = 1;
    app.selectJob('project-box');
    app.setParams({ W: Math.round(r.length + 2 * (t + gap)), D: Math.round(r.width + 2 * (t + gap)), H: Math.round(r.height + t + gap), t });
    app.say(`A project box for it: inside ${Math.round(r.length + 2 * gap)} x ${Math.round(r.width + 2 * gap)} mm, ${Math.round(r.height + gap)} mm deep. The scan is rough (about 1 cm); measure with your fingers for a snug fit.`, 'good');
    this.end();
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

  private finish(): void {
    const r = scanBox(this.hits);
    this.sweeping = null;
    const ys = this.hits.map((p) => p[1]).sort((p, q) => p - q);
    const at = (q: number): number => +(ys[Math.round(q * (ys.length - 1))] ?? 0).toFixed(4);
    probe.scan = { ...(r ? { L: +r.length.toFixed(1), W: +r.width.toFixed(1), H: +r.height.toFixed(1), points: r.points } : {}), hits: this.hits.length, y: [at(0), at(0.05), at(0.5), at(0.95), at(1)] };
    if (!r || r.length < 5) {
      this.state = 'ready';
      this.hits = [];
      ctx.app.say('Nothing standing above the table there. Sweep over the object and some table round it.', 'warn');
      return;
    }
    this.result = r;
    this.state = 'done';
    // The box: 12 edges, world metres.
    const ca = Math.cos(r.angle);
    const sa = Math.sin(r.angle);
    const L = r.length / 2000;
    const W = r.width / 2000;
    const corner = (u: number, v: number, y: number): number[] => [r.centre[0] + u * ca - v * sa, y, r.centre[1] + u * sa + v * ca];
    const c: number[][] = [];
    for (const y of [r.floor, r.floor + r.height / 1000]) for (const [u, v] of [[-L, -W], [L, -W], [L, W], [-L, W]]) c.push(corner(u, v, y));
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    const pos = new Float32Array(edges.flatMap(([a, b]) => [...c[a], ...c[b]]));
    this.box.geometry.dispose();
    this.box.geometry = new BufferGeometry();
    this.box.geometry.setAttribute('position', new BufferAttribute(pos, 3));
    this.box.visible = true;
    this.label.set(`About ${r.length.toFixed(0)} x ${r.width.toFixed(0)} x ${r.height.toFixed(0)} mm (±1 cm)`, { bg: CSS.panel, border: CSS.amber });
    this.label.mesh.position.set(r.centre[0], r.floor + r.height / 1000 + 0.04, r.centre[1]);
    this.label.visible = true;
    this.btnGroup.position.set(r.centre[0], r.floor + r.height / 1000 + 0.075, r.centre[1]);
    setButton('scan:box', { visible: true });
    ctx.sfx.play('lock');
    ctx.app.say(`Scanned: about ${r.length.toFixed(0)} by ${r.width.toFixed(0)} by ${r.height.toFixed(0)} mm, give or take a centimetre (${r.points} surface points).`, 'good');
  }

  update(): void {
    if (this.state === 'off' || this.world.visibilityState.peek() === VisibilityState.NonImmersive) return;
    this.player.head.getWorldPosition(this.eye);
    if (this.label.visible) faceViewer(this.label.mesh, this.eye);
    if (this.btnGroup.visible) faceViewer(this.btnGroup, this.eye);
    if (this.state === 'done') return;
    const { hands } = ctx;
    const frame = this.world.xrFrame;
    const session = this.world.session;
    const ref = this.world.xrReferenceSpace;
    if (!frame || !session || !ref) return;
    this.ensureSources(session);
    this.player.updateMatrixWorld();
    for (const [src, hts] of this.byInput) {
      const side = src.handedness as Side;
      const hand = hands.get(side);
      if (this.state === 'ready' && hand.pinchStarted) {
        this.state = 'sweeping';
        this.sweeping = side;
        this.hits = [];
        this.dotIndex = 0;
      }
      if (this.state !== 'sweeping' || this.sweeping !== side) continue;
      if (!hand.pinching) {
        this.finish();
        return;
      }
      const pose = frame.getHitTestResults(hts)[0]?.getPose(ref);
      if (!pose || this.hits.length >= MAX_HITS) continue;
      this.m.fromArray(pose.transform.matrix).premultiply(this.player.matrixWorld);
      this.v.setFromMatrixPosition(this.m);
      // Only new places: a ray held still adds nothing.
      const last = this.hits[this.hits.length - 1];
      if (last && Math.hypot(last[0] - this.v.x, last[1] - this.v.y, last[2] - this.v.z) < 0.002) continue;
      this.hits.push([this.v.x, this.v.y, this.v.z]);
      // A trail of dots shows what has been scanned.
      const d = this.dots[this.dotIndex++ % this.dots.length];
      d.position.copy(this.v);
      d.visible = true;
    }
  }
}
