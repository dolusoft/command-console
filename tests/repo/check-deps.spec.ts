import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

// The specifiers `pnpm check:deps` reads from source and built files
// (scripts/specifiers.mjs): every form that loads a module counts.

const root = join(import.meta.dirname, '..', '..')
const { specifiersOf } = (await import(
  pathToFileURL(join(root, 'scripts', 'specifiers.mjs')).href
)) as { specifiersOf: (code: string) => string[] }

describe('check:deps specifiers', () => {
  it('reads imports, re-exports and dynamic imports', () => {
    expect(
      specifiersOf(`import a from 'a'
import 'b'
export * from '@c/d'
const e = import('e/sub')
import { f } from './local'`)
    ).toEqual(['a', 'b', '@c/d', 'e/sub'])
  })

  it('reads require() and import = require()', () => {
    expect(
      specifiersOf(`const g = require('g')
const h = require ( "h/x" )
import i = require('i')
const j = require('./local')`)
    ).toEqual(['g', 'h/x', 'i'])
  })
})
