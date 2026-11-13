/**
 * Keeps the part on the bench in step with the application state: swaps the
 * mesh when the engine finishes a build, shows the grown shape while the
 * topology optimiser runs, paints the stress map, and colours the bench rim
 * with the truth-gate verdict.
 */

import { createSystem } from '@iwsdk/core';
import { ctx } from '../app/context.js';
import { COLORS } from '../app/palette.js';

export class PartSystem extends createSystem({}) {
  private lastVerdict = '';
  /** Deformation exaggeration currently shown (1 = true scale). */
  exaggeration = 1;

  init(): void {
    const { app, bench, sfx } = ctx;
    const part = bench.part;

    const showStress = (): void => {
      const s = app.stress.peek();
      if (!s || !part.hasStress) {
        return;
      }
      const settings = app.settings.peek();
      this.exaggeration = part.showLoad(
        app.loadN.peek() / s.newtons,
        app.materialData.yield,
        s.stressP99,
        settings.colorSafe,
        !settings.reduceMotion,
      );
    };

    const showGeometry = (): void => {
      const built = app.built.peek();
      const grown = app.grown.peek();
      if (grown) {
        part.setMesh(grown.mesh, grown.props.bbox);
        part.setLook('grown');
      } else if (built) {
        part.setMesh(built.mesh, built.props.bbox);
        part.setLook(
          app.rollback.peek() !== null
            ? 'rolled-back'
            : built.gate.verdict === 'refused'
              ? 'refused'
              : 'normal',
        );
      } else {
        return;
      }
      if (!app.dragging.peek()) {
        part.seat();
      }
      const s = app.stress.peek();
      if (s && part.setStress(s.vertexStress, s.vertexDisp, s.maxDisp)) {
        showStress();
      }
    };

    this.cleanupFuncs.push(
      app.built.subscribe((built) => {
        showGeometry();
        if (!built) {
          return;
        }
        const verdict = app.rollback.peek() !== null ? 'rolled' : built.gate.verdict;
        bench.rim.material.color.setHex(
          verdict === 'verified'
            ? COLORS.green
            : verdict === 'refused'
              ? COLORS.red
              : verdict === 'rolled'
                ? COLORS.violet
                : COLORS.amber,
        );
        // Announce a change of verdict once the hand has let go, not on every drag step.
        if (verdict !== this.lastVerdict && !app.dragging.peek()) {
          if (verdict === 'verified' && this.lastVerdict !== '') {
            sfx.play('verified');
          } else if (verdict === 'refused') {
            sfx.play('refused');
          }
          this.lastVerdict = verdict;
        }
      }),
      app.grown.subscribe(() => showGeometry()),
      app.stress.subscribe((s) => {
        if (!s) {
          part.clearStress();
          this.exaggeration = 1;
          return;
        }
        if (part.setStress(s.vertexStress, s.vertexDisp, s.maxDisp)) {
          showStress();
        }
      }),
      app.loadN.subscribe(() => showStress()),
      app.settings.subscribe(() => showStress()),
      app.refusal.subscribe((message) => {
        if (message) {
          bench.rim.material.color.setHex(COLORS.red);
        }
      }),
      app.dragging.subscribe((dragging) => {
        if (!dragging) {
          part.seat();
        }
      }),
    );
  }

  update(delta: number): void {
    ctx.bench.part.update(delta);
  }
}
