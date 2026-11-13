/**
 * An imported STEP model shown as translucent glass, seated in the pocket of
 * the cradle fitted round it, so the clearance can be seen from every side.
 */

import {
  BufferAttribute,
  BufferGeometry,
  createSystem,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
} from '@iwsdk/core';
import { ctx } from '../app/context.js';
import { COLORS } from '../app/palette.js';

export class ReferenceSystem extends createSystem({}) {
  private mesh!: Mesh<BufferGeometry, MeshStandardMaterial>;
  private edges!: LineSegments<BufferGeometry, LineBasicMaterial>;

  init(): void {
    const { app, bench } = ctx;
    this.mesh = new Mesh(
      new BufferGeometry(),
      new MeshStandardMaterial({ color: COLORS.violet, emissive: COLORS.violet, emissiveIntensity: 0.35, transparent: true, opacity: 0.4, depthWrite: false, roughness: 0.3 }),
    );
    this.mesh.name = 'Imported STEP model';
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    // Empty until a model arrives (EdgesGeometry needs a geometry with positions).
    this.edges = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: COLORS.white, transparent: true, opacity: 0.7, toneMapped: false }));
    this.mesh.add(this.edges);
    bench.turntable.add(this.mesh);
    this.world.createTransformEntity(this.mesh, { parent: ctx.turntableEntity, persistent: true });
    this.cleanupFuncs.push(
      app.reference.subscribe((m) => {
        if (!m) {
          this.mesh.visible = false;
          return;
        }
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(m.positions, 3));
        g.setIndex(new BufferAttribute(m.indices, 1));
        g.computeVertexNormals();
        this.mesh.geometry.dispose();
        this.mesh.geometry = g;
        this.edges.geometry.dispose();
        this.edges.geometry = new EdgesGeometry(g, 30);
      }),
    );
  }

  update(): void {
    const { app, bench } = ctx;
    const show = app.reference.peek() !== null && app.jobId.peek() === 'cradle' && app.rollback.peek() === null;
    this.mesh.visible = show;
    if (!show) return;
    const s = bench.part.scale;
    this.mesh.scale.setScalar(s);
    this.mesh.position.copy(bench.part.pivot.position);
    this.mesh.position.y += app.params.peek().floor * s;
  }
}
