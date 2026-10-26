// Property tests of the line syntax (spec §12): random lines over the
// characters the syntax cares about, from fixed seeds.
import { describe, expect, it } from 'vitest'

import {
  quoteArgument,
  tokenize,
  type TokenizeResult
} from '@dolusoft/command-protocol'

import { forAll, integer, type Random, text } from './support/random'

const cases = 2000

/** Asserts the span invariants of one result for `line`. */
function expectSpansCoverLine(line: string, result: TokenizeResult): void {
  let position = 0
  for (const [n, token] of result.tokens.entries()) {
    // Between tokens there is only whitespace, and at least one character.
    const gap = line.slice(position, token.start)
    expect(gap.trim()).toBe('')
    if (n > 0) {
      expect(gap.length).toBeGreaterThan(0)
    }
    expect(token.end).toBeGreaterThan(token.start)
    expect(token.end).toBeLessThanOrEqual(line.length)
    // A token never starts with whitespace: the first raw character is
    // either a quote or part of the value.
    expect(line[token.start].trim()).not.toBe('')
    position = token.end
  }
  expect(line.slice(position).trim()).toBe('')
}

describe('C-10 Tokenizer: properties over random lines', () => {
  it('spans cover the raw text: only whitespace lies outside them', () => {
    forAll(
      1,
      cases,
      random => text(random, 24),
      line => expectSpansCoverLine(line, tokenize(line))
    )
  })

  it('nothing is dropped: each span read alone gives the same token', () => {
    forAll(
      2,
      cases,
      random => text(random, 24),
      line => {
        for (const token of tokenize(line).tokens) {
          const raw = line.slice(token.start, token.end)
          const alone = tokenize(raw)
          expect(alone.tokens).toEqual([
            { ...token, start: 0, end: raw.length }
          ])
        }
      }
    )
  })

  it('a token without quotes has its raw text as its value', () => {
    forAll(
      3,
      cases,
      random => text(random, 24),
      line => {
        for (const token of tokenize(line).tokens) {
          if (!token.quoted) {
            expect(token.value).toBe(line.slice(token.start, token.end))
          }
        }
      }
    )
  })

  it('every character but quotes and backslashes reaches the value', () => {
    // Removing the quoting loses no other character: they appear in the
    // value, in their order.
    forAll(
      4,
      cases,
      random => text(random, 24),
      line => {
        for (const token of tokenize(line).tokens) {
          const raw = line.slice(token.start, token.end)
          const plain = raw.replace(/['"\\]/g, '')
          let rest = token.value
          for (const char of plain) {
            const at = rest.indexOf(char)
            expect(at).toBeGreaterThanOrEqual(0)
            rest = rest.slice(at + 1)
          }
        }
      }
    )
  })

  it('only the last token can be open, exactly when the result fails', () => {
    forAll(
      5,
      cases,
      random => text(random, 24),
      line => {
        const result = tokenize(line)
        const open = result.tokens.filter(t => t.open)
        if (result.ok) {
          expect(open).toEqual([])
        } else {
          const last = result.tokens.at(-1)
          expect(open).toEqual([last])
          expect(last?.end).toBe(line.length)
          expect(last?.quoted).toBe(true)
          const index = result.error.index
          expect(['"', "'"]).toContain(line[index])
          expect(index).toBeGreaterThanOrEqual(last?.start ?? -1)
        }
      }
    )
  })
})

/** Joins quoted values with random runs of whitespace. */
function joinWithRandomSpace(random: Random, values: string[]): string {
  const space = () => text(random, 3, [' ', '\t', '\u00a0']) || ' '
  const lead = random() < 0.3 ? space() : ''
  const tail = random() < 0.3 ? space() : ''
  return lead + values.map(quoteArgument).join(space()) + tail
}

describe('C-10 Tokenizer: tokenize ∘ quoteArgument round trip', () => {
  it('one random value reads back as one token with that value', () => {
    forAll(
      6,
      cases,
      random => text(random, 16),
      value => {
        const result = tokenize(quoteArgument(value))
        expect(result.ok).toBe(true)
        expect(result.tokens.map(t => t.value)).toEqual([value])
      }
    )
  })

  it('a list of random values reads back as the same list', () => {
    forAll(
      7,
      cases,
      random => {
        const count = integer(random, 0, 5)
        const list: string[] = []
        for (let i = 0; i < count; i++) {
          list.push(text(random, 10))
        }
        return { list, line: joinWithRandomSpace(random, list) }
      },
      ({ list, line }) => {
        const result = tokenize(line)
        expect(result.ok).toBe(true)
        expect(result.tokens.map(t => t.value)).toEqual(list)
      }
    )
  })

  it('the quoted form follows the order bare, single, double', () => {
    forAll(
      8,
      cases,
      random => text(random, 12),
      value => {
        const quoted = quoteArgument(value)
        const bare = value !== '' && !/[\s'"]/.test(value)
        if (bare) {
          expect(quoted).toBe(value)
        } else if (!value.includes("'")) {
          expect(quoted).toBe(`'${value}'`)
        } else {
          expect(quoted.startsWith('"')).toBe(true)
          // No escape is spent where the plain character would do.
          expect(quoted.length).toBeLessThanOrEqual(
            value.length + 2 + (value.match(/["\\]/g)?.length ?? 0)
          )
        }
      }
    )
  })

  it('tokens of a random line requoted read back the same', () => {
    forAll(
      9,
      cases,
      random => text(random, 24),
      line => {
        const result = tokenize(line)
        if (!result.ok) {
          return
        }
        const values = result.tokens.map(t => t.value)
        const again = tokenize(values.map(quoteArgument).join(' '))
        expect(again.ok).toBe(true)
        expect(again.tokens.map(t => t.value)).toEqual(values)
      }
    )
  })
})

describe('C-10 Tokenizer: the generator', () => {
  it('produces quotes, whitespace and failing lines', () => {
    // Guards the properties above against a generator that never reaches the
    // interesting cases.
    let failing = 0
    let quoted = 0
    forAll(
      10,
      500,
      random => text(random, 24),
      line => {
        const result = tokenize(line)
        if (!result.ok) {
          failing++
        }
        if (result.tokens.some(t => t.quoted && !t.open)) {
          quoted++
        }
      }
    )
    expect(failing).toBeGreaterThan(50)
    expect(quoted).toBeGreaterThan(50)
  })
})
