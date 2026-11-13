/**
 * Spatial UI drawn on canvases: text panels and buttons.
 *
 * Buttons are ordinary IWSDK interactables (RayInteractable + PokeInteractable),
 * so the same button answers a hand ray pinch, a fingertip poke, gaze and
 * pinch on Meta VR Glasses, a controller trigger, and a mouse click on the
 * flat page. The UI system (src/systems/ui-system.ts) dispatches presses.
 */

import {
  CanvasTexture,
  DoubleSide,
  Entity,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PokeInteractable,
  RayInteractable,
  SRGBColorSpace,
} from '@iwsdk/core';
import { UiButton } from '../components.js';
import { ctx } from './context.js';
import { CSS } from './palette.js';

const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', Arial, sans-serif";
/** Canvas pixels per metre of panel. */
const PX_PER_M = 4200;
/** Panel line sizes are written small; this brings them to about 1.1 degrees at 0.5 m. */
const TEXT_GAIN = 2.5;

export type Tone = 'default' | 'primary' | 'good' | 'warn' | 'bad' | 'ghost';

export interface ButtonSpec {
  key: string;
  label: string;
  width?: number;
  height?: number;
  tone?: Tone;
  /**
   * Also press on a fingertip touch. Off by default: hands reach past most
   * buttons on the way to the bench, and a touch there must not fire them.
   */
  poke?: boolean;
}

interface ButtonRecord {
  key: string;
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  entity: Entity;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  label: string;
  tone: Tone;
  poke: boolean;
  hovered: boolean;
  pressed: boolean;
  toggled: boolean;
  disabled: boolean;
  drawn: string;
  onPress: () => void;
}

const buttons = new Map<string, ButtonRecord>();
/** Actions for interactables that are not canvas buttons (part handles). */
const actions = new Map<string, () => void>();

export function registerAction(key: string, fn: () => void): void {
  actions.set(key, fn);
}

const TONES: Record<Tone, { bg: string; fg: string; border: string }> = {
  default: { bg: '#14203a', fg: CSS.text, border: '#2f4366' },
  primary: { bg: '#ffb020', fg: '#1a1203', border: '#ffd06b' },
  good: { bg: '#123524', fg: CSS.text, border: CSS.green },
  warn: { bg: '#3a2a08', fg: CSS.text, border: CSS.amber },
  bad: { bg: '#3a1214', fg: CSS.text, border: CSS.red },
  ghost: { bg: 'rgba(11,18,32,0.55)', fg: CSS.dim, border: '#2b3a57' },
};

let highContrast = false;
let textScale = 1;

export function setUiStyle(contrast: boolean, scale: number): void {
  highContrast = contrast;
  textScale = scale;
  for (const b of buttons.values()) {
    b.drawn = '';
    drawButton(b);
  }
}

