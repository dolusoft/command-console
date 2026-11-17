import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { RuleTester } from 'oxlint/plugins-dev'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The fences of .oxlintrc.json. The layer rule (oxlint-plugins/layers.mjs,
// P14) runs through oxlint's RuleTester on code placed at a given path;
// re-exports, dynamic imports and type imports count like imports. The bans
// of P1 (no network, no storage), of the DOM in the protocol and the core,
// and of window/document listeners in the Vue package are read from the real
// config: every sample is written at its path into a copy of the config and
// linted by the real oxlint in one run.

type Rule = Parameters<RuleTester['run']>[1]

const root = join(import.meta.dirname, '..', '..')
const { default: layers } = (await import(
  pathToFileURL(join(root, 'oxlint-plugins', 'layers.mjs')).href
)) as { default: { rules: { boundaries: Rule } } }

const tester = new RuleTester()

/**
 * Asserts the layer messages for `code` in the file at `path` (from the repo
 * root): none, or one per pattern, in order.
 */
const expectLayers = (path: string, code: string, expected: RegExp[] = []) => {
  const filename = join(root, path)
  tester.run(
    'layers/boundaries',
    layers.rules.boundaries,
    expected.length === 0
      ? { valid: [{ code, filename }], invalid: [] }
      : {
          valid: [],
          invalid: [
            {
              code,
              filename,
              errors: expected.map(message => ({ message }))
            }
          ]
        }
  )
}

const protocol = 'packages/command-protocol/src'
const core = 'packages/command-console-core/src'
const vue = 'packages/command-console/src'

describe('layers/boundaries', () => {
  it('lets the protocol import only itself', () => {
    expectLayers(`${protocol}/index.ts`, `import './syntax/tokenize'`)
    expectLayers(`${protocol}/entry.ts`, `import { h } from 'vue'`, [
      /command-protocol may import no package/
    ])
    expectLayers(
      `${protocol}/index.ts`,
      `export * from '@dolusoft/command-console-core'`,
      [/command-protocol may import no package/]
    )
  })

  it('lets the core import the protocol, nothing else', () => {
    const file = `${core}/core/dispatch/dispatchFeature.ts`
    expectLayers(
      file,
      `import { tokenize } from '@dolusoft/command-protocol'
import type { ConsoleEntry } from '@dolusoft/command-protocol'`
    )
    expectLayers(file, `import { ref } from 'vue'`, [/may import/])
    expectLayers(file, `import x from '@dolusoft/command-console'`, [
      /may import/
    ])
    expectLayers(
      file,
      `import { tokenize } from '@dolusoft/command-protocol/syntax'`,
      [/may import/]
    )
  })

  it('lets the Vue package import the protocol, the core and vue', () => {
    expectLayers(
      `${vue}/use-command-console.ts`,
      `import { shallowRef } from 'vue'
import { createConsole } from '@dolusoft/command-console-core'
import type { ConsoleEntry } from '@dolusoft/command-protocol'
import { keyInputOf } from './dom/keys'`
    )
    expectLayers(`${vue}/labels.ts`, `import { format } from 'some-library'`, [
      /command-console may import/
    ])
  })

  it('keeps one feature out of another, re-exports and dynamic imports included', () => {
    const file = `${core}/features/recall/recallFeature.ts`
    const message = /the recall feature may not import/
    for (const code of [
      `import { completionFeature } from '../completion/completionFeature'`,
      `export { completionFeature } from '../completion/completionFeature'`,
      `export * from '../context/context.types'`,
      `void import('../context/contextFeature')`,
      `import type { Session } from '../completion/completion.types'`,
      `type T = import('../completion/completion.types').Session`
    ]) {
      expectLayers(file, code, [message])
    }
  })

  it('lets a feature use shared/, the store, its own files and the protocol', () => {
    expectLayers(
      `${core}/features/completion/completionFeature.ts`,
      `import { tokenizeTolerant } from '@dolusoft/command-protocol'
import { onLineEnd } from '../../shared/hooks'
import { registerFeature } from '../../shared'
import { action } from '../../store/action'
import { commonPrefix } from './completion.utils'`
    )
  })

  it('lets a feature and shared/ import core/ for types only', () => {
    for (const code of [
      `import type { ConsoleInstance } from '../../core/console/console.types'`,
      `import { type ConsoleInstance } from '../../core/console/console.types'`,
      `export type { ConsoleInstance } from '../../core/console/console.types'`,
      `type T = import('../../core/console/console.types').ConsoleInstance`
    ]) {
      expectLayers(`${core}/features/context/contextFeature.ts`, code)
    }
    expectLayers(
      `${core}/shared/registry.ts`,
      `import type { ConsoleInstance } from '../core/console/console.types'`
    )
    expectLayers(
      `${core}/features/context/contextFeature.ts`,
      `import { constructConsole } from '../../core/console/constructConsole'`,
      [/core\/ for types only/]
    )
    expectLayers(
      `${core}/shared/registry.ts`,
      `import { constructConsole, type X } from '../core/console/constructConsole'`,
      [/shared\/ may not import/]
    )
  })

  it('keeps shared/, the store and core/ off the optional features', () => {
    const optional = /the core never depends on an optional feature/
    expectLayers(
      `${core}/shared/hooks.ts`,
      `import { recallFeature } from '../features/recall/recallFeature'`,
      [optional]
    )
    expectLayers(
      `${core}/core/input/inputFeature.ts`,
      `import type { RecallState } from '../../features/recall/recall.types'`,
      [optional]
    )
    expectLayers(
      `${core}/store/createStore.ts`,
      `import { registerFeature } from '../shared/registry'`,
      [/store\/ may not import/]
    )
    expectLayers(
      `${core}/core/input/inputFeature.ts`,
      `import { allFeatures } from '../../helpers/allFeatures'`,
      [/core\/ may not import/]
    )
  })

  it('checks require() and import = require() like imports', () => {
    const file = `${core}/features/recall/recallFeature.ts`
    expectLayers(file, `const x = require('../context/contextFeature')`, [
      /the recall feature may not import/
    ])
    expectLayers(file, `import x = require('vue')`, [
      /command-console-core may import/
    ])
    expectLayers(file, `const x = require(name)`, [
      /must name a literal module/
    ])
  })

  it('refuses import.meta.glob and a dynamic import that is not a literal', () => {
    const file = `${core}/helpers/allFeatures.ts`
    expectLayers(file, `const all = import.meta.glob('../features/*')`, [
      /import\.meta\.glob/
    ])
    expectLayers(file, `void import(name)`, [/must name a literal module/])
  })

  it('lets the helpers and the entry files gather every part of the core', () => {
    expectLayers(
      `${core}/helpers/allFeatures.ts`,
      `import { recallFeature } from '../features/recall/recallFeature'
import { completionFeature } from '../features/completion/completionFeature'
import { consoleFeature } from '../core/console/consoleFeature'`
    )
    expectLayers(
      `${core}/index.ts`,
      `export * from './features/recall/recallFeature'
export { createConsole } from './core/console/constructConsole'
export { allFeatures } from './helpers/allFeatures'`
    )
  })

  it('keeps a package from reaching into another by path', () => {
    expectLayers(
      `${core}/shared/hooks.ts`,
      `import { tokenize } from '../../../command-protocol/src'`,
      [/leaves packages\/command-console-core\/src/]
    )
  })

  it('leaves files outside packages/*/src alone', () => {
    expectLayers('tests/fixtures/consumer/x.ts', `import { ref } from 'vue'`)
  })
})

// The real .oxlintrc.json, as it applies to a file at a path. Every sample is
// registered below, written into a copy of the repository's lint setup and
// linted in one oxlint run before the tests read the results.

type Finding = { rule: string; message: string }

const samples: { path: string; code: string }[] = []
/**
 * Registers `code` at `path`; the file name gets a number so samples for one
 * path do not collide (`x.spec.ts` → `x7.spec.ts`). Returns the sample's path.
 */
const sample = (path: string, code: string) => {
  const slash = path.lastIndexOf('/')
  const dot = path.indexOf('.', slash)
  const unique = `${path.slice(0, dot)}${samples.length}${path.slice(dot)}`
  samples.push({ path: unique, code })
  return unique
}

const results = new Map<string, Finding[]>()
let workspace = ''

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'lint-fences-'))
  cpSync(join(root, '.oxlintrc.json'), join(workspace, '.oxlintrc.json'))
  cpSync(join(root, 'oxlint-plugins'), join(workspace, 'oxlint-plugins'), {
    recursive: true
  })
  for (const { path, code } of samples) {
    mkdirSync(dirname(join(workspace, path)), { recursive: true })
    writeFileSync(join(workspace, path), `${code}\n`)
  }
  let output: string
  try {
    output = execFileSync(
      process.execPath,
      [
        join(root, 'node_modules', 'oxlint', 'bin', 'oxlint'),
        '--format=json',
        '.'
      ],
      { cwd: workspace, encoding: 'utf8' }
    )
  } catch (error) {
    // Exit 1: findings were reported.
    output = (error as { stdout: string }).stdout
  }
  const report = JSON.parse(output) as {
    diagnostics: {
      filename: string
      code: string
      message: string
      help?: string
    }[]
  }
  for (const item of report.diagnostics) {
    const key = item.filename.split('\\').join('/')
    const list = results.get(key) ?? []
    // no-restricted-properties puts the configured message in `help`.
    list.push({
      rule: item.code,
      message: [item.message, item.help].filter(Boolean).join(' ')
    })
    results.set(key, list)
  }
}, 30_000)

