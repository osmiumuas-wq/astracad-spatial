/**
 * Small text labels drawn on a canvas and shown on a camera-facing quad:
 * dimension tags, the caliper readout, load and safety-factor readouts.
 * A label redraws only when its text or style changes.
 */

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { CSS } from './palette.js';

const CANVAS_W = 768;
const CANVAS_H = 128;
const FONT =
  "600 70px system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif";

export interface LabelStyle {
  bg?: string;
  fg?: string;
  border?: string;
}

const sharedGeometry = new PlaneGeometry(1, 1);

export class TextLabel {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private key = '';
  /** Label height in metres; width follows the text. */
  height: number;

  constructor(height = 0.014) {
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.mesh = new Mesh(
      sharedGeometry,
      new MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.mesh.renderOrder = 20;
    this.mesh.frustumCulled = false;
  }

  set(text: string, style: LabelStyle = {}): void {
    const key = `${text}|${style.bg}|${style.fg}|${style.border}|${this.height}`;
    if (key === this.key) {
      return;
    }
    this.key = key;
    const ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.font = FONT;
    const pad = 34;
    const w = Math.min(CANVAS_W, Math.ceil(ctx.measureText(text).width) + pad * 2);
    const r = CANVAS_H / 2 - 4;
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, CANVAS_H - 8, r);
    ctx.fillStyle = style.bg ?? CSS.panel;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = style.border ?? 'rgba(255,255,255,0.22)';
    ctx.stroke();
    ctx.fillStyle = style.fg ?? CSS.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pad, CANVAS_H / 2 + 4, CANVAS_W - pad * 2);
    this.texture.repeat.set(w / CANVAS_W, 1);
    this.texture.needsUpdate = true;
    this.mesh.scale.set((w / CANVAS_H) * this.height, this.height, 1);
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  dispose(): void {
    this.texture.dispose();
    this.mesh.material.dispose();
  }
}

const tmp = new Vector3();

/** Turn an object to face a world-space point (the viewer's head), keeping it upright. */
export function faceViewer(object: Object3D, viewer: Vector3): void {
  object.getWorldPosition(tmp);
  if (tmp.distanceToSquared(viewer) < 1e-8) {
    return;
  }
  object.lookAt(viewer);
}
