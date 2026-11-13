/**
 * The bench: a small turntable that carries the part. It is the one object the
 * user places in their room; everything else is laid out around it.
 *
 * Hierarchy (metres):
 *   root            placed and anchored in the room
 *     base          the dark disc, rim and scale rings (static)
 *     turntable     spins about Y; holds the part, handles and overlays
 */

import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  TorusGeometry,
} from '@iwsdk/core';
import { COLORS } from './palette.js';
import { PartView } from './part-view.js';

/** Radius of the turntable disc, m. */
export const BENCH_RADIUS = 0.13;

export class Bench {
  readonly root = new Group();
  readonly base = new Group();
  readonly turntable = new Group();
  readonly part = new PartView();
  /** Glowing rim; its colour shows the truth-gate verdict. */
  readonly rim: Mesh<TorusGeometry, MeshBasicMaterial>;

  constructor() {
    this.root.name = 'Bench';
    this.base.name = 'Bench base';
    this.turntable.name = 'Turntable';

    const disc = new Mesh(
      new CylinderGeometry(BENCH_RADIUS, BENCH_RADIUS * 0.985, 0.008, 72),
      new MeshStandardMaterial({
        color: COLORS.glass,
        roughness: 0.35,
        metalness: 0.3,
        transparent: true,
        opacity: 0.9,
      }),
    );
    disc.name = 'Bench disc';
    disc.position.y = -0.004;

    this.rim = new Mesh(
      new TorusGeometry(BENCH_RADIUS, 0.0016, 8, 96),
      new MeshBasicMaterial({ color: COLORS.cyan, toneMapped: false }),
    );
    this.rim.name = 'Bench rim';
    this.rim.rotation.x = Math.PI / 2;
    this.rim.position.y = 0.0004;

    // Scale rings every 20 mm of real size (true at 1:1 zoom) and degree ticks.
    const rings = new Group();
    rings.name = 'Scale rings';
    const ringMaterial = new MeshBasicMaterial({
      color: COLORS.cyan,
      transparent: true,
      opacity: 0.16,
      toneMapped: false,
      depthWrite: false,
    });
    for (let r = 0.02; r < BENCH_RADIUS - 0.005; r += 0.02) {
      const ring = new Mesh(new RingGeometry(r - 0.0003, r + 0.0003, 96), ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.0006;
      rings.add(ring);
    }
    const ticks: number[] = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      const inner = BENCH_RADIUS - (a % 90 === 0 ? 0.012 : a % 30 === 0 ? 0.008 : 0.005);
      ticks.push(
        Math.cos(rad) * inner, 0.0008, Math.sin(rad) * inner,
        Math.cos(rad) * (BENCH_RADIUS - 0.002), 0.0008, Math.sin(rad) * (BENCH_RADIUS - 0.002),
      );
    }
    const tickGeometry = new BufferGeometry();
    tickGeometry.setAttribute('position', new Float32BufferAttribute(ticks, 3));
    const tickLines = new LineSegments(
      tickGeometry,
      new LineBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.55 }),
    );
    tickLines.name = 'Degree ticks';

    this.base.add(disc, this.rim, rings);
    this.turntable.add(tickLines, this.part.pivot);
    this.root.add(this.base, this.turntable);
  }
}
