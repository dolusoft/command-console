import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// PRINCIPLES.md P11: the protocol depends on nothing, the core on the
// protocol, the Vue package on both with `vue` as its only peer. P9: the
// three are versioned together. C-49: ESM only, own types, README.md and
// LICENSE.md in every tarball. The root is a private workspace that
// publishes nothing.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...path: string[]) =>
  JSON.parse(readFileSync(join(root, ...path), 'utf8')) as Record<
    string,
    unknown
  >
const workspace = read('package.json')

/** The unreleased 0.0.0 until the first release, then 1.x (ADR 0009). */
const versionPattern = /^(0\.0\.0|1\.\d+\.\d+)$/

describe('workspace root manifest', () => {
  it('is private and publishes nothing', () => {
    expect(workspace.private).toBe(true)
    expect(workspace.files).toBeUndefined()
    expect(workspace.exports).toBeUndefined()
    expect(workspace.main).toBeUndefined()
  })

  it('has no runtime or peer dependencies', () => {
    expect(workspace.dependencies ?? {}).toEqual({})
    expect(workspace.peerDependencies ?? {}).toEqual({})
  })

  it('declares the Node ranges and the pnpm version', () => {
    expect(workspace.engines).toEqual({ node: '>=22.18' })
    expect(workspace.devEngines).toEqual({
      runtime: { name: 'node', version: '>=24', onFail: 'error' }
    })
    expect(workspace.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/)
  })

  it('has a version of the release line', () => {
    expect(workspace.version).toMatch(versionPattern)
  })
})

const packages = [
  {
    dir: 'command-protocol',
    name: '@dolusoft/command-protocol',
    entry: 'command-protocol.js',
    dependencies: {},
    peers: {}
  },
  {
    dir: 'command-console-core',
    name: '@dolusoft/command-console-core',
    entry: 'command-console-core.js',
    dependencies: { '@dolusoft/command-protocol': 'workspace:*' },
    peers: {}
  },
  {
    dir: 'command-console',
    name: '@dolusoft/command-console',
    entry: 'command-console.js',
    dependencies: {
      '@dolusoft/command-protocol': 'workspace:*',
      '@dolusoft/command-console-core': 'workspace:*'
    },
    peers: { vue: '^3.5.0' }
  }
]

describe.each(packages)(
  'C-49 Packaging: $name manifest',
  ({ dir, name, entry, dependencies, peers }) => {
    const pkg = read('packages', dir, 'package.json')

    it('has its name and the version of the workspace', () => {
      expect(pkg.name).toBe(name)
      expect(pkg.private).toBe(false)
      expect(pkg.version).toMatch(versionPattern)
      expect(pkg.version).toBe(workspace.version)
    })

    it('depends on the allowed packages only, vue as a peer of the Vue package alone', () => {
      expect(pkg.dependencies ?? {}).toEqual(dependencies)
      expect(pkg.peerDependencies ?? {}).toEqual(peers)
      expect(pkg.optionalDependencies ?? {}).toEqual({})
      expect(pkg.bundleDependencies ?? []).toEqual([])
    })

    it('publishes dist, its README and its license, ESM only, without side effects', () => {
      expect(pkg.files).toEqual(['dist', 'README.md', 'LICENSE.md'])
      for (const file of ['README.md', 'LICENSE.md']) {
        expect(existsSync(join(root, 'packages', dir, file)), file).toBe(true)
      }
      expect(pkg.type).toBe('module')
      expect(pkg.sideEffects).toBe(false)
      expect(pkg.license).toBe('MIT')
      expect(pkg.engines).toEqual({ node: '>=22.18' })
      expect(JSON.stringify(pkg)).not.toMatch(/\.c?cjs|\.d\.cts|"require"/)
    })

    it('exports one entry into dist, with its types', () => {
      expect(pkg.exports).toEqual({
        '.': {
          types: './dist/types/index.d.ts',
          default: `./dist/${entry}`
        }
      })
      expect(pkg.main).toBe(`./dist/${entry}`)
      expect(pkg.types).toBe('./dist/types/index.d.ts')
    })

    it('points its repository at its own directory', () => {
      expect(pkg.repository).toEqual({
        type: 'git',
        url: 'git+https://github.com/dolusoft/command-console.git',
        directory: `packages/${dir}`
      })
    })
  }
)

describe('README install lines', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  const installs = [
    ...readme.matchAll(/^pnpm add @dolusoft\/command-console@(\S+)$/gm)
  ]

  // The README gets its install line with the first release; until then the
  // version is the unreleased 0.0.0 and there is nothing to install.
  it('installs the Vue package at the version of the workspace', () => {
    expect(installs.map(([, version]) => version)).toEqual(
      workspace.version === '0.0.0' ? [] : [workspace.version]
    )
  })

  it('contains no GitHub Release download URL', () => {
    expect(readme).not.toContain('releases/download')
  })
})
