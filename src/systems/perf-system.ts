/**
 * Frame-rate governor for the headset.
 *
 * At the start of an immersive session it turns on fixed foveated rendering
 * (fewer pixels at the edge of each lens, where the eye cannot see detail) and
 * asks for 90 Hz where the headset offers it. It then watches frame times. If
 * frames run over budget for a moment it steps down, one level at a time:
 *
 *   1  stronger foveation
 *   2  72 Hz, which gives each frame 25 % more time
 *   3  optional effects are thinned (air-flow beads)
 *
 * and steps back up after a long stretch of easy frames. The rules ask for at
 * least 60 fps; the governor aims to never let a heavy moment drop below it.
 */

import { createSystem, VisibilityState } from '@iwsdk/core';
import { probe, quality } from '../app/context.js';

const MAX_LEVEL = 3;
/** Seconds of slow frames before stepping down, and of easy frames before stepping up. */
const DOWN_AFTER = 1.5;
const UP_AFTER = 10;

interface XRManagerLike {
  getSession(): XRSession | null;
  setFoveation(v: number): void;
}

export class PerfSystem extends createSystem({}) {
  private session: XRSession | null = null;
  private target = 72;
  private avg = 1 / 72;
  private slow = 0;
  private easy = 0;
  private frames = 0;
  private window = 0;
  private fps = 0;

  update(delta: number): void {
    const xr = this.world.renderer.xr as unknown as XRManagerLike;
    if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      if (this.session) {
        this.session = null;
        quality.level = 0;
      }
      return;
    }
    const session = xr.getSession();
    if (!session) return;
    if (session !== this.session) this.start(session, xr);
    if (delta <= 0 || delta > 0.5) return; // paused, or the first frame after a pause
    this.avg += (delta - this.avg) * 0.08;
    this.frames++;
    this.window += delta;
    if (this.window >= 1) {
      this.fps = this.frames / this.window;
      this.frames = 0;
      this.window = 0;
      probe.perf = { fps: Math.round(this.fps), target: this.target, level: quality.level, ms: Math.round(this.avg * 10000) / 10 };
    }
    const budget = 1 / this.target;
    if (this.avg > budget * 1.12) {
      this.slow += delta;
      this.easy = 0;
    } else if (this.avg < budget * 0.75) {
      this.easy += delta;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.easy = 0;
    }
    if (this.slow > DOWN_AFTER && quality.level < MAX_LEVEL) {
      this.setLevel(quality.level + 1, session, xr);
    } else if (this.easy > UP_AFTER && quality.level > 0) {
      this.setLevel(quality.level - 1, session, xr);
    }
  }

  private start(session: XRSession, xr: XRManagerLike): void {
    this.session = session;
    quality.level = 0;
    this.slow = 0;
    this.easy = 0;
    this.apply(session, xr);
  }

  private setLevel(level: number, session: XRSession, xr: XRManagerLike): void {
    quality.level = level;
    this.slow = 0;
    this.easy = 0;
    this.apply(session, xr);
  }

  private apply(session: XRSession, xr: XRManagerLike): void {
    const level = quality.level;
    try {
      xr.setFoveation(level >= 1 ? 1 : 0.5);
    } catch {
      // Not every runtime has a foveation control.
    }
    const rates = (session as XRSession & { supportedFrameRates?: Float32Array }).supportedFrameRates;
    const want = level >= 2 ? 72 : 90;
    if (rates && Array.from(rates).includes(want) && session.updateTargetFrameRate) {
      session.updateTargetFrameRate(want).then(
        () => {
          this.target = want;
        },
        () => {},
      );
    } else if (rates?.length) {
      this.target = (session as XRSession & { frameRate?: number }).frameRate ?? 72;
    }
    this.avg = 1 / this.target;
  }
}
