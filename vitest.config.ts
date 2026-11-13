import { defineConfig } from 'vitest/config';

// Engine tests run in Node, without the IWSDK dev plugin.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120000,
  },
});
