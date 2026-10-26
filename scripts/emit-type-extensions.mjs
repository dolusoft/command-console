// Post-processes emitted declarations so they resolve under Node's ESM
// module mode (checked by `attw --profile esm-only`).
//
//   node scripts/emit-type-extensions.mjs [types dir]
//
// The types dir defaults to dist/types of the 2.2 package; the v3 packages
// pass their own. tsc and vue-tsc write relative imports the way the
// sources spell them (`../core/query`, `./query-table.vue`, `../../shared`).
// Node16 ESM requires explicit extensions, and TypeScript resolves
// `./query-table.vue` to `query-table.d.vue.ts` rather than the emitted
// `query-table.vue.d.ts`. Every relative specifier therefore gets a `.js`
// suffix, which TypeScript maps back to the matching .d.ts, and a specifier
// that names a directory gets `/index.js`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const typesDir = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../dist/types', import.meta.url))

const walk = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )

const withExtension = (source, file) =>
  source.replace(
    /(from\s+|import\(|import\s+)(['"])(\.[^'"]*)\2/g,
    (_, lead, quote, specifier) => {
      const base = specifier.replace(/\.(c|m)?js$/, '')
      const target = resolve(dirname(file), base)
      const isDirectory =
        !existsSync(`${target}.d.ts`) && existsSync(join(target, 'index.d.ts'))
      return `${lead}${quote}${base}${isDirectory ? '/index' : ''}.js${quote}`
    }
  )

let emitted = 0
for (const file of walk(typesDir).filter(f => f.endsWith('.d.ts'))) {
  writeFileSync(file, withExtension(readFileSync(file, 'utf8'), file))
  emitted += 1
}
console.log(`post-processed ${emitted} declaration files`)
