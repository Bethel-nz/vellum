import { defineConfig } from 'vite-plus'

export default defineConfig({
  build: {
    outDir: 'dist', emptyOutDir: true, sourcemap: true,
    rolldownOptions: { input: { popup: 'popup.html', background: 'src/background.ts' }, output: { entryFileNames: '[name].js' } },
  },
})
