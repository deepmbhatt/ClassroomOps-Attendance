import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      VITE_DEV_AUTH_BYPASS: 'true',
    },
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts',
    include: ['src/tests/**/*.test.ts', 'src/tests/**/*.test.tsx'],
    exclude: ['src/tests/e2e/**'],
  },
})
