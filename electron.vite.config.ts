import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const updateHealthEndpoint = process.env.AIDE_UPDATE_HEALTH_ENDPOINT ?? ''
const updateOrigin = process.env.AIDE_UPDATE_ORIGIN ?? ''
const releaseKeyId = process.env.AIDE_RELEASE_KEY_ID ?? ''
const releasePublicKeyPem = process.env.AIDE_RELEASE_PUBLIC_KEY_PEM ?? ''
const otaDrillBuild = process.env.AIDE_OTA_DRILL_BUILD === '1' ? '1' : ''

export default defineConfig({
  main: {
    define: {
      __AIDE_UPDATE_HEALTH_ENDPOINT__: JSON.stringify(updateHealthEndpoint),
      __AIDE_UPDATE_ORIGIN__: JSON.stringify(updateOrigin),
      __AIDE_RELEASE_KEY_ID__: JSON.stringify(releaseKeyId),
      __AIDE_RELEASE_PUBLIC_KEY_PEM__: JSON.stringify(releasePublicKeyPem),
      __AIDE_OTA_DRILL_BUILD__: JSON.stringify(otaDrillBuild),
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
    build: { minify: 'esbuild' },
    resolve: {
      alias: {
        '@': resolve(root, 'src/renderer/src'),
      },
    },
    plugins: [tailwindcss(), react()],
  },
})
