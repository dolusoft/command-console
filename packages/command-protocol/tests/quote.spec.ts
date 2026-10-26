import { describe, expect, it } from 'vitest'

import { quoteArgument, tokenize } from '@dolusoft/command-protocol'

describe('C-10 Tokenizer: quoteArgument', () => {
  it.each<[string, string]>([
    ['abc', 'abc'],
    ['C:\\data', 'C:\\data'],
    ['a\\', 'a\\'],
    ['key=value', 'key=value'],
    ['şifre', 'şifre'],
    ['', "''"],
    ['a b', "'a b'"],
    ['a\tb', "'a\tb'"],
    ['a\u00a0b', "'a\u00a0b'"],
    ['say "hi"', `'say "hi"'`],
    ['"', `'"'`],
    ['a\\ b', "'a\\ b'"],
    ["it's", `"it's"`],
    ["'", `"'"`],
    [`it's "x"`, `"it's \\"x\\""`],
    ["'\\", `"'\\\\"`],
    ["'\\a", `"'\\a"`],
    ["'\\\\", `"'\\\\\\\\"`],
    ['\'\\"', `"'\\\\\\""`]
  ])('%j is written %s', (value, quoted) => {
    expect(quoteArgument(value)).toBe(quoted)
  })

  it.each([
    '',
    'a b',
    "it's",
    'C:\\Program Files\\x',
    `'\\"`,
    '\\\\',
    ' leading',
    'trailing '
  ])('%j reads back as one token with the same value', value => {
    const result = tokenize(quoteArgument(value))
    expect(result.ok).toBe(true)
    expect(result.tokens.map(t => t.value)).toEqual([value])
  })

  it('a value that needs no quotes is returned as is', () => {
    expect(quoteArgument('plain')).toBe('plain')
  })

  it('single quotes are preferred over double quotes', () => {
    expect(quoteArgument('a "b" \\c')).toBe(`'a "b" \\c'`)
  })
})