function drawButton(b: ButtonRecord): void {
  const state = `${b.label}|${b.tone}|${b.hovered}|${b.pressed}|${b.toggled}|${b.disabled}|${highContrast}|${textScale}`;
  if (state === b.drawn) {
    return;
  }
  b.drawn = state;
  const c = b.canvas.getContext('2d') as CanvasRenderingContext2D;
  const w = b.canvas.width;
  const h = b.canvas.height;
  c.clearRect(0, 0, w, h);
  const tone = TONES[b.toggled ? 'primary' : b.tone];
  c.beginPath();
  c.roundRect(3, 3, w - 6, h - 6, Math.min(h / 2 - 3, 34));
  c.fillStyle = b.pressed ? '#ffffff' : highContrast && !b.toggled ? '#000000' : tone.bg;
  c.globalAlpha = b.disabled ? 0.45 : 1;
  c.fill();
  c.lineWidth = b.hovered || highContrast ? 7 : 4;
  c.strokeStyle = b.hovered ? CSS.cyan : highContrast ? '#ffffff' : tone.border;
  c.stroke();
  c.fillStyle = b.pressed ? '#0b1220' : highContrast && !b.toggled ? '#ffffff' : tone.fg;
  const size = Math.min(h * 0.46, 58) * textScale;
  c.font = `650 ${size}px ${FONT_STACK}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(b.label, w / 2, h / 2 + 2, w - 24);
  c.globalAlpha = 1;
  b.texture.needsUpdate = true;
}

/** Create a button as a child of `parent`. Returns its group for placement. */
export function makeButton(
  parent: Entity,
  spec: ButtonSpec,
  onPress: () => void,
): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const width = spec.width ?? 0.07;
  const height = spec.height ?? 0.024;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * PX_PER_M);
  canvas.height = Math.round(height * PX_PER_M);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  const mesh = new Mesh(
    new PlaneGeometry(width, height),
    // Double-sided so a ray from a low hand still hits a button tilted away from it.
    new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthWrite: false, side: DoubleSide }),
  );
  mesh.name = `Button ${spec.key}`;
  mesh.renderOrder = 12;
  const entity = ctx.world.createTransformEntity(mesh, { parent, persistent: true });
  entity.addComponent(RayInteractable);
  if (spec.poke) entity.addComponent(PokeInteractable);
  entity.addComponent(UiButton, { key: spec.key });
  const rec: ButtonRecord = {
    key: spec.key,
    mesh,
    entity,
    canvas,
    texture,
    label: spec.label,
    tone: spec.tone ?? 'default',
    poke: spec.poke ?? false,
    hovered: false,
    pressed: false,
    toggled: false,
    disabled: false,
    drawn: '',
    onPress,
  };
  buttons.set(spec.key, rec);
  drawButton(rec);
  return mesh;
}

export function buttonPressed(key: string): void {
  const b = buttons.get(key);
  if (!b) {
    actions.get(key)?.();
    return;
  }
  if (b.disabled || !b.mesh.visible) {
    return;
  }
  b.pressed = true;
  drawButton(b);
  setTimeout(() => {
    b.pressed = false;
    drawButton(b);
  }, 140);
  ctx.sfx.play('select', undefined);
  b.onPress();
}

export function buttonHover(key: string, on: boolean): void {
  const b = buttons.get(key);
  if (b && b.hovered !== on) {
    b.hovered = on;
    drawButton(b);
    if (on && b.mesh.visible) {
      ctx.sfx.play('hover');
    }
  }
}

export function setButton(
  key: string,
  patch: Partial<Pick<ButtonRecord, 'label' | 'tone' | 'toggled' | 'disabled'>> & { visible?: boolean },
): void {
  const b = buttons.get(key);
  if (!b) {
    return;
  }
  if (patch.label !== undefined) b.label = patch.label;
  if (patch.tone !== undefined) b.tone = patch.tone;
  if (patch.toggled !== undefined) b.toggled = patch.toggled;
  if (patch.disabled !== undefined) b.disabled = patch.disabled;
  if (patch.visible !== undefined && b.mesh.visible !== patch.visible) {
    b.mesh.visible = patch.visible;
    // A hidden button must not catch rays.
    if (patch.visible) {
      if (!b.entity.hasComponent(RayInteractable)) b.entity.addComponent(RayInteractable);
      if (b.poke && !b.entity.hasComponent(PokeInteractable)) b.entity.addComponent(PokeInteractable);
    } else {
      if (b.entity.hasComponent(RayInteractable)) b.entity.removeComponent(RayInteractable);
      if (b.entity.hasComponent(PokeInteractable)) b.entity.removeComponent(PokeInteractable);
    }
  }
  drawButton(b);
}

export function buttonMesh(key: string): Mesh | undefined {
  return buttons.get(key)?.mesh;
}

// ---------------------------------------------------------------------------
// Text panels
// ---------------------------------------------------------------------------

export interface Line {
  text: string;
  /** Font size in millimetres of panel. */
  size?: number;
  color?: string;
  weight?: number;
  /** Right-aligned value on the same row. */
  value?: string;
  valueColor?: string;
  /** Draw a coloured block behind the line. */
  band?: string;
  gapAfter?: number;
}

export class TextPanel {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly group = new Group();
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private key = '';

  constructor(
    readonly width: number,
    readonly height: number,
    name: string,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * PX_PER_M);
    this.canvas.height = Math.round(height * PX_PER_M);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.mesh = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthWrite: false }),
    );
    this.mesh.name = name;
    this.mesh.renderOrder = 10;
    this.group.name = `${name} group`;
    this.group.add(this.mesh);
  }

  draw(lines: Line[], accent: string = CSS.cyan): void {
    const key = JSON.stringify(lines) + accent + highContrast + textScale;
    if (key === this.key) {
      return;
    }
    this.key = key;
    const c = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const mm = PX_PER_M / 1000;
    c.clearRect(0, 0, W, H);
    c.beginPath();
    c.roundRect(4, 4, W - 8, H - 8, 9 * mm);
    c.fillStyle = highContrast ? '#000000' : 'rgba(9,15,28,0.94)';
    c.fill();
    c.lineWidth = highContrast ? 8 : 4;
    c.strokeStyle = highContrast ? '#ffffff' : '#2b3a57';
    c.stroke();
    c.fillStyle = accent;
    c.fillRect(4, 4 + 9 * mm, 3 * mm, 16 * mm);
    const pad = 8 * mm;
    let y = pad;
    c.textBaseline = 'top';
    for (const l of lines) {
      const size = (l.size ?? 4.6) * mm * textScale * TEXT_GAIN;
      if (y + size > H - pad * 0.5) {
        break;
      }
      if (l.band) {
        c.fillStyle = l.band;
        c.beginPath();
        c.roundRect(pad * 0.6, y - size * 0.3, W - pad * 1.2, size * 1.6, size * 0.4);
        c.fill();
      }
      c.font = `${l.weight ?? 500} ${size}px ${FONT_STACK}`;
      c.fillStyle = highContrast ? '#ffffff' : (l.color ?? CSS.text);
      c.textAlign = 'left';
      if (l.value) {
        c.fillText(l.text, pad, y, W * 0.5);
        c.textAlign = 'right';
        c.fillStyle = highContrast ? '#ffffff' : (l.valueColor ?? CSS.text);
        c.font = `650 ${size}px ${FONT_STACK}`;
        c.fillText(l.value, W - pad, y, W * 0.46);
        y += size * 1.32;
      } else {
        // Wrap on spaces; never squeeze glyphs.
        const words = l.text.split(' ');
        let line = '';
        for (const word of words) {
          const trial = line ? `${line} ${word}` : word;
          if (line && c.measureText(trial).width > W - pad * 2) {
            c.fillText(line, pad, y, W - pad * 2);
            y += size * 1.25;
            line = word;
            if (y + size > H - pad * 0.5) break;
          } else {
            line = trial;
          }
        }
        if (line && y + size <= H - pad * 0.5) {
          c.fillText(line, pad, y, W - pad * 2);
        }
        y += size * 1.32;
      }
      y += (l.gapAfter ?? 0) * mm;
    }
    this.texture.needsUpdate = true;
  }

  /** Draw an image (a QR code) centred below `top` millimetres. */
  drawImage(source: HTMLCanvasElement, top: number, sizeMm: number): void {
    const c = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    const mm = PX_PER_M / 1000;
    const s = sizeMm * mm;
    c.imageSmoothingEnabled = false;
    c.drawImage(source, (this.canvas.width - s) / 2, top * mm, s, s);
    this.texture.needsUpdate = true;
    this.key = '';
  }
}
