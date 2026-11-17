/**
 * The engineering drawing in the room: the A4 sheet (life size, 297 x 210 mm)
 * springs out of the part and hangs above the bench, facing the user. Press
 * Drawing again to put it away. On the flat page the same sheet downloads as SVG.
 */

import {
  CanvasTexture,
  createSystem,
  DoubleSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { ctx, probe } from '../app/context.js';
import { setButton } from '../app/ui3d.js';

const POP_S = 0.65;
/** Shown larger than A4 in the headset so the lettering reads at arm's length; the file stays true scale. */
const SHOWN = 1.6;
const PX_W = 2048;
const PX_H = Math.round((PX_W * 210) / 297);

export class DrawingSystem extends createSystem({}) {
  private sheet!: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private canvas!: HTMLCanvasElement;
  private texture!: CanvasTexture;
  private t = -1;
  private busy = false;
  private readonly from = new Vector3();
  private readonly to = new Vector3(0, 0.3, -0.1);
  private readonly eye = new Vector3();

  init(): void {
    const { app, bench } = ctx;
    this.canvas = document.createElement('canvas');
    this.canvas.width = PX_W;
    this.canvas.height = PX_H;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.sheet = new Mesh(
      new PlaneGeometry(0.297, 0.21),
      new MeshBasicMaterial({ map: this.texture, toneMapped: false, side: DoubleSide, transparent: true, forceSinglePass: true }),
    );
    this.sheet.name = 'Engineering drawing';
    this.sheet.visible = false;
    this.sheet.renderOrder = 30;
    bench.root.add(this.sheet);
    this.world.createTransformEntity(this.sheet, { parent: ctx.benchEntity, persistent: true });
    this.cleanupFuncs.push(
      app.params.subscribe(() => this.hide()),
      app.jobId.subscribe(() => this.hide()),
    );
  }

  async toggle(): Promise<void> {
    if (this.sheet.visible) {
      this.hide();
      return;
    }
    if (this.busy) return;
    this.busy = true;
    setButton('act:drawing', { toggled: true, label: 'Drawing...' });
    try {
      const d = await ctx.app.makeDrawing();
      if (!d) return;
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`;
      await img.decode();
      const c = this.canvas.getContext('2d') as CanvasRenderingContext2D;
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, PX_W, PX_H);
      c.drawImage(img, 0, 0, PX_W, PX_H);
      this.texture.needsUpdate = true;
      // Spring out of the part's centre.
      const b = ctx.bench.part.box;
      this.from.set(0, ((b.max[1] - b.min[1]) / 2) * ctx.bench.part.scale, 0);
      ctx.bench.root.updateMatrixWorld(true);
      this.eye.set(0, 0.34, 0.42);
      this.sheet.position.copy(this.to);
      this.sheet.lookAt(ctx.bench.root.localToWorld(this.eye.clone()));
      this.sheet.visible = true;
      this.t = 0;
      probe.drawing = { holes: d.holes, chars: d.svg.length };
      ctx.sfx.play('grow');
      ctx.app.say(`Drawing: three views, shown larger than A4 here${d.holes ? `, ${d.holes} through-hole${d.holes === 1 ? '' : 's'} called out` : ''}. Download it from the flat page to print.`, 'good');
      setButton('act:drawing', { toggled: true, label: 'Put away' });
    } finally {
      this.busy = false;
      if (!this.sheet.visible) setButton('act:drawing', { toggled: false, label: 'Drawing' });
    }
  }

  private hide(): void {
    if (!this.sheet.visible) return;
    this.sheet.visible = false;
    this.t = -1;
    setButton('act:drawing', { toggled: false, label: 'Drawing' });
  }

  update(delta: number): void {
    if (this.t < 0) return;
    if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      // The flat page downloads the sheet instead; keep the view clear.
      this.hide();
      return;
    }
    this.t += delta;
    const u = Math.min(1, this.t / POP_S);
    const still = ctx.app.settings.peek().reduceMotion;
    // Ease out with a little overshoot: the sheet springs into place.
    const e = still ? 1 : 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2);
    this.sheet.position.copy(this.from).lerp(this.to, Math.min(1, e));
    this.sheet.scale.setScalar(Math.max(0.05, e) * SHOWN);
    if (u >= 1) {
      this.sheet.position.copy(this.to);
      this.sheet.scale.setScalar(SHOWN);
      this.t = -1;
    }
  }
}
