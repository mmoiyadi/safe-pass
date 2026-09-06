import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom does not implement SubtleCrypto; node's webcrypto is exposed via
    // globalThis.crypto in Node 22, which is what the crypto tests exercise.
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
  },
});
