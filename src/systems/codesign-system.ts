/**
 * Co-design presence: sends this person's head, hands and turntable angle to
 * the partner 15 times a second, and draws the partner at this bench: a head
 * with a visor (or a screen outline for a partner on a phone or PC), their
 * fingertips, and a name tag. Everything is placed in the turntable's frame,
 * so the partner's finger lands on the same feature of the part on both
 * benches. The guest's turntable carries an extra half turn, which seats the
 * two people opposite each other.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  createSystem,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { HandPose, Pose } from '../app/codesign.js';
import { ctx, probe } from '../app/context.js';
import { HandState } from '../app/hands.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { COLORS, CSS } from '../app/palette.js';

const SEND_DT = 1 / 15;
/** Hide the partner after this long without a pose, s. */
const STALE_S = 2;
/** Points per hand: wrist, thumb tip, index tip, middle tip, palm. */
const HAND_POINTS = 5;
const round = (v: number): number => Math.round(v * 1e4) / 1e4;

export class CoDesignSystem extends createSystem({}) {
  private avatar!: Group;
  private head!: Group;
  private visor!: Mesh<BoxGeometry, MeshBasicMaterial>;
  private skull!: Mesh<SphereGeometry, MeshBasicMaterial>;
  private tag!: TextLabel;
  private tips: Mesh<SphereGeometry, MeshBasicMaterial>[] = [];
  private bones!: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly boneBuf = new Float32Array(2 * 4 * 2 * 3);
  /** Smoothed partner points: [left 5, right 5] x 3. */
  private readonly shown = new Float32Array(2 * HAND_POINTS * 3);
  private readonly headPos = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly targetQuat = new Quaternion();
  private readonly tmp = new Vector3();
  private readonly tq = new Quaternion();
  private readonly viewer = new Vector3();
  private sendClock = 0;
  private lastPoseAt = 0;
  private lastRemoteSpin: number | null = null;
  private lastLocalSpin = 0;
  private hasShown = [false, false];

  init(): void {
    this.avatar = new Group();
    this.avatar.name = 'Co-design partner';
    this.avatar.visible = false;

    this.head = new Group();
    this.skull = new Mesh(
      new SphereGeometry(0.075, 24, 16),
      new MeshBasicMaterial({ color: COLORS.violet, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false }),
    );
    this.skull.scale.set(1, 1.15, 1.08);
    this.visor = new Mesh(
      new BoxGeometry(0.16, 0.055, 0.05),
      new MeshBasicMaterial({ color: COLORS.violet, transparent: true, opacity: 0.55, toneMapped: false }),
    );
    // Head space: -Z is where the partner looks.
    this.visor.position.set(0, 0.005, -0.07);
    this.tag = new TextLabel(0.022);
    this.tag.mesh.position.set(0, 0.13, 0);
    this.head.add(this.skull, this.visor);
    this.avatar.add(this.head, this.tag.mesh);

    const tipGeo = new SphereGeometry(1, 12, 8);
    for (let i = 0; i < 2 * HAND_POINTS; i++) {
      const k = i % HAND_POINTS;
      const m = new Mesh(tipGeo, new MeshBasicMaterial({ color: COLORS.violet, toneMapped: false }));
      m.scale.setScalar(k === 0 ? 0.011 : k === 4 ? 0.016 : 0.0075);
      if (k === 4) {
        m.material.transparent = true;
        m.material.opacity = 0.35;
      }
      this.tips.push(m);
      this.avatar.add(m);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.boneBuf, 3));
    this.bones = new LineSegments(g, new LineBasicMaterial({ color: COLORS.violet, transparent: true, opacity: 0.8, toneMapped: false }));
    this.bones.frustumCulled = false;
    this.avatar.add(this.bones);

