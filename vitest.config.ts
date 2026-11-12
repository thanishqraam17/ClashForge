import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Same aliases as the renderer build (electron.vite.config.ts).
  resolve: {
    alias: {
      '@': resolve('src/renderer'),
      '@domain': resolve('src/domain')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}']
  }
})