afterAll(() => {
  if (workspace) {
    rmSync(workspace, { recursive: true, force: true })
  }
})

/** The messages of the findings of rules matching `rule` for a sample. */
const findingsOf = (key: string, rule: RegExp) =>
  (results.get(key) ?? [])
    .filter(finding => rule.test(finding.rule))
    .map(finding => finding.message)

const p1Rules = /no-restricted-(globals|properties)/
const p1Samples = [
  `void fetch('/x')`,
  `void new XMLHttpRequest()`,
  `void new WebSocket('ws://x')`,
  `void new EventSource('/x')`,
  `void localStorage.getItem('x')`,
  `void sessionStorage.length`,
  `void indexedDB.open('x')`,
  `void window.fetch('/x')`,
  `void globalThis.localStorage`,
  `void document.cookie`
]
const p1Paths = [`${protocol}/x.ts`, `${core}/x.ts`, `${vue}/x.ts`]
const p1Keys = new Map(
  p1Paths.map(path => [
    path,
    p1Samples.map(code => ({ code, key: sample(path, code) }))
  ])
)
const testsKey = sample('tests/repo/x.spec.ts', `void fetch('/x')`)
const specKey = sample(`${vue}/x.spec.ts`, `void fetch('/x')`)

describe('C-50 No transport, no storage: the lint config', () => {
  it.each(p1Paths)('bans the network and storage in %s', path => {
    // In the protocol and the core a `window.` sample also hits the DOM ban.
    for (const { code, key } of p1Keys.get(path) ?? []) {
      expect(findingsOf(key, p1Rules), code).toContainEqual(
        expect.stringMatching(/\(P1\)/)
      )
    }
  })

  it('leaves the tests alone', () => {
    expect(findingsOf(testsKey, p1Rules)).toEqual([])
    expect(findingsOf(specKey, p1Rules)).toEqual([])
  })
})

