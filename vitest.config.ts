import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // Explicit inclusion also collects source files never imported by tests.
      include: ['src/**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}'],
      exclude: ['src/**/*.{test,spec}.*', 'src/**/__tests__/**', 'src/**/*.d.{ts,mts,cts}'],
    },
  },
});
