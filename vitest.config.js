import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.js', 'src/**/*.test.js', 'scripts/**/*.test.mjs'],
    exclude: ['node_modules/**', 'server/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**'],
    },
  },
});
