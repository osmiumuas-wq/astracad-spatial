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

const FONT_STACK = "'Inter Tight', system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', Arial, sans-serif";
const MONO_STACK = "'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace";

/** Frosted glass fill: blue at the top left, violet at the bottom right. */
function glassFill(c: CanvasRenderingContext2D, w: number, h: number, alpha: number): CanvasGradient {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `rgba(52, 84, 178, ${alpha})`);
  g.addColorStop(0.55, `rgba(36, 44, 112, ${alpha})`);
  g.addColorStop(1, `rgba(78, 52, 150, ${alpha})`);
  return g;
}

/** The bright rim along the top of a glass shape. */
function glassRim(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, line: number): void {
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0.28)');
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.lineWidth = line;
  c.strokeStyle = g;
  c.stroke();
}
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
  default: { bg: 'glass', fg: CSS.text, border: 'rim' },
  primary: { bg: 'blue', fg: '#ffffff', border: 'rgba(255,255,255,0.6)' },
  good: { bg: 'rgba(30,110,80,0.85)', fg: CSS.text, border: CSS.green },
  warn: { bg: 'rgba(110,72,18,0.85)', fg: CSS.text, border: CSS.amber },
  bad: { bg: 'rgba(120,30,40,0.85)', fg: CSS.text, border: CSS.red },
  ghost: { bg: 'rgba(30,36,80,0.6)', fg: CSS.dim, border: 'rgba(255,255,255,0.22)' },
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
  const r = h / 2 - 3;
  c.beginPath();
  c.roundRect(3, 3, w - 6, h - 6, r);
  let fill: string | CanvasGradient = tone.bg;
  if (tone.bg === 'glass') {
    fill = glassFill(c, w, h, b.hovered ? 0.95 : 0.86);
  } else if (tone.bg === 'blue') {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#4b8bff');
    g.addColorStop(0.5, '#3d6cff');
    g.addColorStop(1, '#6f5bff');
    fill = g;
  }
  c.fillStyle = b.pressed ? '#ffffff' : highContrast && !b.toggled ? '#000000' : fill;
  c.globalAlpha = b.disabled ? 0.45 : 1;
  c.fill();
  if (b.hovered || highContrast || tone.border !== 'rim') {
    c.lineWidth = b.hovered || highContrast ? 7 : 4;
    c.strokeStyle = b.hovered ? CSS.cyan : highContrast ? '#ffffff' : tone.border;
    c.stroke();
  } else {
    glassRim(c, 3, 3, w - 6, h - 6, r, 4);
  }
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
    // Single pass: three.js otherwise draws a transparent double-sided material twice (back faces, then front),
    // flagging it for a shader recompile check each time; on a flat panel the second pass changes nothing.
    new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthWrite: false, side: DoubleSide, forceSinglePass: true }),
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

// ---------------------------------------------------------------------------
// Beacon: a soft pulsing ring behind the one button the guide wants pressed next
// ---------------------------------------------------------------------------

let beacon: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null;
let beaconCanvas: HTMLCanvasElement | null = null;
let beaconKey = '';
let beaconT = 0;

function drawBeacon(width: number, height: number): void {
  const pad = 0.006;
  const c = beaconCanvas!;
  c.width = Math.round((width + pad * 2) * PX_PER_M * 0.5);
  c.height = Math.round((height + pad * 2) * PX_PER_M * 0.5);
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.clearRect(0, 0, c.width, c.height);
  const inset = (pad * PX_PER_M * 0.5) / 2;
  g.shadowColor = CSS.amber;
  g.shadowBlur = inset * 2.2;
  g.strokeStyle = CSS.amber;
  g.lineWidth = Math.max(4, inset * 0.95);
  g.beginPath();
  g.roundRect(inset, inset, c.width - inset * 2, c.height - inset * 2, (c.height - inset * 2) / 2);
  // Twice: the second pass makes the glow read on a bright room.
  g.stroke();
  g.stroke();
  beacon!.material.map!.needsUpdate = true;
  beacon!.scale.set(width + pad * 2, height + pad * 2, 1);
}

/**
 * Put the guide's beacon on `key` (or remove it with null). Cheap to call every
 * frame: it only does work when the target changes.
 */
