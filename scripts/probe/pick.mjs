// Selects the job named in scripts/probe/pick.json ({"job": "..."}) (debug aid).
import { readFileSync } from 'node:fs';
export default async function run({ page, frame }) {
  const { job } = JSON.parse(readFileSync('scripts/probe/pick.json', 'utf8'));
  return (frame ?? page).evaluate((id) => { globalThis.astra.app.selectJob(id); return id; }, job);
}
