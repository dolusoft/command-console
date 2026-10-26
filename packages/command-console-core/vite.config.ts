import { resolve } from 'node:path'

import { defineConfig } from 'vite'

import pkg from './package.json' with { type: 'json' }

// The protocol is a dependency: the consumer's bundler resolves and
// deduplicates it, the build carries only our code. One entry: the optional
// features are separate exports, so a consumer that does not import one does
// not ship it (`sideEffects: false`, ADR 0002).
const externalPackages = Object.keys(pkg.dependencies)
const external = (id: string) =>
  externalPackages.some(name => id === name || id.startsWith(`${name}/`))

export default defineConfig({
  build: {
    // Not minified on purpose: the consumer's bundler minifies the app.
    minify: false,
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: {
        'command-console-core': resolve(import.meta.dirname, 'src/index.ts')
      },
      formats: ['es']
    },
    rollupOptions: { external }
  }
})
