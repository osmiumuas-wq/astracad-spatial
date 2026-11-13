/**
 * Hand state from raw WebXR joint poses: pinch point and gap (with the joint
 * radii the runtime reports, so the gap is skin to skin, not bone to bone),
 * palm centre and normal, flat-hand detection and a jitter filter.
 *
 * The bench's own gestures (drag a handle, twist the dial, span a real object,
 * push the part, slice it) are built on this. Buttons and panels use IWSDK's
 * pointers instead, so they also work with rays, gaze and controllers.
 */

import { Matrix4, Vector3 } from '@iwsdk/core';

export type Side = 'left' | 'right';

/** WebXR hand joint order (https://www.w3.org/TR/webxr-hand-input-1/). */
const J = {
  wrist: 0,
  thumbTip: 4,
  indexProx: 6,
  indexInter: 7,
  indexTip: 9,
  middleMeta: 10,
  middleProx: 11,
  middleInter: 12,
  middleTip: 14,
  ringProx: 16,
  ringInter: 17,
  ringTip: 19,
  pinkyProx: 21,
  pinkyInter: 22,
  pinkyTip: 24,
} as const;

const JOINTS = 25;

/** Hand-input additions to XRFrame that the bundled WebXR types do not declare. */
type HandFrame = XRFrame & {
  fillPoses?(spaces: XRSpace[], baseSpace: XRSpace, transforms: Float32Array): boolean;
  fillJointRadii?(joints: XRJointSpace[], radii: Float32Array): boolean;
};
const DEFAULT_TIP_RADIUS = 0.008;
const PINCH_ON = 0.008;
const PINCH_OFF = 0.022;
/** A hand that drops out for less than this keeps its last state, s. */
const GRACE = 0.18;

/** One-euro filter for a 3D point: steady when still, quick when moving. */
export class OneEuro3 {
  private has = false;
  private readonly prev = new Vector3();
  private readonly dPrev = new Vector3();

  constructor(
    private readonly minCutoff = 1.5,
    private readonly beta = 20,
    private readonly dCutoff = 1,
  ) {}

  reset(): void {
    this.has = false;
  }

  /** Filter `v` in place. */
  apply(v: Vector3, dt: number): Vector3 {
    if (!this.has || dt <= 0) {
      this.prev.copy(v);
      this.dPrev.set(0, 0, 0);
      this.has = true;
      return v;
    }
    const alpha = (cutoff: number): number => {
      const tau = 1 / (2 * Math.PI * cutoff);
      return 1 / (1 + tau / dt);
    };
    const ad = alpha(this.dCutoff);
    const dx = (v.x - this.prev.x) / dt;
    const dy = (v.y - this.prev.y) / dt;
    const dz = (v.z - this.prev.z) / dt;
    this.dPrev.set(
      this.dPrev.x + ad * (dx - this.dPrev.x),
      this.dPrev.y + ad * (dy - this.dPrev.y),
      this.dPrev.z + ad * (dz - this.dPrev.z),
    );
    const a = alpha(this.minCutoff + this.beta * this.dPrev.length());
    v.set(
      this.prev.x + a * (v.x - this.prev.x),
      this.prev.y + a * (v.y - this.prev.y),
      this.prev.z + a * (v.z - this.prev.z),
    );
    this.prev.copy(v);
    return v;
  }
}

export class HandState {
  tracked = false;
  readonly wrist = new Vector3();
  readonly thumbTip = new Vector3();
  readonly indexTip = new Vector3();
  readonly middleTip = new Vector3();
  /** Palm centre, world space. */
  readonly palm = new Vector3();
  /** Unit vector out of the palm. */
  readonly palmNormal = new Vector3(0, -1, 0);
  /** Unit vector from the wrist towards the fingers. */
  readonly forward = new Vector3(0, 0, -1);
  /** Unit vector from the little-finger knuckle to the index knuckle. */
  readonly across = new Vector3(1, 0, 0);
  /** Filtered midpoint between the thumb and index pads. */
  readonly pinchPoint = new Vector3();
  readonly palmVelocity = new Vector3();
  /** Free space between the thumb and index pads, m. */
  gap = 0.1;
  pinching = false;
  pinchStarted = false;
  pinchEnded = false;
  /** All four fingers straight. */
  open = false;
  /** Seconds the hand has been continuously open. */
  openTime = 0;

  private readonly joints = new Float32Array(JOINTS * 16);
  private readonly radii = new Float32Array(JOINTS);
  private spaces: XRJointSpace[] = [];
  private source: XRInputSource | null = null;
  private lost = 0;
  private readonly filter = new OneEuro3();
  private readonly lastPalm = new Vector3();
  private hasLast = false;
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();

  constructor(readonly side: Side) {}

  private joint(index: number, toWorld: Matrix4, out: Vector3): Vector3 {
    const o = index * 16;
    return out.set(this.joints[o + 12], this.joints[o + 13], this.joints[o + 14]).applyMatrix4(toWorld);
  }

  private straight(prox: number, inter: number, tip: number, toWorld: Matrix4): boolean {
    this.joint(prox, toWorld, this.a);
    this.joint(inter, toWorld, this.b);
    this.joint(tip, toWorld, this.c);
    this.c.sub(this.b).normalize();
    this.b.sub(this.a).normalize();
    return this.b.dot(this.c) > 0.72;
  }

