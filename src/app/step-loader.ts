/**
 * Browser side of STEP import: fetch the OpenCascade reader (about 7.6 MB of
 * WebAssembly) only when the first file is opened, then read files with it.
 */

import { layFlat, Occt, readStep, ImportedMesh } from '../engine/step-import.js';

let reader: Promise<Occt> | null = null;

async function load(): Promise<Occt> {
  const [{ default: factory }, { default: wasmUrl }] = await Promise.all([
    import('occt-import-js') as Promise<{ default: (opts: { locateFile: () => string }) => Promise<Occt> }>,
    import('occt-import-js/dist/occt-import-js.wasm?url') as Promise<{ default: string }>,
  ]);
  return factory({ locateFile: () => wasmUrl });
}

/** Read a STEP file and lay it flat (smallest extent up, long side along X). */
export async function importStepFile(file: File): Promise<ImportedMesh> {
  reader ??= load();
  const occt = await reader;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return layFlat(readStep(occt, bytes, file.name.replace(/\.(step|stp)$/iu, '')));
}
