/**
 * The part as it appears on the bench: shaded solid, drafted edges, the stress
 * colour map with its exaggerated deformation, and the seat transform that
 * keeps the part standing on the turntable.
 *
 * Geometry comes from the engine in millimetres. `pivot` scales it to metres
 * (times the view zoom) and seats it; everything under `pivot` is in mm.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Plane,
  Vector3,
} from '@iwsdk/core';
import { Box3 as PartBox, MeshData } from '../engine/types.js';
import { COLORS, stressColor } from './palette.js';

export type PartLook = 'normal' | 'rolled-back' | 'refused' | 'grown';

export class PartView {
  /** Scaled and seated; children are in millimetres. */
  readonly pivot = new Group();
  readonly mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  readonly edges: LineSegments<BufferGeometry, LineBasicMaterial>;
  /** Part bounding box, mm. */
  box: PartBox = { min: [0, 0, 0], max: [1, 1, 1] };
  /** Largest dimension, mm. */
  size = 1;
  zoom = 1;

  private base: Float32Array = new Float32Array(0);
  private stress: Float32Array | null = null;
  private disp: Float32Array | null = null;
  private maxDisp = 0;
  private colors: Float32Array = new Float32Array(0);
  private seatTarget = new Vector3();
  private seatReady = false;
  private readonly tint = new Color(COLORS.part);

  constructor() {
    const material = new MeshStandardMaterial({
      color: COLORS.part,
      roughness: 0.55,
      metalness: 0.05,
      flatShading: false,
    });
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.name = 'Part';
    this.mesh.frustumCulled = false;
    this.edges = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.85 }),
    );
    this.edges.name = 'Part edges';
    this.edges.frustumCulled = false;
    this.pivot.name = 'Part pivot';
    this.pivot.add(this.mesh, this.edges);
    this.applyScale();
  }

  /** Metres per millimetre at the current zoom. */
  get scale(): number {
    return 0.001 * this.zoom;
  }

  private applyScale(): void {
    this.pivot.scale.setScalar(this.scale);
  }

  setZoom(zoom: number): void {
    this.zoom = Math.min(4, Math.max(0.4, zoom));
    this.applyScale();
    this.seat(true);
  }

  /** Replace the geometry. Buffers are reused when the vertex counts match. */
  setMesh(data: MeshData, box: PartBox): void {
    const g = this.mesh.geometry;
    const pos = g.getAttribute('position') as BufferAttribute | undefined;
    const idx = g.getIndex();
    const same =
      pos !== undefined &&
      idx !== null &&
      pos.array.length === data.positions.length &&
      idx.array.length === data.indices.length;
    if (same) {
      (pos.array as Float32Array).set(data.positions);
      pos.needsUpdate = true;
      const nrm = g.getAttribute('normal') as BufferAttribute;
      (nrm.array as Float32Array).set(data.normals);
      nrm.needsUpdate = true;
      (idx.array as Uint32Array).set(data.indices);
      idx.needsUpdate = true;
    } else {
      const next = new BufferGeometry();
      next.setAttribute('position', new BufferAttribute(data.positions.slice(), 3));
      next.setAttribute('normal', new BufferAttribute(data.normals.slice(), 3));
      next.setIndex(new BufferAttribute(data.indices.slice(), 1));
      this.mesh.geometry = next;
      g.dispose();
      this.colors = new Float32Array(0);
    }
    this.base = data.positions.slice();
    const eg = new BufferGeometry();
    eg.setAttribute('position', new BufferAttribute(data.edges.slice(), 3));
    this.edges.geometry.dispose();
    this.edges.geometry = eg;
    this.edges.visible = true;
    this.box = box;
    this.size = Math.max(
      box.max[0] - box.min[0],
      box.max[1] - box.min[1],
      box.max[2] - box.min[2],
    );
    this.clearStress();
  }

  /**
   * Stand the part on the turntable, centred. Called when a change is
   * committed; while a handle is held the seat is frozen so the handle stays
   * under the fingers.
   */
  seat(immediate = false): void {
    const s = this.scale;
    this.seatTarget.set(
      -((this.box.min[0] + this.box.max[0]) / 2) * s,
      -this.box.min[1] * s,
      -((this.box.min[2] + this.box.max[2]) / 2) * s,
    );
    if (immediate || !this.seatReady) {
      this.pivot.position.copy(this.seatTarget);
      this.seatReady = true;
    }
  }

  /** Ease towards the seat; call every frame. */
  update(delta: number): void {
    if (this.seatReady) {
      this.pivot.position.lerp(this.seatTarget, 1 - Math.exp(-delta * 9));
    }
  }

  setLook(look: PartLook): void {
    const m = this.mesh.material;
    m.transparent = look === 'rolled-back';
    m.opacity = look === 'rolled-back' ? 0.78 : 1;
    this.tint.setHex(
      look === 'rolled-back' ? COLORS.partRolled : look === 'refused' ? 0xf0b9b9 : COLORS.part,
    );
    if (!m.vertexColors) {
      m.color.copy(this.tint);
    }
    this.edges.material.color.setHex(look === 'refused' ? COLORS.red : COLORS.edge);
    m.needsUpdate = true;
  }

  /** Attach a solve result to the current mesh. Arrays must match its vertex order. */
  setStress(stress: Float32Array, disp: Float32Array, maxDisp: number): boolean {
    if (stress.length * 3 !== this.base.length) {
      return false;
    }
    this.stress = stress;
    this.disp = disp;
    this.maxDisp = maxDisp;
    if (this.colors.length !== this.base.length) {
      this.colors = new Float32Array(this.base.length);
      this.mesh.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    }
    const m = this.mesh.material;
    m.vertexColors = true;
    m.color.setHex(0xffffff);
    m.needsUpdate = true;
    this.edges.visible = false;
    return true;
  }

  get hasStress(): boolean {
    return this.stress !== null;
  }

  clearStress(): void {
    if (!this.stress && !this.mesh.material.vertexColors) {
      return;
    }
    this.stress = null;
    this.disp = null;
    const m = this.mesh.material;
    m.vertexColors = false;
    m.color.copy(this.tint);
    m.needsUpdate = true;
    this.edges.visible = true;
    const pos = this.mesh.geometry.getAttribute('position') as BufferAttribute | undefined;
    if (pos && pos.array.length === this.base.length) {
      (pos.array as Float32Array).set(this.base);
      pos.needsUpdate = true;
    }
  }

  /**
   * Recolour and deform for a load factor (current load over the solved load).
   * Returns the deformation exaggeration that was applied.
   */
  showLoad(loadFactor: number, yieldMPa: number, peakStress: number, safe: boolean, deform: boolean): number {
    if (!this.stress || !this.disp) {
      return 1;
    }
    // Exaggerate so the part visibly bends: 6 % of its size at the yield load.
    const atYield = peakStress > 0 ? yieldMPa / peakStress : 1;
    const exaggeration =
      deform && this.maxDisp > 0
        ? Math.min(4000, Math.max(1, (0.06 * this.size) / (this.maxDisp * atYield)))
        : 0;
    const pos = this.mesh.geometry.getAttribute('position') as BufferAttribute;
    const p = pos.array as Float32Array;
    const k = loadFactor * exaggeration;
    const n = this.stress.length;
    for (let v = 0; v < n; v++) {
      stressColor((this.stress[v] * loadFactor) / yieldMPa, safe, this.colors, v * 3);
      p[v * 3] = this.base[v * 3] + this.disp[v * 3] * k;
      p[v * 3 + 1] = this.base[v * 3 + 1] + this.disp[v * 3 + 1] * k;
      p[v * 3 + 2] = this.base[v * 3 + 2] + this.disp[v * 3 + 2] * k;
    }
    pos.needsUpdate = true;
    (this.mesh.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    return exaggeration;
  }

  /** Cut the view with a world-space plane (null removes the cut). */
  setClip(plane: Plane | null): void {
    const m = this.mesh.material;
    const had = m.clippingPlanes !== null && m.clippingPlanes.length > 0;
    m.clippingPlanes = plane ? [plane] : [];
    m.side = plane ? DoubleSide : FrontSide;
    this.edges.material.clippingPlanes = plane ? [plane] : [];
    if (had !== (plane !== null)) {
      m.needsUpdate = true;
      this.edges.material.needsUpdate = true;
    }
  }

  /** Part coordinates (mm) of a point given in the pivot's parent space (metres). */
  toPart(local: Vector3, out: Vector3): Vector3 {
    return out.copy(local).sub(this.pivot.position).divideScalar(this.scale);
  }
}
