// `pnpm measure:package-size`: how much an application that imports the
// protocol or the core ships (P8). Builds each fixture of
// tests/fixtures/packages into a minified app against the built `dist/` of
// the packages, through their `exports` maps, and subtracts the empty
// baseline app. Writes node_modules/.cache/measure/package-size.json. Run
// after `pnpm build`.
//
// `--check` (CI) compares each gzip cost with scripts/package-size-budget.json
// and exits 1 when one is over its budget or a budget is over the ceiling of
// its fixture.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'

import { buildFixture } from './fixture-build.mjs'
import { checkBudget, printCosts } from './size-budget.mjs'

const root = join(import.meta.dirname, '..')

const buildApp = async name => {
  const code = (await buildFixture(name)).map(chunk => chunk.code).join('\n')
  return {
    bytes: Buffer.byteLength(code),
    gzipBytes: gzipSync(code).length,
    brotliBytes: brotliCompressSync(code).length
  }
}

/** The protocol, the core with its core features, the core with all. */
const names = ['protocol', 'core', 'core-all']
const empty = await buildApp('empty')
const costs = {}
for (const name of names) {
  const app = await buildApp(name)
  costs[name] = {
    bytes: app.bytes - empty.bytes,
    gzipBytes: app.gzipBytes - empty.gzipBytes,
    brotliBytes: app.brotliBytes - empty.brotliBytes
  }
}

const outDir = join(root, 'node_modules', '.cache', 'measure')
mkdirSync(outDir, { recursive: true })
const file = join(outDir, 'package-size.json')
writeFileSync(
  file,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      note: 'minified app builds; each cost is the fixture minus tests/fixtures/packages/empty.ts',
      empty,
      costs
    },
    null,
    2
  )}\n`
)
printCosts('package-size', file, Object.entries(costs))

if (
  process.argv.includes('--check') &&
  !checkBudget({
    tag: 'package-size',
    budgetFile: join(root, 'scripts', 'package-size-budget.json'),
    names,
    costs
  })
) {
  process.exit(1)
}
