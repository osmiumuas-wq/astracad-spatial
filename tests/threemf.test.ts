import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultParams, jobById } from '../src/engine/jobs.js';
import { initKernel } from '../src/engine/kernel.js';
import { toThreeMF } from '../src/engine/threemf.js';

/** Independent reader: Python's zipfile and XML parser recompute volume and open edges. */
const READER = String.raw`
import sys, zipfile, xml.etree.ElementTree as ET
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
names = z.namelist()
assert '3D/3dmodel.model' in names and '[Content_Types].xml' in names and '_rels/.rels' in names
core = '{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}'
root = ET.fromstring(z.read('3D/3dmodel.model'))
V = [(float(v.get('x')), float(v.get('y')), float(v.get('z'))) for v in root.iter(core + 'vertex')]
vol = 0.0
edges = {}
for t in root.iter(core + 'triangle'):
    a, b, c = (int(t.get(k)) for k in ('v1', 'v2', 'v3'))
    (ax, ay, az), (bx, by, bz), (cx, cy, cz) = V[a], V[b], V[c]
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
    for e in ((a, b), (b, c), (c, a)):
        edges[e] = edges.get(e, 0) + 1
open_edges = sum(1 for (p, q), k in edges.items() if edges.get((q, p), 0) != k)
print(vol / 6, len(V), open_edges)
`;

describe('3MF export', () => {
  it('writes a valid package whose welded mesh keeps the kernel volume', async () => {
    const kernel = await initKernel();
    const job = jobById('wall-bracket');
    const out = kernel.build(job.spec(defaultParams(job)));
    const n = out.mesh.positions.length / 3;
    const colors = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) colors[v * 3] = out.mesh.positions[v * 3 + 1] / 70;
    const res = toThreeMF(out.mesh.positions, out.mesh.indices, colors, 'bracket');
    expect(res.triangles).toBe(out.props.triangles);
    const dir = mkdtempSync(join(tmpdir(), 'astra3mf-'));
    const file = join(dir, 'part.3mf');
    writeFileSync(file, res.bytes);
    const [vol, verts, open] = execFileSync('python', ['-I', '-c', READER, file], { encoding: 'utf8' })
      .trim()
      .split(' ')
      .map(Number);
    console.log(
      `3MF: ${verts} welded vertices, ${res.triangles} triangles, ${res.colors} colours, volume ${vol.toFixed(3)} vs kernel ${out.props.volume.toFixed(3)}, open edges ${open}`,
    );
    expect(open).toBe(0);
    expect(Math.abs(vol - out.props.volume) / out.props.volume).toBeLessThan(1e-5);
  });
});
