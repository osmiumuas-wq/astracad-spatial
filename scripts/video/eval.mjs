// Runs a snippet of JavaScript in the app (scripts/video/eval.json: {"code": "..."}), with
// `a` = globalThis.astra.app and `x` = globalThis.astra; returns its result (debug and video aid).
import { readFileSync } from 'node:fs';

export default async function run({ page, frame }) {
  const { code } = JSON.parse(readFileSync('scripts/video/eval.json', 'utf8'));
  return (frame ?? page).evaluate(async (src) => {
    const x = globalThis.astra;
    const a = x.app;
    const fn = new Function('a', 'x', `return (async () => { ${src} })();`);
    return fn(a, x);
  }, code);
}
