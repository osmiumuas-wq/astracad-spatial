// Writes the app's real parts as binary STL for the demo video's Blender shots (artifacts/video/parts).
// Skipped unless EXPORT_PARTS=1, so it never runs in CI.
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expectVolume } from '../src/engine/expect.js';
import { toBinaryStl } from '../src/engine/exporters.js';
import { defaultParams, JOBS } from '../src/engine/jobs.js';
import { initKernel } from '../src/engine/kernel.js';
import { runGate } from '../src/engine/truth.js';

describe.skipIf(process.env.EXPORT_PARTS !== '1')('export parts for the video', () => {
  it('writes every part as STL, each verified first', async () => {
    const kernel = await initKernel();
    mkdirSync('artifacts/video/parts', { recursive: true });
    const report: Record<string, unknown> = {};
    for (const job of JOBS) {
      if (job.id === 'air-sketch') continue;
      const p = defaultParams(job);
      const spec = job.spec(p);
      const out = kernel.build(spec);
      const gate = runGate({ props: out.props, generic: expectVolume(spec), jobVolume: job.volume(p), jobBox: job.box(p), jobGenus: job.genus(p), jobBodies: job.bodies });
      writeFileSync(`artifacts/video/parts/${job.id}.stl`, toBinaryStl(out.mesh.positions, out.mesh.indices, job.title));
      report[job.id] = { verdict: gate.verdict, volume: out.props.volume, bbox: out.props.bbox };
    }
    writeFileSync('artifacts/video/parts/report.json', JSON.stringify(report, null, 1));
    expect(Object.keys(report).length).toBeGreaterThan(5);
  });
});
