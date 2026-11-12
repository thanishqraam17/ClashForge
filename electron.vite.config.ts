import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Sandboxed preloads must be CommonJS; package.json "type": "module"
        // would otherwise emit index.mjs, which a sandboxed renderer cannot load.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer'),
        '@domain': resolve('src/domain')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
