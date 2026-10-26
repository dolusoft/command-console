// `pnpm check:deps` (CI): the dependency allow-list of every package (P11,
// ADR 0001). Each package may depend on exactly the packages listed below,
// at an exact version or the workspace, and its source and built files may
// import nothing else. A new dependency is a change to this list, which is
// a fence file (CODEOWNERS).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { specifiersOf } from './specifiers.mjs'

const root = join(import.meta.dirname, '..')

/** Allowed runtime dependencies and peers, per package directory. */
const allowed = {
  '.': { dependencies: {}, peerDependencies: {} },
  'packages/command-protocol': { dependencies: {}, peerDependencies: {} },
  'packages/command-console-core': {
    dependencies: { '@dolusoft/command-protocol': 'workspace:*' },
    peerDependencies: {}
  },
  'packages/command-console': {
    dependencies: {
      '@dolusoft/command-protocol': 'workspace:*',
      '@dolusoft/command-console-core': 'workspace:*'
    },
    peerDependencies: { vue: '^3.5.0' }
  }
}

const problems = []

const workspaces = readdirSync(join(root, 'packages'), {
  withFileTypes: true
})
  .filter(entry => entry.isDirectory())
  .map(entry => `packages/${entry.name}`)
for (const dir of workspaces) {
  if (!(dir in allowed)) {
    problems.push(`${dir} is not in the allow-list of scripts/check-deps.mjs`)
  }
}

const sourceFiles = dir => {
  const files = []
  const walk = path => {
    if (!existsSync(path)) {
      return
    }
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'types') {
          walk(child)
        }
      } else if (
        /\.(ts|vue|js)$/.test(entry.name) &&
        !/\.spec\./.test(entry.name)
      ) {
        files.push(child)
      }
    }
  }
  walk(join(dir, 'src'))
  walk(join(dir, 'dist'))
  return files
}

const packageOf = specifier => {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

for (const [dir, allow] of Object.entries(allowed)) {
  const base = join(root, dir)
  const manifest = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'))
  for (const field of ['dependencies', 'peerDependencies']) {
    const actual = manifest[field] ?? {}
    const expected = allow[field]
    for (const [name, version] of Object.entries(actual)) {
      if (!(name in expected)) {
        problems.push(`${dir}: ${field} has ${name}, which is not allowed`)
      } else if (version !== expected[name]) {
        problems.push(
          `${dir}: ${field}.${name} is ${version}, the allow-list says ${expected[name]}`
        )
      }
    }
    for (const name of Object.keys(expected)) {
      if (!(name in actual)) {
        problems.push(`${dir}: ${field} misses ${name}`)
      }
    }
  }
  for (const field of ['optionalDependencies', 'bundleDependencies']) {
    if (Object.keys(manifest[field] ?? {}).length > 0) {
      problems.push(`${dir}: ${field} must be empty`)
    }
  }
  if (dir === '.') {
    continue
  }
  const imports = new Set([
    ...Object.keys(allow.dependencies),
    ...Object.keys(allow.peerDependencies)
  ])
  for (const file of sourceFiles(base)) {
    const code = readFileSync(file, 'utf8')
    for (const specifier of specifiersOf(code)) {
      if (specifier.startsWith('node:')) {
        problems.push(`${relative(root, file)} imports ${specifier}`)
      } else if (!imports.has(packageOf(specifier))) {
        problems.push(
          `${relative(root, file)} imports ${specifier}, which is not a dependency of ${dir}`
        )
      }
    }
  }
}

if (problems.length > 0) {
  console.error('[check:deps] the dependency allow-list is broken:')
  for (const problem of problems) {
    console.error(`  - ${problem}`)
  }
  process.exit(1)
}
console.log(
  `[check:deps] ${Object.keys(allowed).length} packages match the allow-list`
)
