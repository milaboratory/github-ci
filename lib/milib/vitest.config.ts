import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    watch: false,
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
})
