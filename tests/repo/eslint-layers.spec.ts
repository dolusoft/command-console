import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { ESLint, Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'

// The fences of eslint.config.js. The layer rule (scripts/eslint-layers.mjs,
// P14) runs through ESLint on code placed at a given path; re-exports,
// dynamic imports and type imports count like imports. The bans of P1 (no
// network, no storage), of the DOM in the protocol and the core, and of
// window/document listeners in the Vue package are read from the real config
// for a file at that path and run on sample code.

const root = join(import.meta.dirname, '..', '..')
const { default: layers } = (await import(
  pathToFileURL(join(root, 'scripts', 'eslint-layers.mjs')).href
)) as { default: ESLint.Plugin }

const linter = new Linter({ configType: 'flat', cwd: root })
const config: Linter.Config[] = [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { layers },
    rules: { 'layers/boundaries': 'error' }
  }
]

/** The layer messages for `code` in the file at `path` (from the repo root). */
const lint = (path: string, code: string) =>
  linter
    .verify(code, config, { filename: join(root, path) })
    .map(message => message.message)

const protocol = 'packages/command-protocol/src'
const core = 'packages/command-console-core/src'
const vue = 'packages/command-console/src'

describe('layers/boundaries', () => {
  it('lets the protocol import only itself', () => {
    expect(lint(`${protocol}/index.ts`, `import './syntax/tokenize'`)).toEqual(
      []
    )
    expect(lint(`${protocol}/entry.ts`, `import { h } from 'vue'`)).toEqual([
      expect.stringContaining('command-protocol may import no package')
    ])
    expect(
      lint(
        `${protocol}/index.ts`,
        `export * from '@dolusoft/command-console-core'`
      )
    ).toHaveLength(1)
  })

  it('lets the core import the protocol, nothing else', () => {
    const file = `${core}/core/dispatch/dispatchFeature.ts`
    expect(
      lint(
        file,
        `import { tokenize } from '@dolusoft/command-protocol'
import type { ConsoleEntry } from '@dolusoft/command-protocol'`
      )
    ).toEqual([])
    expect(lint(file, `import { ref } from 'vue'`)).toHaveLength(1)
    expect(
      lint(file, `import x from '@dolusoft/command-console'`)
    ).toHaveLength(1)
    expect(
      lint(file, `import { tokenize } from '@dolusoft/command-protocol/syntax'`)
    ).toHaveLength(1)
  })

  it('lets the Vue package import the protocol, the core and vue', () => {
    expect(
      lint(
        `${vue}/use-command-console.ts`,
        `import { shallowRef } from 'vue'
import { createConsole } from '@dolusoft/command-console-core'
import type { ConsoleEntry } from '@dolusoft/command-protocol'
import { keyInputOf } from './dom/keys'`
      )
    ).toEqual([])
    expect(
      lint(`${vue}/labels.ts`, `import { format } from 'some-library'`)
    ).toEqual([expect.stringContaining('command-console may import')])
  })

  it('keeps one feature out of another, re-exports and dynamic imports included', () => {
    const file = `${core}/features/recall/recallFeature.ts`
    const message: unknown = expect.stringContaining(
      'the recall feature may not import'
    )
    expect(
      lint(
        file,
        `import { completionFeature } from '../completion/completionFeature'`
      )
    ).toEqual([message])
    expect(
      lint(
        file,
        `export { completionFeature } from '../completion/completionFeature'`
      )
    ).toEqual([message])
    expect(lint(file, `export * from '../context/context.types'`)).toEqual([
      message
    ])
    expect(lint(file, `void import('../context/contextFeature')`)).toEqual([
      message
    ])
    expect(
      lint(
        file,
        `import type { Session } from '../completion/completion.types'`
      )
    ).toEqual([message])
    expect(
      lint(file, `type T = import('../completion/completion.types').Session`)
    ).toEqual([message])
  })

  it('lets a feature use shared/, the store, its own files and the protocol', () => {
    expect(
      lint(
        `${core}/features/completion/completionFeature.ts`,
        `import { tokenizeTolerant } from '@dolusoft/command-protocol'
import { onLineEnd } from '../../shared/hooks'
import { registerFeature } from '../../shared'
import { action } from '../../store/action'
import { commonPrefix } from './completion.utils'`
      )
    ).toEqual([])
  })

  it('lets a feature and shared/ import core/ for types only', () => {
    const typesOnly = [
      `import type { ConsoleInstance } from '../../core/console/console.types'`,
      `import { type ConsoleInstance } from '../../core/console/console.types'`,
      `export type { ConsoleInstance } from '../../core/console/console.types'`,
      `type T = import('../../core/console/console.types').ConsoleInstance`
    ]
    for (const code of typesOnly) {
      expect(
        lint(`${core}/features/context/contextFeature.ts`, code),
        code
      ).toEqual([])
    }
    expect(
      lint(
        `${core}/shared/registry.ts`,
        `import type { ConsoleInstance } from '../core/console/console.types'`
      )
    ).toEqual([])
    expect(
      lint(
        `${core}/features/context/contextFeature.ts`,
        `import { constructConsole } from '../../core/console/constructConsole'`
      )
    ).toEqual([expect.stringContaining('core/ for types only')])
    expect(
      lint(
        `${core}/shared/registry.ts`,
        `import { constructConsole, type X } from '../core/console/constructConsole'`
      )
    ).toEqual([expect.stringContaining('shared/ may not import')])
  })

  it('keeps shared/, the store and core/ off the optional features', () => {
    const feature = '../features/recall/recallFeature'
    expect(
      lint(
        `${core}/shared/hooks.ts`,
        `import { recallFeature } from '${feature}'`
      )
    ).toEqual([
      expect.stringContaining('the core never depends on an optional feature')
    ])
    expect(
      lint(
        `${core}/core/input/inputFeature.ts`,
        `import type { RecallState } from '../../features/recall/recall.types'`
      )
    ).toEqual([
      expect.stringContaining('the core never depends on an optional feature')
    ])
    expect(
      lint(
        `${core}/store/createStore.ts`,
        `import { registerFeature } from '../shared/registry'`
      )
    ).toEqual([expect.stringContaining('store/ may not import')])
    expect(
      lint(
        `${core}/core/input/inputFeature.ts`,
        `import { allFeatures } from '../../helpers/allFeatures'`
      )
    ).toEqual([expect.stringContaining('core/ may not import')])
  })

  it('checks require() and import = require() like imports', () => {
    const file = `${core}/features/recall/recallFeature.ts`
    expect(
      lint(file, `const x = require('../context/contextFeature')`)
    ).toEqual([expect.stringContaining('the recall feature may not import')])
    expect(lint(file, `import x = require('vue')`)).toEqual([
      expect.stringContaining('command-console-core may import')
    ])
    expect(lint(file, `const x = require(name)`)).toEqual([
      expect.stringContaining('must name a literal module')
    ])
  })

  it('refuses import.meta.glob and a dynamic import that is not a literal', () => {
    const file = `${core}/helpers/allFeatures.ts`
    expect(lint(file, `const all = import.meta.glob('../features/*')`)).toEqual(
      [expect.stringContaining('import.meta.glob')]
    )
    expect(lint(file, `void import(name)`)).toEqual([
      expect.stringContaining('must name a literal module')
    ])
  })

  it('lets the helpers and the entry files gather every part of the core', () => {
    expect(
      lint(
        `${core}/helpers/allFeatures.ts`,
        `import { recallFeature } from '../features/recall/recallFeature'
import { completionFeature } from '../features/completion/completionFeature'
import { consoleFeature } from '../core/console/consoleFeature'`
      )
    ).toEqual([])
    expect(
      lint(
        `${core}/index.ts`,
        `export * from './features/recall/recallFeature'
export { createConsole } from './core/console/constructConsole'
export { allFeatures } from './helpers/allFeatures'`
      )
    ).toEqual([])
  })

  it('keeps a package from reaching into another by path', () => {
    expect(
      lint(
        `${core}/shared/hooks.ts`,
        `import { tokenize } from '../../../command-protocol/src'`
      )
    ).toEqual([
      expect.stringContaining('leaves packages/command-console-core/src')
    ])
  })

  it('leaves files outside packages/*/src alone', () => {
    expect(
      lint('tests/fixtures/consumer/x.ts', `import { ref } from 'vue'`)
    ).toEqual([])
  })
})

