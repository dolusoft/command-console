// No package ships CSS (contract rule C-31, P5). Fails when the build output
// or the tarball of any package contains a stylesheet.
//
//   node scripts/check-no-css.mjs   (after `pnpm build`)
import { execSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const isStyle = path => /\.(css|scss|sass|less|styl)$/i.test(path)

const walk = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )

const found = []
let checked = 0
const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => join(root, 'packages', entry.name))

for (const dir of packages) {
  const dist = join(dir, 'dist')
  for (const file of existsSync(dist) ? walk(dist) : []) {
    if (isStyle(file)) {
      found.push(`dist: ${file.slice(root.length + 1)}`)
    }
  }

  // `npm pack --dry-run` lists what a tarball would hold without writing it.
  // npm 10 prints an array, npm 11 an object keyed by package name.
  const output = JSON.parse(
    execSync('npm pack --dry-run --json --ignore-scripts', {
      cwd: dir,
      encoding: 'utf8'
    })
  )
  const packed = Array.isArray(output) ? output[0] : Object.values(output)[0]
  checked += packed.files.length
  for (const file of packed.files) {
    if (isStyle(file.path)) {
      found.push(`tarball of ${packed.name}: ${file.path}`)
    }
  }
}

if (found.length > 0) {
  console.error(
    `The packages must ship no CSS, but contain:\n  ${found.join('\n  ')}`
  )
  process.exit(1)
}
console.log(
  `no CSS in dist or in the tarballs (${packages.length} packages, ${checked} files checked)`
)
