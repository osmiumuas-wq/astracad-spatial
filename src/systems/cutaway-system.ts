/**
 * Cutaway: while a lattice core is shown, the near half of the part is cut
 * away by a plane through its middle that faces the viewer, so the gyroid
 * inside is visible from wherever you look. The knife gesture still works; it
 * takes over the cut while the hand is in the part.
 */

import { createSystem, Plane, Vector3, VisibilityState } from '@iwsdk/core';
import { ctx } from '../app/context.js';

export class CutawaySystem extends createSystem({}) {
  private readonly plane = new Plane();
  private readonly centre = new Vector3();
  private readonly viewer = new Vector3();
  private readonly n = new Vector3();
  private on = false;

  update(): void {
    const { app, bench } = ctx;
    const want = app.cutaway.peek() && app.grown.peek()?.final === true;
    if (!want) {
      if (this.on) {
        bench.part.setClip(null);
        this.on = false;
      }
      return;
    }
    if (app.slicing) return;
    bench.part.mesh.geometry.computeBoundingSphere();
    const s = bench.part.mesh.geometry.boundingSphere;
    if (!s) return;
    this.centre.copy(s.center);
    bench.part.mesh.localToWorld(this.centre);
    (this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.world.camera : this.player.head).getWorldPosition(this.viewer);
    // Keep what is behind the plane as seen from the viewer: the normal points away from the eye, level.
    this.n.copy(this.centre).sub(this.viewer).setY(0).normalize();
    this.plane.setFromNormalAndCoplanarPoint(this.n, this.centre);
    bench.part.setClip(this.plane);
    this.on = true;
  }
}