  /** Update from one XR frame. `select` is the runtime's own pinch state, when it has one. */
  update(
    frame: XRFrame,
    refSpace: XRReferenceSpace,
    source: XRInputSource | null,
    toWorld: Matrix4,
    dt: number,
    select: boolean | undefined,
  ): void {
    this.pinchStarted = false;
    this.pinchEnded = false;
    let ok = false;
    const hf = frame as HandFrame;
    if (source?.hand && typeof hf.fillPoses === 'function') {
      if (source !== this.source) {
        this.source = source;
        this.spaces = Array.from(source.hand.values());
      }
      try {
        ok = this.spaces.length === JOINTS && hf.fillPoses(this.spaces, refSpace, this.joints);
        if (ok && typeof hf.fillJointRadii === 'function') {
          hf.fillJointRadii(this.spaces, this.radii);
        }
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      this.lost += dt;
      if (this.lost > GRACE && this.tracked) {
        this.tracked = false;
        this.open = false;
        this.openTime = 0;
        this.hasLast = false;
        this.filter.reset();
        if (this.pinching) {
          this.pinching = false;
          this.pinchEnded = true;
        }
      }
      return;
    }
    this.lost = 0;
    this.tracked = true;

    this.joint(J.wrist, toWorld, this.wrist);
    this.joint(J.thumbTip, toWorld, this.thumbTip);
    this.joint(J.indexTip, toWorld, this.indexTip);
    this.joint(J.middleTip, toWorld, this.middleTip);

    const indexProx = this.joint(J.indexProx, toWorld, this.a);
    const pinkyProx = this.joint(J.pinkyProx, toWorld, this.b);
    this.across.copy(indexProx).sub(pinkyProx).normalize();
    // (index - wrist) x (pinky - wrist) points out of a right palm; mirrored for the left.
    indexProx.sub(this.wrist);
    pinkyProx.sub(this.wrist);
    this.palmNormal.crossVectors(indexProx, pinkyProx).normalize();
    if (this.side === 'left') {
      this.palmNormal.negate();
    }
    const middleProx = this.joint(J.middleProx, toWorld, this.c);
    this.palm.copy(this.wrist).lerp(middleProx, 0.55);
    this.forward.copy(middleProx).sub(this.wrist).normalize();

    if (this.hasLast && dt > 0) {
      this.a.copy(this.palm).sub(this.lastPalm).divideScalar(dt);
      this.palmVelocity.lerp(this.a, Math.min(1, dt * 12));
    } else {
      this.palmVelocity.set(0, 0, 0);
    }
    this.lastPalm.copy(this.palm);
    this.hasLast = true;

    const rThumb = this.radii[J.thumbTip] > 0 ? this.radii[J.thumbTip] : DEFAULT_TIP_RADIUS;
    const rIndex = this.radii[J.indexTip] > 0 ? this.radii[J.indexTip] : DEFAULT_TIP_RADIUS;
    this.gap = Math.max(0, this.thumbTip.distanceTo(this.indexTip) - rThumb - rIndex);

    this.pinchPoint.copy(this.thumbTip).add(this.indexTip).multiplyScalar(0.5);
    this.filter.apply(this.pinchPoint, dt);

    const was = this.pinching;
    if (select !== undefined) {
      this.pinching = select;
    } else if (was) {
      this.pinching = this.gap < PINCH_OFF;
    } else {
      this.pinching = this.gap < PINCH_ON;
    }
    this.pinchStarted = this.pinching && !was;
    this.pinchEnded = !this.pinching && was;

    this.open =
      !this.pinching &&
      this.straight(J.indexProx, J.indexInter, J.indexTip, toWorld) &&
      this.straight(J.middleProx, J.middleInter, J.middleTip, toWorld) &&
      this.straight(J.ringProx, J.ringInter, J.ringTip, toWorld) &&
      this.straight(J.pinkyProx, J.pinkyInter, J.pinkyTip, toWorld);
    this.openTime = this.open ? this.openTime + dt : 0;
  }

  /** Mark the hand as gone (session ended). */
  clear(): void {
    this.tracked = false;
    this.pinching = false;
    this.pinchStarted = false;
    this.pinchEnded = false;
    this.open = false;
    this.openTime = 0;
    this.source = null;
    this.spaces = [];
    this.hasLast = false;
    this.filter.reset();
  }
}

export class Hands {
  readonly left = new HandState('left');
  readonly right = new HandState('right');

  get(side: Side): HandState {
    return side === 'left' ? this.left : this.right;
  }

  other(side: Side): HandState {
    return side === 'left' ? this.right : this.left;
  }

  get anyTracked(): boolean {
    return this.left.tracked || this.right.tracked;
  }

  update(
    frame: XRFrame,
    session: XRSession,
    refSpace: XRReferenceSpace,
    toWorld: Matrix4,
    dt: number,
    select: (side: Side) => boolean | undefined,
  ): void {
    let left: XRInputSource | null = null;
    let right: XRInputSource | null = null;
    for (const source of session.inputSources) {
      if (!source.hand) {
        continue;
      }
      if (source.handedness === 'left') {
        left = source;
      } else if (source.handedness === 'right') {
        right = source;
      }
    }
    this.left.update(frame, refSpace, left, toWorld, dt, left ? select('left') : undefined);
    this.right.update(frame, refSpace, right, toWorld, dt, right ? select('right') : undefined);
  }

  clear(): void {
    this.left.clear();
    this.right.clear();
  }
}
