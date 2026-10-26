import { describe, expect, it } from 'vitest'

import { type Token, tokenize } from '@dolusoft/command-protocol'

/** The values of an `ok: true` result; fails on an error result. */
function values(line: string): string[] {
  const result = tokenize(line)
  expect(result.ok).toBe(true)
  return result.tokens.map(t => t.value)
}

function token(
  value: string,
  start: number,
  end: number,
  flags: { quoted?: boolean; open?: boolean } = {}
): Token {
  return {
    value,
    start,
    end,
    quoted: flags.quoted ?? false,
    open: flags.open ?? false
  }
}

describe('C-10 Tokenizer: whitespace separates', () => {
  it.each<[string, string[]]>([
    ['', []],
    ['   ', []],
    ['show', ['show']],
    ['show config', ['show', 'config']],
    ['  show   config  ', ['show', 'config']],
    ['show\tconfig', ['show', 'config']],
    ['show \t\t config', ['show', 'config']],
    ['a\nb', ['a', 'b']],
    ['a\u00a0b', ['a', 'b']],
    ['a\r\nb', ['a', 'b']]
  ])('%j gives %j', (line, expected) => {
    expect(values(line)).toEqual(expected)
  })

  it('spans are UTF-16 offsets of the raw token, end exclusive', () => {
    expect(tokenize('  set\tkey  value').tokens).toEqual([
      token('set', 2, 5),
      token('key', 6, 9),
      token('value', 11, 16)
    ])
  })

  it('a surrogate pair stays whole and counts two units', () => {
    expect(tokenize('😀 x').tokens).toEqual([
      token('😀', 0, 2),
      token('x', 3, 4)
    ])
  })
})

describe('C-10 Tokenizer: single quotes group literally', () => {
  it.each<[string, string[]]>([
    ["'a b'", ['a b']],
    ["'a\tb'", ['a\tb']],
    ["'a\\b'", ['a\\b']],
    ["'a\\'", ['a\\']],
    ['\'say "hi"\'', ['say "hi"']],
    ["''", ['']],
    ["x '' y", ['x', '', 'y']]
  ])('%j gives %j', (line, expected) => {
    expect(values(line)).toEqual(expected)
  })

  it('the span covers the quotes', () => {
    expect(tokenize("set 'a b'").tokens).toEqual([
      token('set', 0, 3),
      token('a b', 4, 9, { quoted: true })
    ])
  })
})

describe('C-10 Tokenizer: double quotes group with two escapes', () => {
  it.each<[string, string[]]>([
    ['"a b"', ['a b']],
    ['"say \\"hi\\""', ['say "hi"']],
    ['"a\\\\b"', ['a\\b']],
    ['"a\\b"', ['a\\b']],
    ['"a\\nb"', ['a\\nb']],
    ['"a\\\'b"', ["a\\'b"]],
    ['"it\'s"', ["it's"]],
    ['"\\\\"', ['\\']],
    ['""', ['']],
    ['x "" y', ['x', '', 'y']]
  ])('%j gives %j', (line, expected) => {
    expect(values(line)).toEqual(expected)
  })

  it('the span covers the quotes and the escapes', () => {
    expect(tokenize('a "b\\"c" d').tokens).toEqual([
      token('a', 0, 1),
      token('b"c', 2, 8, { quoted: true }),
      token('d', 9, 10)
    ])
  })
})

describe('C-10 Tokenizer: backslash is literal outside quotes', () => {
  it.each<[string, string[]]>([
    ['C:\\data', ['C:\\data']],
    ['cd C:\\Program\\ Files', ['cd', 'C:\\Program\\', 'Files']],
    ['a\\', ['a\\']],
    ['\\\\', ['\\\\']],
    ['a\\"b c"', ['a\\b c']]
  ])('%j gives %j', (line, expected) => {
    expect(values(line)).toEqual(expected)
  })

  it('a trailing backslash does not continue the line', () => {
    expect(values('echo a \\')).toEqual(['echo', 'a', '\\'])
  })
})

describe('C-10 Tokenizer: adjacent parts join one token', () => {
  it.each<[string, string[]]>([
    ['a"b c"d', ['ab cd']],
    ["a'b c'd", ['ab cd']],
    ['"a"\'b\'', ['ab']],
    ['s"et" key', ['set', 'key']],
    ['\'\'""', ['']],
    ["key='a b'", ['key=a b']]
  ])('%j gives %j', (line, expected) => {
    expect(values(line)).toEqual(expected)
  })

  it('the joined token spans every part', () => {
    expect(tokenize(' a"b c"d ').tokens).toEqual([
      token('ab cd', 1, 8, { quoted: true })
    ])
  })

  it('a bare token is not quoted, its raw text is its value', () => {
    const [bare] = tokenize('a.b-c').tokens
    expect(bare).toEqual(token('a.b-c', 0, 5))
  })
})

describe('C-11 Unterminated quote', () => {
  it.each<[string, number, Token[]]>([
    ["'abc", 0, [token('abc', 0, 4, { quoted: true, open: true })]],
    ['"abc', 0, [token('abc', 0, 4, { quoted: true, open: true })]],
    [
      "set key 'a b",
      8,
      [
        token('set', 0, 3),
        token('key', 4, 7),
        token('a b', 8, 12, { quoted: true, open: true })
      ]
    ],
    [
      'x "a\\" b',
      2,
      [token('x', 0, 1), token('a" b', 2, 8, { quoted: true, open: true })]
    ],
    ['ab"c d ', 2, [token('abc d ', 0, 7, { quoted: true, open: true })]],
    [
      "'a' 'b",
      4,
      [
        token('a', 0, 3, { quoted: true }),
        token('b', 4, 6, { quoted: true, open: true })
      ]
    ],
    ['"', 0, [token('', 0, 1, { quoted: true, open: true })]],
    ['"a\\', 0, [token('a\\', 0, 3, { quoted: true, open: true })]]
  ])('%j fails at %i and keeps the tolerant tokens', (line, index, tokens) => {
    expect(tokenize(line)).toEqual({
      ok: false,
      tokens,
      error: { code: 'unterminated-quote', index }
    })
  })

  it('the index is the opening quote that is not closed', () => {
    const result = tokenize(`'a' "b'c`)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.index).toBe(4)
      expect(result.tokens.at(-1)).toEqual(
        token("b'c", 4, 8, { quoted: true, open: true })
      )
    }
  })

  it('the open token runs to the end of the line, whitespace included', () => {
    const line = 'a "b  \t'
    const result = tokenize(line)
    expect(result.tokens.at(-1)?.end).toBe(line.length)
    expect(result.tokens.at(-1)?.value).toBe('b  \t')
  })

  it('a closed line has no open token', () => {
    const result = tokenize(`a 'b' "c"`)
    expect(result.ok).toBe(true)
    expect(result.tokens.every(t => !t.open)).toBe(true)
  })
})
