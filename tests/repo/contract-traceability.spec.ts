import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { pendingRules } from './pending-rules'
import { collectSuite, coveredIds, namedIds, rulesOf } from './test-names'

// The behavior rules live in contract/rules.md as `### C-nn Title` (P12).
// Every rule needs a runnable test that stands under its ID (in its own title
// or in the title of the `describe` around it), and a test may only name IDs
// that exist and are not withdrawn. The specs are read as syntax trees
// (`test-names.ts`): a `describe` that holds no test, a `.skip` or a `.todo`
// covers nothing.
//
// While the packages are written piece by piece, a rule without a test yet
// is listed in `pending-rules.ts`. The list may only shrink: a listed rule
// that has a test fails here, so the piece that adds the test removes the
// rule from the list (CONTRIBUTING.md, "Rule traceability").

/** The rules of 1.0: C-01 to C-69. A later rule raises it. */
const ruleCount = 69
/**
 * The fewest runnable tests the specs must hold, so a broken reader that
 * finds none fails. Each piece raises it to about the count it leaves; 1.0 is
 * released with it set to the 1.0 count.
 */
const minimumTests = 250

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const rules = rulesOf(readFileSync(join(root, 'contract', 'rules.md'), 'utf8'))

const specFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      return ['node_modules', '__screenshots__', 'dist'].includes(entry)
        ? []
        : specFiles(path)
    }
    return /\.spec\.ts$/.test(entry) &&
      !entry.startsWith('contract-traceability')
      ? [path]
      : []
  })

/** `dir/*` that are directories, or nothing when `dir` does not exist. */
const childDirs = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .map(entry => join(dir, entry))
        .filter(path => statSync(path).isDirectory())
    : []

// Internal unit specs sit next to the code in src/, the package specs in
// packages/*/tests, the Vue behavior specs in tests/contract, the repository
// checks in tests/repo.
const roots = [
  join(root, 'tests'),
  ...childDirs(join(root, 'packages')).flatMap(pkg => [
    join(pkg, 'src'),
    join(pkg, 'tests')
  ])
].filter(dir => existsSync(dir))

const suites = roots.flatMap(specFiles).map(file => ({
  file: file.slice(root.length + 1).replace(/\\/g, '/'),
  suite: collectSuite(readFileSync(file, 'utf8'), file)
}))

const covered = new Set(suites.flatMap(({ suite }) => [...coveredIds(suite)]))
const pending = new Set(pendingRules)

describe('contract traceability', () => {
  it('finds the rules and the tests', () => {
    expect(rules.length).toBeGreaterThanOrEqual(ruleCount)
    expect(
      suites.reduce((n, { suite }) => n + suite.tests.length, 0)
    ).toBeGreaterThanOrEqual(minimumTests)
  })

  it('numbers the rules without gaps', () => {
    expect(rules.map(rule => rule.id)).toEqual(
      rules.map((_, index) => `C-${String(index + 1).padStart(2, '0')}`)
    )
  })

  it('has a test for every rule that is not withdrawn or pending', () => {
    const missing = rules.filter(
      rule => !rule.withdrawn && !pending.has(rule.id) && !covered.has(rule.id)
    )
    expect(
      missing.map(rule => `${rule.id} ${rule.title}`),
      'rules without a runnable test that stands under the ID'
    ).toEqual([])
  })

  it('lists as pending only known rules that still have no test', () => {
    const known = new Map(rules.map(rule => [rule.id, rule]))
    const wrong = pendingRules.flatMap(id => {
      const rule = known.get(id)
      if (!rule) {
        return [`${id} is not a rule`]
      }
      if (rule.withdrawn) {
        return [`${id} is withdrawn`]
      }
      if (covered.has(id)) {
        return [`${id} has a test now: remove it from pending-rules.ts`]
      }
      return []
    })
    expect(wrong).toEqual([])
    expect(new Set(pendingRules).size).toBe(pendingRules.length)
  })

  it('has no test that names an unknown or withdrawn rule', () => {
    const named = new Map(rules.map(rule => [rule.id, rule]))
    const wrong = suites.flatMap(({ file, suite }) =>
      namedIds(suite)
        .filter(id => !named.has(id) || named.get(id)!.withdrawn)
        .map(id => `${file} names ${id}`)
    )
    expect(wrong).toEqual([])
  })
})

describe('contract traceability reader', () => {
  const idsOf = (source: string) => coveredIds(collectSuite(source))

  it('counts the ID in a test title', () => {
    expect([...idsOf(`it('C-01 does a thing', () => {})`)]).toEqual(['C-01'])
    expect([...idsOf(`test('C-02 does a thing', () => {})`)]).toEqual(['C-02'])
  })

  it('counts the ID of a describe that holds a test', () => {
    expect([
      ...idsOf(`describe('C-03 group', () => { it('works', () => {}) })`)
    ]).toEqual(['C-03'])
    expect([
      ...idsOf(
        `describe('C-04 a', () => { describe('b', () => { it('x', () => {}) }) })`
      )
    ]).toEqual(['C-04'])
  })

  it('does not count an empty describe, a skipped test or a todo', () => {
    expect(idsOf(`describe('C-05 empty', () => {})`).size).toBe(0)
    expect(
      idsOf(`describe('C-06 nested empty', () => { describe('x', () => {}) })`)
        .size
    ).toBe(0)
    expect(idsOf(`it.skip('C-07 skipped', () => {})`).size).toBe(0)
    expect(idsOf(`it.todo('C-08 later')`).size).toBe(0)
    expect(
      idsOf(`describe.skip('C-09 g', () => { it.skip('x', () => {}) })`).size
    ).toBe(0)
  })

  it('reads .each and .only calls', () => {
    expect([...idsOf(`it.each([1, 2])('C-10 case %s', () => {})`)]).toEqual([
      'C-10'
    ])
    expect([...idsOf(`it.only('C-11 one', () => {})`)]).toEqual(['C-11'])
  })

  it('names the IDs of empty groups too, so an unknown one still fails', () => {
    expect(namedIds(collectSuite(`describe('C-99 empty', () => {})`))).toEqual([
      'C-99'
    ])
  })

  it('reads the rule headings and marks a withdrawn rule', () => {
    expect(
      rulesOf(
        ['### C-01 One', 'Body.', '### C-02 (withdrawn)', '', 'Why.'].join('\n')
      )
    ).toEqual([
      { id: 'C-01', title: 'One', withdrawn: false },
      { id: 'C-02', title: '(withdrawn)', withdrawn: true }
    ])
  })
})
