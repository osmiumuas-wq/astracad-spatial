// Sets the getting-started progress from scripts/probe/guide.json ({"skills": {...}}) and
// reports which button carries the guide beacon (debug aid).
import { readFileSync } from 'node:fs';
export default async function run({ page, frame }) {
  const want = JSON.parse(readFileSync('scripts/probe/guide.json', 'utf8'));
  const f = frame ?? page;
  await f.evaluate((w) => {
    const a = globalThis.astra;
    a.app.progress.value = { ...a.app.progress.value, coachDone: false, skills: w.skills };
  }, want);
  await new Promise((r) => setTimeout(r, 400));
  const out = await f.evaluate(() => {
    const a = globalThis.astra;
    let beacon = null;
    a.world.scene.traverse((o) => { if (o.name === 'Guide beacon' && o.parent) beacon = o.parent.name; });
    return { coachDone: a.app.progress.value.coachDone, mode: a.app.mode.value, beacon };
  });
  console.log(JSON.stringify(out));
  return out;
}
