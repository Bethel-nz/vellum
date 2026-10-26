import { defineConfig } from 'vite-plus'

export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist', emptyOutDir: false, sourcemap: true, minify: true,
    lib: { entry: 'src/content.ts', name: 'VellumCapture', formats: ['iife'], fileName: () => 'content.js' },
  },
})
