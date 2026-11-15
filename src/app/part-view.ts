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
  Quaternion,
  Vector3,
} from '@iwsdk/core';
import { Box3 as PartBox, MeshData } from '../engine/types.js';
import { COLORS, stressColor } from './palette.js';
import { Appearance, boxUv, textureFor } from './appearance.js';

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
  /** Where the seat has eased to (the pivot adds any tilt on top). */
  private readonly seatPos = new Vector3();
  /** Tilt about a floor edge (the tip test): unit axis in the part frame, a point on it (mm), angle (rad). */
  private readonly tiltAxis = new Vector3(1, 0, 0);
  private readonly tiltPoint = new Vector3();
  private tiltAngle = 0;
  private readonly tiltQ = new Quaternion();
  private readonly tiltV = new Vector3();
  private readonly tint = new Color(COLORS.part);
  /** The part's appearance (null: the bench's own look). */
  private appearance: Appearance | null = null;

  /** 0 to 1: how strongly stressed areas glow (rises as the load nears yield). */
  private readonly heat = { value: 0 };
  /** Strength of the cyan rim light at grazing angles. */
  private readonly rim = { value: 0.55 };
  /** Clash check: show where the part is inside or behind real things in red, instead of hiding it. */
  private readonly clashOn = { value: false };
  private readonly clashTime = { value: 0 };
  private ownCompile: unknown = null;
  private occlusionCompile: unknown = null;
  private clashCompile: unknown = null;

  constructor() {
    const material = new MeshStandardMaterial({
      color: COLORS.part,
      roughness: 0.38,
      metalness: 0.12,
      flatShading: false,
    });
    // The bench look: a cool cyan rim where the surface turns away from the
    // eye, and stressed areas that glow hotter as the load approaches yield.
    // When IWSDK's depth occlusion wraps this hook, the key changes, so three.js
    // compiles the wrapped shader instead of reusing the plain one.
    const own = (shader: { uniforms: Record<string, unknown>; fragmentShader: string }): void => {
      shader.uniforms.uHeat = this.heat;
      shader.uniforms.uRim = this.rim;
      shader.fragmentShader = `uniform float uHeat;\nuniform float uRim;\n${shader.fragmentShader}`.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += uRim * pow(1.0 - facing, 3.0) * vec3(0.22, 0.72, 1.0);
        }
        #ifdef USE_COLOR
          totalEmissiveRadiance += vColor.rgb * uHeat;
        #endif
`,
      );
    };
    material.onBeforeCompile = own;
    this.ownCompile = own;
    material.customProgramCacheKey = () =>
      material.onBeforeCompile === own ? 'astra-part-v1' : material.onBeforeCompile === this.clashCompile ? 'astra-part-v1-clash' : 'astra-part-v1-occluded';
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.name = 'Part';
    this.mesh.frustumCulled = false;
    this.edges = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: 0x3fc4ff, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    this.edges.name = 'Part edges';
    this.edges.frustumCulled = false;
    this.pivot.name = 'Part pivot';
    this.pivot.add(this.mesh, this.edges);
    this.applyScale();
  }

  /** The undeformed vertex positions (mm) and triangle indices of the current part. */
  solid(): { positions: Float32Array; indices: ArrayLike<number> } {
    return { positions: this.base, indices: (this.mesh.geometry.getIndex()?.array ?? new Uint32Array(0)) as ArrayLike<number> };
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
    if (this.appearance?.texture) this.mesh.geometry.setAttribute('uv', new BufferAttribute(boxUv(data.positions, data.normals), 2));
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
      this.seatPos.copy(this.seatTarget);
      this.pivot.position.copy(this.seatTarget);
      this.seatReady = true;
    }
  }

  /**
   * Tilt the part about a line on its floor (part frame, mm), keeping that line
   * where it is: the part rocks on a footprint edge. Angle 0 stands it back up.
   */
  setTilt(point: Vector3, axis: Vector3, angle: number): void {
    this.tiltPoint.copy(point);
    this.tiltAxis.copy(axis).normalize();
    this.tiltAngle = angle;
  }

  /** Ease towards the seat; call every frame. */
  update(delta: number): void {
    if (this.seatReady) {
      this.seatPos.lerp(this.seatTarget, 1 - Math.exp(-delta * 9));
      this.pivot.position.copy(this.seatPos);
      if (this.tiltAngle !== 0) {
        // Rotate about the edge: the edge point stays put, s*A - R(s*A) is the shift.
        this.tiltQ.setFromAxisAngle(this.tiltAxis, this.tiltAngle);
        this.pivot.quaternion.copy(this.tiltQ);
        this.tiltV.copy(this.tiltPoint).multiplyScalar(this.scale);
        this.pivot.position.add(this.tiltV);
        this.tiltV.applyQuaternion(this.tiltQ);
        this.pivot.position.sub(this.tiltV);
      } else if (this.pivot.quaternion.w !== 1) {
        this.pivot.quaternion.identity();
      }
    }
    this.clashTime.value += delta;
    this.wrapOcclusion();
  }

  /** Turn the clash check on or off (it needs IWSDK depth occlusion attached to the part). */
  setClash(on: boolean): void {
    this.clashOn.value = on;
  }

  /**
   * IWSDK's depth occlusion replaces this material's compile hook with one
   * that discards fragments behind real surfaces. Wrap it once: in clash mode
   * those fragments are kept and pulse red instead (also as an emissive glow),
   * so a part held against a real machine shows exactly where it runs into it.
   */
  private wrapOcclusion(): void {
    const m = this.mesh.material as MeshStandardMaterial & { onBeforeCompile: (s: unknown, r: unknown) => void };
    const cb = m.onBeforeCompile as unknown;
    if (cb === this.ownCompile || cb === this.clashCompile || cb === this.occlusionCompile) return;
    // A new hook from IWSDK: keep it, and patch the shader text it produces.
    const iwsdk = m.onBeforeCompile.bind(m);
    this.occlusionCompile = cb;
    const wrapped = (shader: { uniforms: Record<string, unknown>; fragmentShader: string; defines?: Record<string, unknown> }, renderer: unknown): void => {
      iwsdk(shader, renderer);
      const block = '  if (occlusion_value < 0.01) {\n      discard;\n  }\n  diffuseColor.a *= occlusion_value;';
      if (!shader.fragmentShader.includes(block)) return;
      shader.uniforms.uClash = this.clashOn;
      shader.uniforms.uClashTime = this.clashTime;
      shader.defines = { ...(shader.defines ?? {}), ASTRA_CLASH: '' };
      shader.fragmentShader = `uniform bool uClash;\nuniform float uClashTime;\n${shader.fragmentShader}`
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );\nif (occlusionEnabled) {', 'vec4 diffuseColor = vec4( diffuse, opacity );\nfloat clashGlow = 0.0;\nif (occlusionEnabled) {')
        .replace(
          block,
          `  if (uClash) {
    // Red where the part is inside or behind a real surface, pulsing. The final pixel is blended
    // after lighting and tone mapping (below), so highlights cannot wash it out to pink.
    float behind = smoothstep(0.15, 0.85, 1.0 - occlusion_value);
    float pulse = 0.7 + 0.3 * sin(uClashTime * 9.0);
    clashGlow = behind * pulse * 0.9;
  } else {
${block}
  }`,
        )
        .replace('#include <dithering_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.1, 0.14), clashGlow);\n#include <dithering_fragment>');
    };
    this.clashCompile = wrapped;
    m.onBeforeCompile = wrapped as typeof m.onBeforeCompile;
    m.needsUpdate = true;
  }

  /** Colour the part per vertex (a draft analysis); cleared by the next build or clearStress. */
  setVertexColors(colors: Float32Array): void {
    if (colors.length !== this.base.length) return;
    this.colors = colors.slice();
    this.mesh.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    const m = this.mesh.material;
    m.vertexColors = true;
    m.color.setHex(0xffffff);
    m.needsUpdate = true;
  }

  /** Draw lines over the part (a parting line), in mm; the next build puts the edges back. */
  showLines(segments: ArrayLike<number>, color: number): void {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(segments), 3));
    this.edges.geometry.dispose();
    this.edges.geometry = g;
    this.edges.material.color.setHex(color);
    this.edges.visible = true;
  }

  /** Show the part in an appearance (a metal, a colour, carbon fibre, wood...), or null for the bench look. */
  setAppearance(a: Appearance | null): void {
    this.appearance = a;
    const m = this.mesh.material;
    const g = this.mesh.geometry;
    if (a) {
      this.tint.setHex(a.color);
      m.metalness = a.metalness;
      m.roughness = a.roughness;
      m.transparent = (a.opacity ?? 1) < 1;
      m.opacity = a.opacity ?? 1;
      const tex = a.texture ? textureFor(a.texture) : null;
      m.map = tex;
      const pos = g.getAttribute('position') as BufferAttribute | undefined;
      const nrm = g.getAttribute('normal') as BufferAttribute | undefined;
      if (tex && pos && nrm) g.setAttribute('uv', new BufferAttribute(boxUv(pos.array, nrm.array), 2));
      this.rim.value = 0.15;
    } else {
      this.tint.setHex(COLORS.part);
      m.metalness = 0.12;
      m.roughness = 0.38;
      m.transparent = false;
      m.opacity = 1;
      m.map = null;
      this.rim.value = 0.55;
    }
    if (!m.vertexColors) m.color.copy(this.tint);
    this.edges.visible = !a;
    m.needsUpdate = true;
  }

  setLook(look: PartLook): void {
    const m = this.mesh.material;
    m.transparent = look === 'rolled-back';
    m.opacity = look === 'rolled-back' ? 0.78 : 1;
    this.tint.setHex(
      look === 'rolled-back' ? COLORS.partRolled : look === 'refused' ? 0xf0b9b9 : this.appearance ? this.appearance.color : COLORS.part,
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
    this.heat.value = 0;
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
    // Glow starts at a third of yield and is full at yield.
    const ratio = peakStress > 0 ? (loadFactor * peakStress) / yieldMPa : 0;
    this.heat.value = Math.min(1, Math.max(0, (ratio - 0.33) / 0.67)) * 0.8;
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

  /** Displace the part along a vibration mode shape (unit peak) by `amp` mm. Returns false if the shape does not fit. */
  showMode(shape: Float32Array, amp: number): boolean {
    const pos = this.mesh.geometry.getAttribute('position') as BufferAttribute | undefined;
    if (!pos || shape.length !== this.base.length || pos.array.length !== this.base.length) {
      return false;
    }
    const p = pos.array as Float32Array;
    for (let i = 0; i < p.length; i++) p[i] = this.base[i] + shape[i] * amp;
    pos.needsUpdate = true;
    return true;
  }

  /** Put the vertices back where the kernel made them. */
  restoreShape(): void {
    const pos = this.mesh.geometry.getAttribute('position') as BufferAttribute | undefined;
    if (pos && pos.array.length === this.base.length) {
      (pos.array as Float32Array).set(this.base);
      pos.needsUpdate = true;
    }
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
