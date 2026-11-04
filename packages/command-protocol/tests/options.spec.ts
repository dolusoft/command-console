import { describe, expect, it } from 'vitest'

import {
  formatCommandLine,
  type InputError,
  type InputSchema,
  type JsonValue,
  parseOptions,
  tokenize
} from '@dolusoft/command-protocol'

const schema: InputSchema = {
  type: 'object',
  properties: {
    ip: { type: 'string' },
    from: { type: 'string' },
    limit: { type: 'integer', default: 100 },
    ratio: { type: 'number' },
    verbose: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
    ports: { type: 'array', items: { type: 'integer' } },
    filter: {
      type: 'object',
      properties: { port: { type: 'integer' }, proto: { type: 'string' } }
    },
    pairs: {
      type: 'array',
      items: { type: 'array', items: { type: 'integer' } }
    }
  },
  required: ['ip']
}

/** The tokens of `line` after the command name. */
function argsOf(line: string): string[] {
  return tokenize(line)
    .tokens.slice(1)
    .map(t => t.value)
}

function parsed(line: string): Record<string, JsonValue> {
  const result = parseOptions(argsOf(line), schema)
  expect(result).toMatchObject({ ok: true })
  return result.ok ? result.value : {}
}

function errorsOf(line: string): InputError[] {
  const result = parseOptions(argsOf(line), schema)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.errors
}

describe('C-73 Option lines', () => {
  it('reads --name value pairs into the fields, filling defaults', () => {
    expect(
      parsed('dataview.search --ip 10.0.0.5 --from 2026-11-04T18:40:00Z')
    ).toEqual({
      ip: '10.0.0.5',
      from: '2026-11-04T18:40:00Z',
      limit: 100,
      tags: [],
      ports: [],
      pairs: []
    })
  })

  it('the order of the pairs does not matter', () => {
    expect(parsed('x --limit 5 --ip a')).toEqual(parsed('x --ip a --limit 5'))
  })

  it('converts numbers as JSON writes them', () => {
    expect(parsed('x --ip a --limit -5 --ratio 2.5e3')).toMatchObject({
      limit: -5,
      ratio: 2500
    })
    expect(parsed('x --ip a --limit 1e2')).toMatchObject({ limit: 100 })
  })

  it.each([
    'abc',
    '0x10',
    '1_000',
    '',
    ' 1',
    '+1',
    '.5',
    '1.',
    'Infinity',
    'NaN',
    '01'
  ])('the number %j is a type error', text => {
    expect(parseOptions(['--ip', 'a', '--ratio', text], schema)).toEqual({
      ok: false,
      errors: [{ path: 'ratio', code: 'type' }]
    })
  })

  it('a fraction for an integer is a type error', () => {
    expect(errorsOf('x --ip a --limit 1.5')).toEqual([
      { path: 'limit', code: 'type' }
    ])
  })

  it('a string value is taken as is, even when it looks like a name or a number', () => {
    expect(parsed('x --ip --from --from 42')).toMatchObject({
      ip: '--from',
      from: '42'
    })
    expect(parsed("x --ip 'a b' --from ''")).toMatchObject({
      ip: 'a b',
      from: ''
    })
  })

  it('a boolean alone is true, and takes true or false', () => {
    expect(parsed('x --ip a --verbose')).toMatchObject({ verbose: true })
    expect(parsed('x --verbose --ip a')).toMatchObject({ verbose: true })
    expect(parsed('x --ip a --verbose true')).toMatchObject({ verbose: true })
    expect(parsed('x --ip a --verbose false')).toMatchObject({
      verbose: false
    })
  })

  it('a boolean followed by another word leaves the word to stand alone', () => {
    expect(errorsOf('x --ip a --verbose yes')).toEqual([
      { path: '', code: 'additional' }
    ])
  })

  it('an array field repeats its name, in order', () => {
    expect(
      parsed('x --ip a --tags b --ports 1 --tags c --ports 2')
    ).toMatchObject({ tags: ['b', 'c'], ports: [1, 2] })
  })

  it('an object, or an array item that is an array, is JSON text', () => {
    expect(
      parsed(
        `x --ip a --filter '{"port":53,"proto":"udp"}' --pairs [1,2] --pairs []`
      )
    ).toMatchObject({
      filter: { port: 53, proto: 'udp' },
      pairs: [[1, 2], []]
    })
  })

  it('JSON text that does not parse, or has the wrong shape, is a type error', () => {
    expect(errorsOf(`x --ip a --filter '{port:1}'`)).toEqual([
      { path: 'filter', code: 'type' }
    ])
    expect(errorsOf(`x --ip a --filter '{"port":"53"}'`)).toEqual([
      { path: 'filter.port', code: 'type' }
    ])
    expect(errorsOf(`x --ip a --pairs '[1,"a"]'`)).toEqual([
      { path: 'pairs[0][1]', code: 'type' }
    ])
  })

  it('an unknown name is additional; its value goes with it', () => {
    expect(errorsOf('x --ip a --host b')).toEqual([
      { path: 'host', code: 'additional' }
    ])
  })

  it('a token that is not a name is additional at the root', () => {
    expect(errorsOf('x a --ip b')).toEqual([{ path: '', code: 'additional' }])
    expect(errorsOf('x --ip b -- c')).toEqual([
      { path: '', code: 'additional' },
      { path: '', code: 'additional' }
    ])
  })

  it('a name without its value is a type error', () => {
    expect(errorsOf('x --ip')).toEqual([
      { path: 'ip', code: 'type' },
      { path: 'ip', code: 'required' }
    ])
  })

  it('a second value of a field that is not an array is a type error', () => {
    expect(errorsOf('x --ip a --ip b')).toEqual([{ path: 'ip', code: 'type' }])
    expect(errorsOf('x --ip a --verbose --verbose')).toEqual([
      { path: 'verbose', code: 'type' }
    ])
  })

  it('names are case-sensitive', () => {
    expect(errorsOf('x --IP a')).toEqual([
      { path: 'IP', code: 'additional' },
      { path: 'ip', code: 'required' }
    ])
  })

  it('validates the result like validateInput', () => {
    const bounded: InputSchema = {
      type: 'object',
      properties: { n: { type: 'integer', maximum: 3 } },
      required: ['n']
    }
    expect(parseOptions(['--n', '4'], bounded)).toEqual({
      ok: false,
      errors: [{ path: 'n', code: 'maximum' }]
    })
    expect(parseOptions([], bounded)).toEqual({
      ok: false,
      errors: [{ path: 'n', code: 'required' }]
    })
  })

  it('does not read names inherited from Object.prototype', () => {
    expect(errorsOf('x --ip a --constructor b --toString c')).toEqual([
      { path: 'constructor', code: 'additional' },
      { path: 'toString', code: 'additional' }
    ])
  })

  it('reads its arguments without changing them', () => {
    const args = Object.freeze(['--ip', 'a', '--tags', 'b'])
    expect(parseOptions(args, schema).ok).toBe(true)
    expect(args).toEqual(['--ip', 'a', '--tags', 'b'])
  })
})

