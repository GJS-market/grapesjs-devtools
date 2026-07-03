import { defineConfig } from 'vite';

// Demo-site build (app mode) — distinct from the library build in vite.config.ts.
// Builds the toggle demo in `demo/` into `dist-site/` for Netlify to publish.
// GrapesJS and the plugin source are bundled normally (not externalised).
export default defineConfig({
  root: 'demo',
  build: {
    outDir: '../dist-site',
    emptyOutDir: true,
    sourcemap: false,
  },
});
