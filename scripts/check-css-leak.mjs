// The CSS leak scan (P5): no package ships styles in any form, not only as
// a `.css` file (scripts/check-no-css.mjs). Every file of each package's
// `dist/` and of its tarball is searched for the marks of a stylesheet or an
// animation written by script: a keyframes block, a style element, a rule
// inserted into a sheet, a constructed sheet and a Web Animations call. The
// look of the console lives in the consumer's skin (P5, P13).
//
//   node scripts/check-css-leak.mjs   (after `pnpm build`; `pnpm
//   check:no-css-leak` checks first that dist/ is fresh)
//
// tests/repo/no-css-leak.spec.ts checks the marks on sample text.
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The marks of a stylesheet or a scripted animation; the name is reported. */
const marks = [
  ['@keyframes', /@keyframes/i],
  ['<style', /<style[\s>]/i],
  ['insertRule', /\binsertRule\b/],
  ['adoptedStyleSheets', /\badoptedStyleSheets\b/],
  ['CSSStyleSheet', /\bCSSStyleSheet\b/],
  ['.animate(', /\.animate\s*\(/]
]

/** The marks found in `text`. */
export const leaksIn = text =>
  marks.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)

const walk = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )

/** The files `npm pack` would put in the tarball of the package in `dir`. */
const tarballFiles = dir => {
  const output = JSON.parse(
    execSync('npm pack --dry-run --json --ignore-scripts', {
      cwd: dir,
      encoding: 'utf8'
    })
  )
  // npm 10 prints an array, npm 11 an object keyed by package name.
  const packed = Array.isArray(output) ? output[0] : Object.values(output)[0]
  return packed.files.map(file => join(dir, file.path))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(import.meta.dirname, '..')
  const rel = path => relative(root, path).split(sep).join('/')
  const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(root, 'packages', entry.name))
  const leaks = []
  let checked = 0
  for (const dir of packages) {
    const dist = join(dir, 'dist')
    if (!existsSync(dist)) {
      console.error(`[check-css-leak] ${rel(dist)} is missing: run pnpm build`)
      process.exit(1)
    }
    const files = new Set([...walk(dist), ...tarballFiles(dir)])
    for (const file of files) {
      if (/\.(png|jpe?g|gif|webp|ico|woff2?)$/i.test(file)) {
        continue
      }
      checked++
      for (const mark of leaksIn(readFileSync(file, 'utf8'))) {
        leaks.push(`${rel(file)}: ${mark}`)
      }
    }
  }
  if (leaks.length > 0) {
    console.error(
      `[check-css-leak] the packages must write no styles, but contain:\n  ${leaks.join('\n  ')}`
    )
    process.exit(1)
  }
  console.log(
    `[check-css-leak] no stylesheet or scripted animation in dist or in the tarballs (${packages.length} packages, ${checked} files)`
  )
}
