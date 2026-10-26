// `pnpm measure:consumer-size`: how much a Vue application that uses
// `@dolusoft/command-console` ships (P8). Builds minified apps from
// tests/fixtures/consumer against the built `dist/` of the three packages
// (through their `exports` maps) and subtracts the same app without the
// console (`vue-only`): what is left is the Vue package with the core and
// the protocol, Vue excluded. Two fixtures: `composable`
// (`useCommandConsole()` with the consumer's own markup) and `component`
// (`CommandConsole`). Writes node_modules/.cache/measure/consumer-size.json.
// Run after `pnpm build` (the package script does).
//
// `--check` (CI) compares each gzip cost with
// scripts/consumer-size-budget.json and exits 1 when one is over its budget
// or a budget is over the ceiling of its fixture.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'

import { buildFixture } from './fixture-build.mjs'
import { checkBudget, printCosts } from './size-budget.mjs'

const root = join(import.meta.dirname, '..')

const buildApp = async name => {
  const chunks = await buildFixture(name, 'consumer')
  const code = chunks.map(chunk => chunk.code).join('\n')
  // Where the bytes come from: rendered size per package, before minifying.
  const sources = {}
  for (const chunk of chunks) {
    for (const [id, module] of Object.entries(chunk.modules)) {
      const path = id.replaceAll('\\', '/')
      const workspace = /\/packages\/([^/]+)\/dist\//.exec(path)
      const dependency =
        /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\//.exec(
          path
        )
      const source = workspace
        ? `packages/${workspace[1]}`
        : (dependency?.[1] ?? 'fixture')
      sources[source] = (sources[source] ?? 0) + module.renderedLength
    }
  }
  return {
    bytes: Buffer.byteLength(code),
    gzipBytes: gzipSync(code).length,
    brotliBytes: brotliCompressSync(code).length,
    renderedBySource: sources
  }
}

const names = ['composable', 'component']
const baseline = await buildApp('vue-only')
const apps = {}
const costs = {}
for (const name of names) {
  const app = await buildApp(name)
  apps[name] = app
  costs[name] = {
    bytes: app.bytes - baseline.bytes,
    gzipBytes: app.gzipBytes - baseline.gzipBytes,
    brotliBytes: app.brotliBytes - baseline.brotliBytes
  }
}

const version = path =>
  JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8')).version

const outDir = join(root, 'node_modules', '.cache', 'measure')
mkdirSync(outDir, { recursive: true })
const file = join(outDir, 'consumer-size.json')
writeFileSync(
  file,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      versions: {
        package: version('packages/command-console'),
        vue: version('node_modules/vue'),
        vite: version('node_modules/vite')
      },
      note: 'minified app builds (Vue bundled); each cost is the fixture minus vue-only',
      vueOnly: baseline,
      apps,
      costs
    },
    null,
    2
  )}\n`
)
printCosts('consumer-size', file, [
  ['vue only', baseline],
  ...Object.entries(costs)
])

if (
  process.argv.includes('--check') &&
  !checkBudget({
    tag: 'consumer-size',
    budgetFile: join(root, 'scripts', 'consumer-size-budget.json'),
    names,
    costs
  })
) {
  process.exit(1)
}
