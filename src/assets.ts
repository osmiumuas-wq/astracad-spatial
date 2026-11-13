/**
 * Asset manifest, shared by the runtime and the IWSDK editor. It must stay
 * deterministic and free of side effects. This app loads no asset files:
 * geometry comes from the engine and panels are drawn at run time.
 */

import { defineAssets } from '@iwsdk/core';

export default defineAssets({});