const domSamples = [
  `void document.body`,
  `void window.innerWidth`,
  `void navigator.clipboard`,
  `void performance.now()`,
  `setTimeout(() => {}, 1)`,
  `setInterval(() => {}, 1)`,
  `requestAnimationFrame(() => {})`,
  `queueMicrotask(() => {})`
]
const domPaths = [`${protocol}/x.ts`, `${core}/x.ts`]
const domKeys = new Map(
  domPaths.map(path => [
    path,
    {
      banned: domSamples.map(code => ({ code, key: sample(path, code) })),
      allowed: sample(path, `void Promise.resolve().then(() => {})`)
    }
  ])
)
const listenerSamples = [
  `window.addEventListener('keydown', () => {})`,
  `document.addEventListener('keydown', () => {})`,
  `globalThis.addEventListener('resize', () => {})`,
  `declare const el: HTMLElement\nel.ownerDocument.addEventListener('selectionchange', () => {})`,
  `declare const el: { ownerDocument: { defaultView: Window } }\nel.ownerDocument.defaultView.addEventListener('resize', () => {})`
].map(code => ({ code, key: sample(`${vue}/dom/x.ts`, code) }))
const readKey = sample(`${vue}/dom/x.ts`, `void document.activeElement`)
const inputKey = sample(
  `${vue}/dom/x.ts`,
  `declare const input: HTMLElement\ninput.addEventListener('keydown', () => {})`
)
const listenerVueKey = sample(
  `${vue}/x.vue`,
  `<script setup lang="ts">\nwindow.addEventListener('keydown', () => {})\n</script>`
)
const layerKeys = [
  `${protocol}/x.ts`,
  `${core}/x.ts`,
  `${vue}/x.ts`,
  `${vue}/x.vue`
].map(path => ({
  path,
  key: sample(
    path,
    path.endsWith('.vue')
      ? `<script setup lang="ts">\nimport 'some-library'\n</script>`
      : `import 'some-library'`
  )
}))
const specLayerKey = sample(`${core}/x.spec.ts`, `import 'some-library'`)

