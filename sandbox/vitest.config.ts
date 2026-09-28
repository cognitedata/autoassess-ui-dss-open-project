import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // No React plugin: esbuild compiles JSX via tsconfig ("jsx": "react-jsx"), and vitest 2's
  // bundled Vite 5 plugin types clash with the app's Vite 7.
  // Pin the root: this app lives inside another Vite project and must not resolve against it.
  root: __dirname,
  test: {
    globals: true,
    environment: 'happy-dom',
    // Absolute path: a relative one resolves against the parent repo root and loads its setup.
    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')],
    include: ['src/**/*.test.{ts,tsx}'],
    // Pyodide integration tests boot a real CPython-in-wasm (~1-2 s per file).
    testTimeout: 30_000,
  },
});
