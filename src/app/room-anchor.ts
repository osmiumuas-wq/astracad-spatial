/**
 * Keeps the bench fixed to the real room with a WebXR anchor.
 *
 * Without an anchor the bench sits at a fixed spot in the session's reference
 * space, so when the headset corrects its tracking (or the user recentres) the
 * bench slides across the table. A session anchor is updated by the headset as
 * its map of the room improves, and the bench follows it.
 *
 * IWSDK's XRAnchor component is not used: it restores a pose from an earlier
 * session, which put the bench out of view. This anchor lives for one session
 * and is replaced whenever the bench is placed again.
 */

import { Matrix4, Object3D, Quaternion, Vector3 } from '@iwsdk/core';

export type AnchorState = 'none' | 'requesting' | 'tracking' | 'lost' | 'unsupported';

interface Renderer {
  xr: { getFrame(): XRFrame | null; getReferenceSpace(): XRReferenceSpace | null };
}

export class RoomAnchor {
  state: AnchorState = 'none';
  /** How far the anchor has moved the bench since it was made, in millimetres (tracking corrections). */
  correctionMm = 0;
  private anchor: XRAnchor | null = null;
  private pending = false;
  private wantAt = -1;
  private generation = 0;
  private readonly m = new Matrix4();
  private readonly inv = new Matrix4();
  private readonly p = new Vector3();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly start = new Vector3();

  /** Ask for an anchor at the bench's current pose (made on a later frame, once the bench is still). */
  request(now: number): void {
    this.wantAt = now;
  }

  /** Drop the anchor: the bench is about to be moved by the app. */
  release(): void {
    this.generation++;
    this.anchor?.delete();
    this.anchor = null;
    this.pending = false;
    this.wantAt = -1;
    if (this.state !== 'unsupported') this.state = 'none';
  }

  update(now: number, root: Object3D, player: Object3D, renderer: Renderer): void {
    const frame = renderer.xr.getFrame();
    const space = renderer.xr.getReferenceSpace();
    if (!frame || !space) return;
    if (this.wantAt >= 0 && now - this.wantAt > 0.4 && !this.pending) {
      this.wantAt = -1;
      this.create(frame, space, root, player);
      return;
    }
    if (!this.anchor || this.pending) return;
    if (!frame.trackedAnchors?.has(this.anchor)) {
      this.state = 'lost';
      return;
    }
    const pose = frame.getPose(this.anchor.anchorSpace, space);
    if (!pose) {
      this.state = 'lost';
      return;
    }
    this.state = 'tracking';
    // Anchor pose (reference space) to the bench's parent frame.
    this.m.fromArray(pose.transform.matrix).premultiply(player.matrixWorld);
    if (root.parent) {
      // Only the parent's own world matrix is needed: update it and its ancestors, not every object under it
      // (updateMatrixWorld() walked the whole subtree every frame, about 2 ms of a desktop frame in the emulator).
      root.parent.updateWorldMatrix(true, false);
      this.inv.copy(root.parent.matrixWorld).invert();
      this.m.premultiply(this.inv);
    }
    this.m.decompose(this.p, this.q, this.s);
    // Leave the bench alone for sub-millimetre noise.
    if (this.p.distanceToSquared(root.position) < 2.5e-7 && this.q.angleTo(root.quaternion) < 1e-3) return;
    root.position.copy(this.p);
    root.quaternion.copy(this.q);
    root.updateMatrixWorld(true);
    this.correctionMm = this.p.distanceTo(this.start) * 1000;
  }

  private create(frame: XRFrame, space: XRReferenceSpace, root: Object3D, player: Object3D): void {
    const Rigid = (globalThis as { XRRigidTransform?: typeof XRRigidTransform }).XRRigidTransform;
    if (!frame.createAnchor || !Rigid) {
      this.state = 'unsupported';
      return;
    }
    player.updateMatrixWorld();
    root.updateMatrixWorld();
    // Bench pose in the reference space: undo the player rig's transform.
    this.m.copy(player.matrixWorld).invert().multiply(root.matrixWorld);
    this.m.decompose(this.p, this.q, this.s);
    this.start.copy(root.position);
    this.correctionMm = 0;
    const gen = ++this.generation;
    this.pending = true;
    this.state = 'requesting';
    const old = this.anchor;
    const made = frame.createAnchor(
      new Rigid({ x: this.p.x, y: this.p.y, z: this.p.z }, { x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }),
      space,
    );
    if (!made) {
      this.pending = false;
      this.state = 'unsupported';
      return;
    }
    made.then(
      (a) => {
        old?.delete();
        if (gen !== this.generation) {
          // Released or replaced while it was being made.
          a.delete();
          return;
        }
        this.anchor = a;
        this.pending = false;
        this.state = 'tracking';
      },
      () => {
        if (gen !== this.generation) return;
        this.pending = false;
        this.state = 'unsupported';
      },
    );
  }
}
