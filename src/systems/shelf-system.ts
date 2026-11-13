/**
 * "My things": parts saved on earlier days stand as small models on a glass
 * ledge beside the bench, so the user's work is waiting on their desk when they
 * come back. Each one is rebuilt from its saved parameters by the kernel (no
 * meshes are stored). Pointing at one and pinching loads it onto the bench.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  createSystem,
  Entity,
  Group,
  Mesh,
  MeshStandardMaterial,
  RayInteractable,
  VisibilityState,
} from '@iwsdk/core';
import { UiButton } from '../components.js';
import { ctx } from '../app/context.js';
import { TextLabel } from '../app/labels.js';
import { COLORS, CSS } from '../app/palette.js';
import { SavedPart } from '../app/persistence.js';
import { registerAction } from '../app/ui3d.js';

const SLOTS = 6;
/** Largest dimension of a miniature, m. */
const MINI = 0.045;

interface Slot {
  group: Group;
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  label: TextLabel;
  entity: Entity;
  id: string;
}

export class ShelfSystem extends createSystem({}) {
  private ledge!: Group;
  private slots: Slot[] = [];
  private builtFor = '';
  private building = false;

  init(): void {
    const { bench, app } = ctx;
    this.ledge = new Group();
    this.ledge.name = 'Shelf';
    // Just behind the bench, a little raised, under the coach panel.
    this.ledge.position.set(0, 0.03, -0.205);
    const glass = new Mesh(
      new BoxGeometry(0.34, 0.006, 0.07),
      new MeshStandardMaterial({ color: COLORS.glass, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.85 }),
    );
    glass.position.y = 0.003;
    const edge = new Mesh(
      new BoxGeometry(0.34, 0.0015, 0.0015),
      new MeshStandardMaterial({ color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 1 }),
    );
    edge.position.set(0, 0.006, 0.035);
    this.ledge.add(glass, edge);
    bench.root.add(this.ledge);
    const ledgeEntity = this.world.createTransformEntity(this.ledge, { parent: ctx.benchEntity, persistent: true });
    const material = new MeshStandardMaterial({ color: COLORS.part, roughness: 0.5, metalness: 0.05 });
    for (let i = 0; i < SLOTS; i++) {
      const group = new Group();
      group.position.set(-0.14 + i * 0.056, 0.006, 0);
      const mesh = new Mesh(new BufferGeometry(), material);
      mesh.name = `Shelf part ${i}`;
      group.add(mesh);
      const label = new TextLabel(0.009);
      label.mesh.position.set(0, 0.06, 0);
      group.add(label.mesh);
      group.visible = false;
      this.ledge.add(group);
      const entity = this.world.createTransformEntity(group, { parent: ledgeEntity, persistent: true });
      entity.addComponent(UiButton, { key: `shelf:${i}` });
      const slot: Slot = { group, mesh, label, entity, id: '' };
      registerAction(`shelf:${i}`, () => {
        const part = app.library.peek().find((p) => p.id === slot.id);
        if (part) {
          app.loadSaved(part);
          ctx.sfx.play('select');
          app.say(`Back on the bench: ${part.title}.`, 'info');
        }
      });
      this.slots.push(slot);
    }
    this.cleanupFuncs.push(app.library.subscribe(() => void this.rebuild()));
  }

  private async rebuild(): Promise<void> {
    const parts = ctx.app.library.peek().slice(0, SLOTS);
    const key = parts.map((p) => p.id).join(',');
    if (key === this.builtFor || this.building) return;
    this.building = true;
    try {
      for (let i = 0; i < SLOTS; i++) {
        await this.fill(this.slots[i], parts[i]);
      }
      this.builtFor = key;
    } finally {
      this.building = false;
    }
    // The library may have changed while building.
    if (ctx.app.library.peek().slice(0, SLOTS).map((p) => p.id).join(',') !== this.builtFor) {
      void this.rebuild();
    }
  }

  private async fill(slot: Slot, part: SavedPart | undefined): Promise<void> {
    if (!part) {
      slot.group.visible = false;
      slot.id = '';
      if (slot.entity.hasComponent(RayInteractable)) slot.entity.removeComponent(RayInteractable);
      return;
    }
    if (slot.id === part.id) return;
    try {
      const res = await ctx.app.engine.run<'built'>({ type: 'build', job: part.job, params: part.params });
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(res.mesh.positions, 3));
      g.setAttribute('normal', new BufferAttribute(res.mesh.normals, 3));
      g.setIndex(new BufferAttribute(res.mesh.indices, 1));
      slot.mesh.geometry.dispose();
      slot.mesh.geometry = g;
      const b = res.props.bbox;
      const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      const s = MINI / size;
      slot.mesh.scale.setScalar(s);
      slot.mesh.position.set(-((b.min[0] + b.max[0]) / 2) * s, -b.min[1] * s, -((b.min[2] + b.max[2]) / 2) * s);
      slot.label.set(`${part.title}  ${part.grams.toFixed(0)} g`, { border: CSS.cyan });
      slot.label.mesh.position.y = (b.max[1] - b.min[1]) * s + 0.012;
      slot.group.visible = true;
      slot.id = part.id;
      if (!slot.entity.hasComponent(RayInteractable)) slot.entity.addComponent(RayInteractable);
    } catch {
      slot.group.visible = false;
    }
  }

  update(): void {
    const show = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (this.ledge.visible !== show) this.ledge.visible = show;
    if (show && this.builtFor === '' && !this.building && ctx.app.library.peek().length) {
      void this.rebuild();
    }
  }
}
