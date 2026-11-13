/**
 * Serve the production build (dist/) over plain HTTP on localhost, to check
 * the built site the way GitHub Pages will serve it (`npm run build` first).
 * Usage: node scripts/preview-http.mjs [port]
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.argv[2] ?? '4174';
const child = spawn(
  process.execPath,
  [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', port, '--strictPort', '--host', '127.0.0.1'],
  { stdio: 'inherit', cwd: root, env: { ...process.env, ASTRA_DEV_HTTP: '1' } },
);
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