export function highlightButton(key: string | null): void {
  const k = key ?? '';
  if (k === beaconKey) return;
  beaconKey = k;
  if (!beacon) {
    beaconCanvas = document.createElement('canvas');
    const texture = new CanvasTexture(beaconCanvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
    beacon = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthWrite: false, side: DoubleSide, forceSinglePass: true }),
    );
    beacon.name = 'Guide beacon';
    beacon.renderOrder = 11;
    // Never catches a ray meant for the button.
    beacon.raycast = () => {};
  }
  beacon.removeFromParent();
  const b = k ? buttons.get(k) : undefined;
  if (!b) return;
  const { width, height } = b.mesh.geometry.parameters;
  drawBeacon(width, height);
  beacon.position.set(0, 0, -0.0006);
  beaconT = 0;
  b.mesh.add(beacon);
}

export function highlightedButton(): string {
  return beaconKey;
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

const panels: TextPanel[] = [];

/**
 * Animate result pops: a panel with a new headline springs forward from 94 %
 * and settles at full size. Call once per frame; `still` turns it off
 * (the Less motion setting).
 */
export function tickPanels(delta: number, still: boolean): void {
  if (beacon?.parent) {
    beaconT += delta;
    const wave = 0.5 + 0.5 * Math.sin(beaconT * 4.2);
    beacon.material.opacity = still ? 0.9 : 0.45 + 0.55 * wave;
  }
  for (const p of panels) {
    if (p.popAt < 0) continue;
    p.popAt += delta;
    const t = p.popAt;
    const s = still || t > 0.8 ? 1 : 1 - 0.06 * Math.exp(-7 * t) * Math.cos(14 * t);
    // A layout may have shrunk the panel (the compact view for glasses): pop around that size.
    p.group.scale.setScalar(s * ((p.group.userData.baseScale as number | undefined) ?? 1));
    p.mesh.position.z = still ? 0 : 0.012 * Math.exp(-5 * t) * Math.sin(Math.min(Math.PI, t * 9));
    if (s === 1) {
      p.popAt = -1;
      p.mesh.position.z = 0;
    }
  }
}

export class TextPanel {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly group = new Group();
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private key = '';
  private head = '';
  /** Seconds since the last pop, or -1 when settled. */
  popAt = -1;

  constructor(
    readonly width: number,
    readonly height: number,
    name: string,
  ) {
    panels.push(this);
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
    // A new headline (a verdict, a result) pops the panel forward; small edits do not.
    const head = accent + lines.slice(0, 3).map((l) => l.text).join('|');
    if (head !== this.head) {
      if (this.head !== '') this.popAt = 0;
      this.head = head;
    }
    const c = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const mm = PX_PER_M / 1000;
    c.clearRect(0, 0, W, H);
    const radius = 14 * mm;
    c.beginPath();
    c.roundRect(4, 4, W - 8, H - 8, radius);
    c.fillStyle = highContrast ? '#000000' : glassFill(c, W, H, 0.84);
    c.fill();
    if (highContrast) {
      c.lineWidth = 8;
      c.strokeStyle = '#ffffff';
      c.stroke();
    } else {
      // A soft sheen across the upper half, then the bright glass rim.
      const sheen = c.createLinearGradient(0, 0, 0, H * 0.5);
      sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = sheen;
      c.fill();
      glassRim(c, 4, 4, W - 8, H - 8, radius, 5);
      // The accent glows along the top edge.
      const glow = c.createLinearGradient(radius, 0, W * 0.6, 0);
      glow.addColorStop(0, accent);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = glow;
      c.fillRect(radius, 4, W * 0.6 - radius, 2.2 * mm);
    }
    const pad = 9 * mm;
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
      // Short upper-case lines are eyebrow labels: monospace and spaced out, as on the flat page.
      const eyebrow = l.text.length < 40 && /[A-Z]/u.test(l.text) && l.text === l.text.toUpperCase() && (l.size ?? 4.6) <= 3.6;
      c.font = eyebrow ? `500 ${size}px ${MONO_STACK}` : `${l.weight ?? 500} ${size}px ${FONT_STACK}`;
      (c as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = eyebrow ? `${(size * 0.08).toFixed(1)}px` : '0px';
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
