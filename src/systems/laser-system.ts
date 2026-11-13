/**
 * Laser tape: for things beyond arm's reach (a shelf, a gap between walls),
 * each hand casts a ray onto the real room using WebXR hit testing; a pinch
 * drops a point where the ray meets a real surface, a second pinch drops the
 * other end, and the distance is locked like any other measurement (and bound
 * to the selected dimension). Accuracy is the headset's room geometry, a few
 * millimetres to centimetres; the reading says so.
 *
 * Turned on by pressing Measure while already measuring.
 */

import {
  BufferAttribute,
  BufferGeometry,
  createSystem,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { ctx, probe } from '../app/context.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { COLORS, CSS } from '../app/palette.js';

type Side = 'left' | 'right';

export class LaserSystem extends createSystem({}) {
  private sources = new Map<Side, XRHitTestSource>();
  private readonly byInput = new Map<XRInputSource, XRHitTestSource>();
  private readonly requested = new Set<XRInputSource>();
  private session: XRSession | null = null;
  private reticle!: Mesh<RingGeometry, MeshBasicMaterial>;
  private ends: Mesh<SphereGeometry, MeshBasicMaterial>[] = [];
  private beam!: Line<BufferGeometry, LineBasicMaterial>;
  private span!: Line<BufferGeometry, LineBasicMaterial>;
  private label!: TextLabel;
  private a: Vector3 | null = null;
  private readonly hit = new Vector3();
  private readonly m = new Matrix4();
  private readonly eye = new Vector3();
  private warned = false;

  init(): void {
    const add = <T extends Mesh | Line>(o: T): T => {
      o.frustumCulled = false;
      o.visible = false;
      this.world.createTransformEntity(o, { persistent: true });
      return o;
    };
    this.reticle = add(new Mesh(new RingGeometry(0.006, 0.01, 32), new MeshBasicMaterial({ color: COLORS.cyan, toneMapped: false, depthTest: false })));
    this.reticle.renderOrder = 40;
    for (let i = 0; i < 2; i++) {
      this.ends.push(add(new Mesh(new SphereGeometry(0.006, 16, 12), new MeshBasicMaterial({ color: COLORS.amber, toneMapped: false }))));
    }
    const lineGeo = (): BufferGeometry => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
      return g;
    };
    this.beam = add(new Line(lineGeo(), new LineBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.5, toneMapped: false })));
    this.span = add(new Line(lineGeo(), new LineBasicMaterial({ color: COLORS.amber, toneMapped: false })));
    this.label = new TextLabel(0.03);
    this.label.visible = false;
    this.world.createTransformEntity(this.label.mesh, { persistent: true });
    this.cleanupFuncs.push(
      ctx.app.laser.subscribe((on) => {
        this.a = null;
        if (!on) this.hideAll();
      }),
    );
  }

  private hideAll(): void {
    this.reticle.visible = false;
    this.beam.visible = false;
    this.span.visible = false;
    this.ends.forEach((e) => (e.visible = false));
    this.label.visible = false;
  }

  private setLine(l: Line<BufferGeometry, LineBasicMaterial>, p: Vector3, q: Vector3): void {
    const arr = (l.geometry.getAttribute('position') as BufferAttribute).array as Float32Array;
    p.toArray(arr, 0);
    q.toArray(arr, 3);
    l.geometry.getAttribute('position').needsUpdate = true;
    l.visible = true;
  }

  /**
   * One hit-test source per input source's pointing ray. Keyed by the input
   * source itself: switching between controllers and hands replaces the
   * sources, and a ray left over from a put-down controller must not be used.
   */
  private ensureSources(session: XRSession): void {
    if (session !== this.session) {
      this.byInput.forEach((s) => s.cancel());
      this.byInput.clear();
      this.requested.clear();
      this.session = session;
    }
    if (typeof session.requestHitTestSource !== 'function') return;
    const live = new Set<XRInputSource>();
    for (const src of session.inputSources) {
      if (src.handedness !== 'left' && src.handedness !== 'right') continue;
      live.add(src);
      if (this.requested.has(src)) continue;
      this.requested.add(src);
      session
        .requestHitTestSource({ space: src.targetRaySpace })
        ?.then((s) => this.byInput.set(src, s))
        .catch(() => this.requested.delete(src));
    }
    for (const [src, s] of this.byInput) {
      if (!live.has(src)) {
        s.cancel();
        this.byInput.delete(src);
        this.requested.delete(src);
      }
    }
    this.sources.clear();
    for (const [src, s] of this.byInput) this.sources.set(src.handedness as Side, s);
  }

  update(): void {
    const { app, hands, sfx } = ctx;
    if (!app.laser.peek() || app.mode.peek() !== 'measure' || this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      if (this.reticle.visible || this.label.visible) this.hideAll();
      return;
    }
    const frame = this.world.xrFrame;
    const session = this.world.session;
    const ref = this.world.xrReferenceSpace;
    if (!frame || !session || !ref) return;
    this.ensureSources(session);
    if (!this.sources.size) {
      if (!this.warned && typeof session.requestHitTestSource !== 'function') {
        this.warned = true;
        app.say('This headset gives the page no surface hits, so the laser tape cannot work here.', 'warn');
      }
      return;
    }
    this.player.updateMatrixWorld();
    // Use the dominant hand's ray, or the other one if only it hits.
    const order: Side[] = app.settings.peek().handed === 'left' ? ['left', 'right'] : ['right', 'left'];
    let side: Side | null = null;
    for (const s of order) {
      const src = this.sources.get(s);
      const res = src ? frame.getHitTestResults(src) : [];
      const pose = res[0]?.getPose(ref);
      if (!pose) continue;
      this.m.fromArray(pose.transform.matrix).premultiply(this.player.matrixWorld);
      this.hit.setFromMatrixPosition(this.m);
      side = s;
      break;
    }
    if (!side) {
      this.reticle.visible = false;
      this.beam.visible = false;
      return;
    }
    const hand = hands.get(side);
    this.reticle.position.copy(this.hit);
    this.player.head.getWorldPosition(this.eye);
    this.reticle.lookAt(this.eye);
    this.reticle.visible = true;
    if (hand.tracked) this.setLine(this.beam, hand.pinchPoint, this.hit);
    if (this.a) {
      this.setLine(this.span, this.a, this.hit);
      this.showLabel(this.a, this.hit, false);
    }
    if (!hand.tracked || !hand.pinchStarted) return;
    if (!this.a) {
      this.a = this.hit.clone();
      this.ends[0].position.copy(this.a);
      this.ends[0].visible = true;
      this.ends[1].visible = false;
      sfx.play('grab', this.a);
      return;
    }
    const b = this.hit.clone();
    const mm = this.a.distanceTo(b) * 1000;
    this.ends[1].position.copy(b);
    this.ends[1].visible = true;
    this.setLine(this.span, this.a, b);
    this.showLabel(this.a, b, true);
    sfx.play('lock', b);
    probe.laser = Math.round(mm * 10) / 10;
    const id = app.selected.peek();
    app.lockMeasurement({ value: mm, spread: 0, method: 'laser', samples: 1 });
    if (id) app.bindMeasurement(id);
    app.say(`Laser: ${mm.toFixed(0)} mm between the two points (room geometry: a few mm to a few cm).`, 'info');
    this.a = null;
  }

  private showLabel(a: Vector3, b: Vector3, locked: boolean): void {
    const mm = a.distanceTo(b) * 1000;
    this.label.set(`${locked ? 'Locked ' : ''}${mm >= 1000 ? `${(mm / 1000).toFixed(3)} m` : `${mm.toFixed(0)} mm`}`, { border: locked ? CSS.green : CSS.amber });
    this.label.mesh.position.copy(a).add(b).multiplyScalar(0.5).add(this.eye.set(0, 0.04, 0));
    this.player.head.getWorldPosition(this.eye);
    faceViewer(this.label.mesh, this.eye);
    this.label.visible = true;
  }
}
