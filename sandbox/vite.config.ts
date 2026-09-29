import { createReadStream, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildHostedAppContentSecurityPolicy,
  fusionOpenPlugin,
  getManifestNetworkRules,
  loadManifestConfig,
  manifestCspPlugin,
  mkcertPlugin,
} from '@cognite/app-sdk/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';


/**
 * Pyodide runtime files served from the app's own origin (never a CDN): the Flows CSP only
 * allows same-origin scripts, so pyodide.asm.mjs / .wasm / stdlib must ship with the app.
 */

// The standard library (python_stdlib.zip) is not served: App Hosting refuses archives, so the
// worker embeds it (src/python/embeddedStdlib.ts).
const PYODIDE_FILES = ['pyodide.asm.mjs', 'pyodide.asm.wasm', 'pyodide-lock.json'] as const;
const PYODIDE_DIR = path.resolve(__dirname, 'node_modules/pyodide');

const CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

function pyodideAssetsPlugin(): Plugin {
  return {
    name: 'sandbox-pyodide-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /\/pyodide\/([^/?#]+)/.exec(req.url ?? '');
        const file = match?.[1];
        if (!file || !(PYODIDE_FILES as readonly string[]).includes(file)) return next();
        res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream');
        createReadStream(path.join(PYODIDE_DIR, file)).pipe(res);
      });
    },
    generateBundle() {
      for (const file of PYODIDE_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `pyodide/${file}`,
          source: readFileSync(path.join(PYODIDE_DIR, file)),
        });
      }
    },
  };
}

/**
 * `vite preview` serves the production build with the *production* Flows CSP (no dev
 * relaxations), so CSP problems show up locally before deploying.
 */
function productionCspPreviewPlugin(): Plugin {
  return {
    name: 'sandbox-production-csp-preview',
    configurePreviewServer(server) {
      const rules = getManifestNetworkRules(loadManifestConfig(__dirname));
      const csp = buildHostedAppContentSecurityPolicy(false, rules);
      // On every response, not just HTML: a module worker gets its CSP from its *own* script
      // response, so this also checks Pyodide inside the worker under the strictest assumption.
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Content-Security-Policy', csp);
        next();
      });
    },
  };
}

// `npm run dev` = plain http://localhost:3010 (demo mode, no browser pop-up).
// `npm run dev:fusion` = HTTPS + open the Fusion development URL (live mode inside Fusion).
const fusionDev = process.env.SANDBOX_FUSION === '1';

export default defineConfig({
  base: './',
  // manifestCspPlugin() must be first — its middleware sets the CSP header before any HTML response.
  // Dev-only: in a build it would inline its CSP-reporter <script> into index.html, which the
  // production CSP (script-src 'self', no 'unsafe-inline') blocks anyway.
  plugins: [
    { ...manifestCspPlugin(), apply: 'serve' },
    react(),
    ...(fusionDev ? [mkcertPlugin(), fusionOpenPlugin()] : []),
    pyodideAssetsPlugin(),
    productionCspPreviewPlugin(),
  ],
  server: { port: 3010, strictPort: true },
  preview: { port: 3011, strictPort: true },
  // Lets sandbox.worker.ts import pyodide/python_stdlib.zip?inline (see src/python/embeddedStdlib.ts).
  assetsInclude: ['**/python_stdlib.zip'],
  optimizeDeps: { exclude: ['pyodide'] },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1500 },
});
