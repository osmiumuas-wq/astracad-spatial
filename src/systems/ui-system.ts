/**
 * Dispatches spatial button presses and hover states. Works for every input
 * IWSDK routes to RayInteractable / PokeInteractable: hand rays, fingertip
 * pokes, gaze and pinch, controllers and the mouse.
 *
 * Accessibility: with "dwell" on, resting a ray or gaze on a button for
 * 1.2 s presses it, for users who cannot pinch.
 */

import { createSystem, Hovered, Pressed } from '@iwsdk/core';
import { UiButton } from '../components.js';
import { ctx } from '../app/context.js';
import { buttonHover, buttonPressed } from '../app/ui3d.js';

const DWELL_S = 1.2;

export class UiSystem extends createSystem({
  pressed: { required: [UiButton, Pressed] },
  hovered: { required: [UiButton, Hovered] },
}) {
  private dwellKey = '';
  private dwellTime = 0;
  private dwellFired = false;

  init(): void {
    this.queries.pressed.subscribe('qualify', (entity) => {
      ctx.sfx.resume();
      buttonPressed(entity.getValue(UiButton, 'key') as string);
    });
    this.queries.hovered.subscribe('qualify', (entity) => {
      buttonHover(entity.getValue(UiButton, 'key') as string, true);
    });
    this.queries.hovered.subscribe('disqualify', (entity) => {
      buttonHover(entity.getValue(UiButton, 'key') as string, false);
    });
  }

  update(delta: number): void {
    if (!ctx.app.settings.peek().dwell) {
      return;
    }
    let key = '';
    for (const e of this.queries.hovered.entities) {
      key = e.getValue(UiButton, 'key') as string;
      break;
    }
    if (key !== this.dwellKey) {
      this.dwellKey = key;
      this.dwellTime = 0;
      this.dwellFired = false;
      return;
    }
    if (!key || this.dwellFired) {
      return;
    }
    this.dwellTime += delta;
    if (this.dwellTime >= DWELL_S) {
      this.dwellFired = true;
      buttonPressed(key);
    }
  }
}
