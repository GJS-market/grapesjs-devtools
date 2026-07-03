import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import dts from 'vite-plugin-dts';

// Library build: emits ESM + UMD, keeps GrapesJS external (it is a peer dependency).
export default defineConfig({
  plugins: [
    dts({
      include: ['src'],
      rollupTypes: true,
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'grapesjsDevtools',
      fileName: (format) =>
        format === 'umd' ? 'grapesjs-devtools.umd.cjs' : 'grapesjs-devtools.js',
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      external: ['grapesjs'],
      output: {
        globals: { grapesjs: 'grapesjs' },
        assetFileNames: 'grapesjs-devtools.[ext]',
      },
    },
    sourcemap: true,
    cssCodeSplit: false,
  },
});
