/**
 * The handful of long-lived objects every system needs. There is one world,
 * so a typed module-level record is simpler and safer than `world.globals`.
 * It is filled in src/index.ts before any system is registered.
 */

import type { Entity, World } from '@iwsdk/core';
import type { App } from './app.js';
import type { Bench } from './bench.js';
import type { CoDesign } from './codesign.js';
import type { Hands } from './hands.js';
import type { Sfx } from './sfx.js';
import type { Voice } from './voice.js';

export interface Context {
  world: World;
  app: App;
  bench: Bench;
  hands: Hands;
  sfx: Sfx;
  codesign: CoDesign;
  voice: Voice;
  /** Listen for one spoken command, run it, and speak the reply. */
  talk: () => Promise<void>;
  benchEntity: Entity;
  turntableEntity: Entity;
}

export const ctx = {} as Context;

/**
 * Rendering quality chosen by the frame-rate governor (src/systems/perf-system.ts).
 * 0 is full quality; higher levels shed optional work so the headset holds its frame rate.
 */
export const quality = { level: 0 };

/** Live values for automated checks and the browser console; never read by the app. */
export const probe: Record<string, unknown> = {};
