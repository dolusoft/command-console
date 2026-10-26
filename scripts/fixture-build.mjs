// Builds a fixture of tests/fixtures/<directory> into a minified app against
// the built `dist/` of the three packages, the way a consumer's bundler does:
// each specifier resolves through the `default` target of the package's
// `exports`. Used by `scripts/package-size.mjs` (tests/fixtures/packages) and
// `scripts/consumer-size.mjs` (tests/fixtures/consumer). Run after
// `pnpm build`.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { build } from 'vite'

const root = join(import.meta.dirname, '..')

/** The packages the fixtures import, by name. */
export const fixturePackages = {
  '@dolusoft/command-protocol': join(root, 'packages', 'command-protocol'),
  '@dolusoft/command-console-core': join(
    root,
    'packages',
    'command-console-core'
  ),
  '@dolusoft/command-console': join(root, 'packages', 'command-console')
}

// Each import specifier the fixtures may use, resolved through the `default`
// target of the package's `exports`.
const alias = []
for (const [name, dir] of Object.entries(fixturePackages)) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const file = typeof target === 'string' ? target : target.default
    if (!file.endsWith('.js')) {
      continue
    }
    const path = join(dir, file)
    if (!existsSync(path)) {
      console.error(
        `[fixture-build] ${path} is missing: run \`pnpm build\` first`
      )
      process.exit(1)
    }
    const specifier = subpath === '.' ? name : `${name}/${subpath.slice(2)}`
    alias.push({
      find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      replacement: path
    })
  }
}

/**
 * The output chunks of the minified app built from
 * tests/fixtures/<directory>/<name>.ts.
 */
export const buildFixture = async (name, directory = 'packages') => {
  const result = await build({
    root,
    configFile: false,
    logLevel: 'warn',
    resolve: { alias },
    build: {
      write: false,
      minify: true,
      rolldownOptions: {
        input: join(root, 'tests', 'fixtures', directory, `${name}.ts`)
      }
    }
  })
  return (Array.isArray(result) ? result : [result])
    .flatMap(entry => entry.output)
    .filter(file => file.type === 'chunk')
}
