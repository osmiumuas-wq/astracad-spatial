#!/usr/bin/env node
// Run AstraCAD's deterministic WebXR smoke against the IWSDK/IWER Quest 3 emulator.
// The JSON is useful for functional regression; desktop frame times are not Quest performance evidence.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const outputArg = args.find((arg) => arg.startsWith('--output='))?.slice('--output='.length) ?? 'artifacts/iwer-smoke.json';
const output = resolve(root, outputArg);
if (!output.startsWith(`${root}/`) && !output.startsWith(`${root}\\`)) {
  console.error('Output path must remain inside the repository.');
  process.exit(2);
}

const cliEntry = resolve(root, 'node_modules/@iwsdk/cli/bin/iwsdk.js');
function cli(cliArgs, { quiet = false } = {}) {
  const result = spawnSync(process.execPath, [cliEntry, ...cliArgs], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.stdout && !quiet) process.stdout.write(result.stdout);
  if (result.stderr && !quiet) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(`iwsdk ${cliArgs[0]} exited with ${result.status}${details ? `:\n${details}` : ''}`);
  }
  return result.stdout;
}
function objectFromCli(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('CLI returned no JSON object');
  return JSON.parse(text.slice(start));
}
function xrStatus() {
  return objectFromCli(cli(['xr', 'status'], { quiet: true })).data.result;
}
function appMode() {
  return objectFromCli(cli(['browser', 'run', 'scripts/probe/emulator-mode.mjs', '--timeout', '45000'], { quiet: true })).data.result.mode;
}

try {
  const status = xrStatus();
  if (status.runtimeKind !== 'emulated' || !status.isRuntimeInstalled || status.deviceName !== 'Meta Quest 3') {
    throw new Error('Expected the IWSDK IWER Meta Quest 3 emulator; inspect iwsdk.config.json dev.emulator.device.');
  }
  if (!status.sessionActive) cli(['xr', 'enter']);
  else if (status.sessionMode !== 'immersive-ar') {
    throw new Error(`Expected an immersive-ar IWER session; current mode is ${status.sessionMode ?? 'unknown'}.`);
  }
  cli(['xr', 'set-input-mode', '--input-json', '{"mode":"hand"}']);

  // Return to the normal shaping tool after any prior scripted interactions.
  const currentMode = appMode();
  if (currentMode && currentMode !== 'shape') {
    const targets = objectFromCli(cli(['xr', 'list-targets'], { quiet: true })).data.result.targets;
    const shapeButton = targets.find((target) => target.name === 'Button mode:shape');
    if (!shapeButton) throw new Error('Could not find the emulated Shape mode button');
    const sequence = JSON.stringify({
      device: 'hand-right',
      steps: [
        { target: shapeButton.name, approach: { distance: 0.08 }, press: {}, depart: { distance: 0.1 } },
      ],
    });
    const result = objectFromCli(cli(['xr', 'run-sequence', '--input-json', sequence, '--timeout', '45000'], { quiet: true })).data.result;
    if (!result.completed || !result.presses?.length || result.presses.some((press) => press.contactMs >= 800)) {
      throw new Error(`Could not reliably select Shape mode: ${JSON.stringify(result.presses ?? result)}`);
    }
  }

  const raw = cli(['browser', 'run', 'scripts/probe/emulator-smoke.mjs', '--timeout', '90000'], { quiet: true });
  const envelope = objectFromCli(raw);
  if (!envelope.ok) throw new Error(envelope.error?.message ?? 'Emulator smoke failed');
  const result = envelope.data.result;
  if (!result.checks?.length || result.checks.some((check) => !check.pass)) throw new Error('Emulator smoke did not pass all checks');

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`IWER functional checks passed: ${result.checks.map((check) => check.id).join(', ')}`);
  console.log(`Measured ${result.frameTiming.sampleCount} emulator frames over ${result.frameTiming.sampleSeconds}s; average=${result.frameTiming.meanFps} fps, p95=${result.frameTiming.p95Ms}ms. Emulator-only; not a Quest benchmark.`);
  console.log(`Evidence written to ${output}`);
} catch (error) {
  console.error(`IWER smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
