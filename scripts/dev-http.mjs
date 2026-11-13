/**
 * Start the IWSDK dev runtime over plain HTTP on localhost, with a headless
 * managed browser for automated XR checks.
 *
 * `npm run dev` keeps the default HTTPS server, which a headset on the same
 * Wi-Fi needs. This script is for desktop previews and for a Quest connected
 * with `adb reverse`, where http://localhost already is a secure context.
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(
  process.execPath,
  [
    join(root, 'node_modules', '@iwsdk', 'cli', 'dist', 'cli.js'),
    'dev',
    'up',
    '--foreground',
    '--ai-mode',
    'agent',
    '--allow-browser-automation',
    '--workspace',
    root,
  ],
  { stdio: 'inherit', cwd: root, env: { ...process.env, ASTRA_DEV_HTTP: '1' } },
);
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
