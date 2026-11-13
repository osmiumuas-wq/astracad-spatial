/**
 * Component catalog, shared by the runtime and the IWSDK editor.
 * Declarations only: no systems, DOM or renderer imports.
 */

import { createComponent, defineComponents, Types } from '@iwsdk/core';

/** A spatial button; the UI system looks up its action by `key`. */
export const UiButton = createComponent('UiButton', {
  key: { type: Types.String, default: '' },
});

export default defineComponents([UiButton]);
