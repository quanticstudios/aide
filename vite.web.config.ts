import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

/** The browser build pitwall's daemon serves to a browser or a paired phone ([web] bundle = "<aide>/out/web"). */
export default defineConfig({
  root: resolve(root, 'src/renderer/web'),
  // why: the phone page serves the bundle at /app/, so every URL in it is relative.
  base: './',
  build: {
    emptyOutDir: true,
    minify: 'esbuild',
    outDir: resolve(root, 'out/web'),
  },
  resolve: {
    alias: {
      '@': resolve(root, 'src/renderer/src'),
      '@git-diff-view/lowlight': resolve(
        root,
        'src/renderer/src/lib/git-diff-view-lowlight.ts',
      ),
    },
  },
  plugins: [tailwindcss(), react()],
})