    ctx.bench.turntable.add(this.avatar);
    this.world.createTransformEntity(this.avatar, { parent: ctx.turntableEntity, persistent: true });
  }

  /** A world point into the turntable frame, rounded for the wire. */
  private local(p: Vector3, out: number[]): void {
    this.tmp.copy(p);
    ctx.bench.turntable.worldToLocal(this.tmp);
    out.push(round(this.tmp.x), round(this.tmp.y), round(this.tmp.z));
  }

  private handPose(h: HandState): HandPose | null {
    if (!h.tracked) return null;
    const out: number[] = [];
    for (const p of [h.wrist, h.thumbTip, h.indexTip, h.middleTip, h.palm]) this.local(p, out);
    return out;
  }

  private offset(): number {
    return ctx.codesign.role.peek() === 'guest' ? Math.PI : 0;
  }

  private send(immersive: boolean): void {
    const { bench, hands, codesign } = ctx;
    const eye = immersive ? this.player.head : this.world.camera;
    const head: number[] = [];
    eye.getWorldPosition(this.viewer);
    this.local(this.viewer, head);
    eye.getWorldQuaternion(this.tq);
    bench.turntable.getWorldQuaternion(this.headQuat);
    this.tq.premultiply(this.headQuat.invert());
    head.push(round(this.tq.x), round(this.tq.y), round(this.tq.z), round(this.tq.w));
    const pose: Pose = {
      head,
      left: immersive ? this.handPose(hands.left) : null,
      right: immersive ? this.handPose(hands.right) : null,
      pinchL: immersive && hands.left.pinching,
      pinchR: immersive && hands.right.pinching,
      spin: round(bench.turntable.rotation.y - this.offset()),
      immersive,
    };
    codesign.sendPose(pose);
  }

  update(delta: number): void {
    const { codesign, bench } = ctx;
    if (!codesign.connected) {
      if (this.avatar.visible) this.avatar.visible = false;
      this.lastRemoteSpin = null;
      this.lastPoseAt = 0;
      this.hasShown = [false, false];
      return;
    }
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    this.sendClock += delta;
    if (this.sendClock >= SEND_DT) {
      this.sendClock = 0;
      this.send(immersive);
    }

    const pose = codesign.partner;
    const fresh = pose !== null && performance.now() - codesign.partnerAt < STALE_S * 1000;
    this.avatar.visible = fresh;
    if (!pose || !fresh) return;

    // Turntable: follow the partner when they turn it (the guest takes the host's angle on joining).
    if (codesign.partnerAt !== this.lastPoseAt) {
      this.lastPoseAt = codesign.partnerAt;
      const localSpin = bench.turntable.rotation.y - this.offset();
      const first = this.lastRemoteSpin === null;
      const theyTurned = !first && Math.abs(pose.spin - (this.lastRemoteSpin ?? 0)) > 1e-3;
      const weTurned = Math.abs(localSpin - this.lastLocalSpin) > 1e-3;
      if ((first && codesign.role.peek() === 'guest') || (theyTurned && !weTurned)) {
        bench.turntable.rotation.y = pose.spin + this.offset();
      }
      this.lastRemoteSpin = pose.spin;
      this.lastLocalSpin = bench.turntable.rotation.y - this.offset();
    }

    const a = 1 - Math.exp(-delta * 18);
    const h = pose.head;
    this.headPos.set(h[0], h[1], h[2]);
    this.targetQuat.set(h[3], h[4], h[5], h[6]).normalize();
    if (this.head.position.lengthSq() === 0) {
      this.head.position.copy(this.headPos);
      this.head.quaternion.copy(this.targetQuat);
    } else {
      this.head.position.lerp(this.headPos, a);
      this.head.quaternion.slerp(this.targetQuat, a);
    }
    // A partner on a phone or PC shows as a screen, not a headset.
    this.visor.scale.set(pose.immersive ? 1 : 1.1, pose.immersive ? 1 : 1.9, pose.immersive ? 1 : 0.2);
    this.skull.visible = pose.immersive;
    this.tag.set(pose.immersive ? 'Partner' : 'Partner (screen)', { bg: CSS.panel, border: CSS.violet });
    this.tag.mesh.position.set(this.head.position.x, this.head.position.y + 0.13, this.head.position.z);
    (this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.world.camera : this.player.head).getWorldPosition(this.viewer);
    faceViewer(this.tag.mesh, this.viewer);

    let b = 0;
    [pose.left, pose.right].forEach((hand, side) => {
      const pinch = side === 0 ? pose.pinchL : pose.pinchR;
      for (let k = 0; k < HAND_POINTS; k++) {
        const tip = this.tips[side * HAND_POINTS + k];
        tip.visible = hand !== null;
        if (!hand) continue;
        const o = (side * HAND_POINTS + k) * 3;
        for (let c = 0; c < 3; c++) {
          this.shown[o + c] = this.hasShown[side] ? this.shown[o + c] + (hand[k * 3 + c] - this.shown[o + c]) * a : hand[k * 3 + c];
        }
        tip.position.set(this.shown[o], this.shown[o + 1], this.shown[o + 2]);
        if (k === 1 || k === 2) tip.material.color.setHex(pinch ? COLORS.amber : COLORS.violet);
      }
      this.hasShown[side] = hand !== null;
      if (!hand) return;
      const w = side * HAND_POINTS * 3;
      for (const k of [1, 2, 3, 4]) {
        const o = w + k * 3;
        for (let c = 0; c < 3; c++) {
          this.boneBuf[b + c] = this.shown[w + c];
          this.boneBuf[b + 3 + c] = this.shown[o + c];
        }
        b += 6;
      }
    });
    this.bones.geometry.setDrawRange(0, b / 3);
    (this.bones.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    if (this.sendClock === 0) {
      probe.partner = {
        head: [this.head.position.x, this.head.position.y, this.head.position.z].map((v) => Math.round(v * 1000)),
        hands: (pose.left ? 1 : 0) + (pose.right ? 1 : 0),
        immersive: pose.immersive,
        spin: Math.round(bench.turntable.rotation.y * 1000) / 1000,
      };
    }
  }
}