// The real eslint.config.js, as it applies to a file at a path.
const eslint = new ESLint({ cwd: root })
const rulesFor = async (path: string) =>
  ((await eslint.calculateConfigForFile(join(root, path))) as Linter.Config)
    .rules ?? {}

/** The messages of the given rules of the real config for `code` at `path`. */
const lintWith = async (path: string, ruleNames: string[], code: string) => {
  const rules = await rulesFor(path)
  const picked = Object.fromEntries(
    ruleNames.filter(name => name in rules).map(name => [name, rules[name]])
  )
  return linter
    .verify(
      code,
      [
        {
          files: ['**/*.ts'],
          languageOptions: { parser: tseslint.parser },
          rules: picked
        }
      ],
      { filename: join(root, path) }
    )
    .map(message => message.message)
}

const p1Rules = ['no-restricted-globals', 'no-restricted-properties']
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

describe('C-50 No transport, no storage: the lint config', () => {
  it.each([`${protocol}/x.ts`, `${core}/x.ts`, `${vue}/x.ts`])(
    'bans the network and storage in %s',
    async path => {
      // In the protocol and the core a `window.` sample also hits the DOM ban.
      for (const code of p1Samples) {
        expect(await lintWith(path, p1Rules, code), code).toContainEqual(
          expect.stringMatching(/(P1)/)
        )
      }
    }
  )

  it('leaves the tests alone', async () => {
    expect(
      await lintWith('tests/repo/x.spec.ts', p1Rules, `void fetch('/x')`)
    ).toEqual([])
  })
})

