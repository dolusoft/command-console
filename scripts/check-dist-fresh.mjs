// `check:package`, `check:no-css-leak` and `api:check` read the `dist/` of
// every package, they do not build it. Fails when a package's main entry is
// missing or older than a file in its `src/` (specs never reach `dist`, so
// they do not count).
//
//   node scripts/check-dist-fresh.mjs   (after `pnpm build`)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

const walk = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? walk(join(dir, item.name)) : [join(dir, item.name)]
  )

const problems = []
const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => join('packages', entry.name))

for (const dir of packages) {
  const manifest = JSON.parse(
    readFileSync(join(root, dir, 'package.json'), 'utf8')
  )
  const entry = join(dir, manifest.main)
  let built
  try {
    built = statSync(join(root, entry)).mtimeMs
  } catch {
    problems.push(`${entry} is missing`)
    continue
  }
  const newer = walk(join(root, dir, 'src')).filter(
    file => !/\.spec\.ts$/.test(file) && statSync(file).mtimeMs > built
  )
  if (newer.length > 0) {
    problems.push(
      `${entry} is older than ${newer.length} file(s) in ${dir}/src (${newer
        .slice(0, 3)
        .map(file => file.slice(root.length + 1))
        .join(', ')})`
    )
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`check-dist-fresh: ${problem}`)
  }
  console.error('check-dist-fresh: run pnpm build first.')
  process.exit(1)
}
