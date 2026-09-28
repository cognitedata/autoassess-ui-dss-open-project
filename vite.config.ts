import path from 'node:path';

import { fusionOpenPlugin, manifestCspPlugin } from '@cognite/app-sdk/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  base: './',
  // manifestCspPlugin() must be first — its middleware sets the CSP header before any HTML response
  plugins: [manifestCspPlugin(), react(), mkcert(), fusionOpenPlugin(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3001,
  },
  worker: {
    format: 'es',
  },
});