describe('DOM, clock and listener fences', () => {
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

  it.each([`${protocol}/x.ts`, `${core}/x.ts`])(
    'keeps the DOM, the clock and timers out of %s',
    async path => {
      for (const code of domSamples) {
        expect(await lintWith(path, p1Rules, code), code).toHaveLength(1)
      }
      expect(
        await lintWith(path, p1Rules, `void Promise.resolve().then(() => {})`)
      ).toEqual([])
    }
  )

  it('lets the Vue package read the DOM but never listen on window or document', async () => {
    const path = `${vue}/dom/focus.ts`
    expect(
      await lintWith(path, p1Rules, `void document.activeElement`)
    ).toEqual([])
    for (const code of [
      `window.addEventListener('keydown', () => {})`,
      `document.addEventListener('keydown', () => {})`,
      `globalThis.addEventListener('resize', () => {})`,
      `el.ownerDocument.addEventListener('selectionchange', () => {})`,
      `el.ownerDocument.defaultView.addEventListener('resize', () => {})`
    ]) {
      expect(
        await lintWith(path, ['no-restricted-syntax'], code),
        code
      ).toEqual([expect.stringContaining('never on window or document')])
    }
    expect(
      await lintWith(
        path,
        ['no-restricted-syntax'],
        `input.addEventListener('keydown', () => {})`
      )
    ).toEqual([])
  })

  it('refuses v-html and runs the layer rule on every package source', async () => {
    for (const path of [
      `${protocol}/x.ts`,
      `${core}/x.ts`,
      `${vue}/x.ts`,
      `${vue}/x.vue`
    ]) {
      const rules = await rulesFor(path)
      expect(rules['layers/boundaries'], path).toEqual([2])
      expect(rules['vue/no-v-html'], path).toEqual([2])
    }
  })
})
