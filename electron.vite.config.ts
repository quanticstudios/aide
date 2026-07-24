import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const updateHealthEndpoint = process.env.AIDE_UPDATE_HEALTH_ENDPOINT ?? ''

export default defineConfig({
  main: {
    define: {
      __AIDE_UPDATE_HEALTH_ENDPOINT__: JSON.stringify(updateHealthEndpoint),
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      rollupOptions: {
        output: {
          chunkFileNames: '[name]-[hash].js',
          entryFileNames: '[name].js',
          format: 'cjs',
        },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(root, 'src/renderer/src'),
      },
    },
    plugins: [tailwindcss(), react()],
  },
})
