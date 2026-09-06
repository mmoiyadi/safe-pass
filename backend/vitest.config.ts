import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Testcontainers pulls a real PostgreSQL 17; first run is slow.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    sequence: { concurrent: false },
  },
});