describe('C-74 Canonical line', () => {
  it('writes the fields in the order of properties, values quoted', () => {
    expect(
      formatCommandLine(
        'dataview.search',
        { from: '2026-11-04T18:40:00Z', ip: '10.0.0.5' },
        schema
      )
    ).toBe(
      'dataview.search --ip 10.0.0.5 --from 2026-11-04T18:40:00Z --limit 100'
    )
  })

  it('quotes values, writes booleans, arrays and JSON text', () => {
    expect(
      formatCommandLine(
        'x',
        {
          ip: "it's a b",
          from: '',
          verbose: false,
          tags: ['a b', 'c'],
          filter: { port: 53 },
          pairs: [[1, 2]]
        },
        schema
      )
    ).toBe(
      `x --ip "it's a b" --from '' --limit 100 --verbose false --tags 'a b' --tags c --filter '{"port":53}' --pairs [1,2]`
    )
    expect(formatCommandLine('x', { ip: 'a', verbose: true }, schema)).toBe(
      'x --ip a --limit 100 --verbose'
    )
  })

  it('quotes the command name when it needs it', () => {
    expect(formatCommandLine('a b', { ip: 'a' }, schema)).toBe(
      "'a b' --ip a --limit 100"
    )
  })

  it('reads back with parseOptions', () => {
    const value = {
      ip: '--x',
      from: 'true',
      ratio: -0.25,
      verbose: false,
      tags: ['', '"q"'],
      ports: [1, -2],
      filter: { proto: "'" },
      pairs: [[], [3]]
    }
    const line = formatCommandLine('x', value, schema)
    expect(parseOptions(argsOf(line), schema)).toEqual({
      ok: true,
      value: { ...value, limit: 100 }
    })
  })

  it('throws for a value the schema rejects', () => {
    expect(() => formatCommandLine('x', { from: 'a' }, schema)).toThrow(
      TypeError
    )
    expect(() => formatCommandLine('x', { ip: 'a', other: 1 }, schema)).toThrow(
      TypeError
    )
  })
})
