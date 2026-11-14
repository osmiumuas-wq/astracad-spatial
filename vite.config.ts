/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';
import { serviceWorker } from './scripts/sw-plugin.mjs';

export default defineConfig({
  // HTTPS by default (a headset on Wi-Fi needs it). scripts/dev-http.mjs sets
  // ASTRA_DEV_HTTP for localhost previews, where plain HTTP is a secure context.
  plugins: [iwsdkDev({ https: process.env.ASTRA_DEV_HTTP === '1' ? false : undefined }), serviceWorker()],
  worker: { format: 'es' },
  // Evidence files written during emulator runs must not reload the page (that ends the XR session).
  server: { host: '0.0.0.0', port: 8081, open: false, watch: { ignored: ['**/artifacts/**', '**/exchange/**', '**/dist/**'] } },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
