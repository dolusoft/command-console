import { resolve } from 'node:path'

import { defineConfig } from 'vite'

// Zero dependencies (P11): nothing is external, nothing is bundled but our
// code. ESM only.
export default defineConfig({
  build: {
    // Not minified on purpose: the consumer's bundler minifies the app.
    minify: false,
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: {
        'command-protocol': resolve(import.meta.dirname, 'src/index.ts')
      },
      formats: ['es']
    }
  }
})