describe('DOM, clock and listener fences', () => {
  it.each(domPaths)('keeps the DOM, the clock and timers out of %s', path => {
    const keys = domKeys.get(path)
    for (const { code, key } of keys?.banned ?? []) {
      expect(findingsOf(key, p1Rules), code).toHaveLength(1)
    }
    expect(findingsOf(keys?.allowed ?? '', p1Rules)).toEqual([])
  })

  it('lets the Vue package read the DOM but never listen on window or document', () => {
    expect(findingsOf(readKey, p1Rules)).toEqual([])
    for (const { code, key } of listenerSamples) {
      expect(findingsOf(key, /no-global-listeners/), code).toEqual([
        expect.stringContaining('never on window or document')
      ])
    }
    expect(findingsOf(listenerVueKey, /no-global-listeners/)).toHaveLength(1)
    expect(findingsOf(inputKey, /no-global-listeners/)).toEqual([])
  })

  it('runs the layer rule on every package source, not on its specs', () => {
    for (const { path, key } of layerKeys) {
      expect(findingsOf(key, /layers\(boundaries\)/), path).toHaveLength(1)
    }
    expect(findingsOf(specLayerKey, /layers\(boundaries\)/)).toEqual([])
  })
})

// D-33 (ADR 0029): console and debugger only in the published source.
const consoleCode = `export const f = () => {\n  console.log(1)\n  debugger\n}`
const consoleKeys = {
  source: [`${core}/x.ts`, `${vue}/x.ts`].map(path =>
    sample(path, consoleCode)
  ),
  exempt: [
    `${core}/x.spec.ts`,
    `${vue}/x.spec.ts`,
    'scripts/x.mjs',
    'tools/x.mjs',
    'tests/repo/x.ts'
  ].map(path => sample(path, consoleCode))
}

describe('D-33 console and debugger', () => {
  it('refuses console and debugger in the published source only', () => {
    for (const key of consoleKeys.source) {
      expect(findingsOf(key, /no-(console|debugger)/), key).toHaveLength(2)
    }
    for (const key of consoleKeys.exempt) {
      expect(findingsOf(key, /no-(console|debugger)/), key).toEqual([])
    }
  })
})
