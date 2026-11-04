import { describe, expect, it } from 'vitest'

import {
  type InputError,
  inputLimits,
  type InputSchema,
  validateInput
} from '@dolusoft/command-protocol'

const schema: InputSchema = {
  type: 'object',
  properties: {
    ip: { type: 'string', pattern: '^[0-9.]+$', minLength: 7, maxLength: 15 },
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
    ratio: { type: 'number', enum: [0.5, 1] },
    verbose: { type: 'boolean' },
    level: { type: 'string', enum: ['low', 'high'] },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    filter: {
      type: 'object',
      properties: {
        port: { type: 'integer' },
        proto: { type: 'string', default: 'tcp' }
      },
      required: ['port']
    }
  },
  required: ['ip']
}

function errorsOf(value: unknown, of: InputSchema = schema): InputError[] {
  const result = validateInput(of, value)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.errors
}

describe('C-71 Input validation', () => {
  it('accepts a valid value and returns a copy with the defaults filled', () => {
    const value = { ip: '10.0.0.5', filter: { port: 53 } }
    const result = validateInput(schema, value)
    expect(result).toEqual({
      ok: true,
      value: {
        ip: '10.0.0.5',
        limit: 100,
        tags: [],
        filter: { port: 53, proto: 'tcp' }
      }
    })
    expect(value).toEqual({ ip: '10.0.0.5', filter: { port: 53 } })
    if (result.ok) {
      expect(result.value.filter).not.toBe(value.filter)
    }
  })

  it('keeps given values over defaults and copies arrays', () => {
    const tags = ['a', 'b']
    const result = validateInput(schema, {
      ip: '10.0.0.5',
      limit: 7,
      verbose: false,
      tags
    })
    expect(result).toEqual({
      ok: true,
      value: { ip: '10.0.0.5', limit: 7, verbose: false, tags: ['a', 'b'] }
    })
    if (result.ok) {
      expect(result.value.tags).not.toBe(tags)
    }
  })

  it('works on deeply frozen input', () => {
    const value = Object.freeze({
      ip: '10.0.0.5',
      tags: Object.freeze(['x']),
      filter: Object.freeze({ port: 1 })
    })
    expect(validateInput(schema, value).ok).toBe(true)
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['an array', []],
    ['a string', 'ip=1'],
    ['a class instance', new Date(0)]
  ])('a root that is %s is a type error at the root', (_, value) => {
    expect(errorsOf(value)).toEqual([{ path: '', code: 'type' }])
  })

  it('a missing required field is required, at any depth', () => {
    expect(errorsOf({ filter: {} })).toEqual([
      { path: 'ip', code: 'required' },
      { path: 'filter.port', code: 'required' }
    ])
  })

  it('an unknown field is additional, at any depth', () => {
    expect(
      errorsOf({ ip: '10.0.0.5', host: 'x', filter: { port: 1, extra: true } })
    ).toEqual([
      { path: 'filter.extra', code: 'additional' },
      { path: 'host', code: 'additional' }
    ])
  })

  it.each<[string, unknown, InputError[]]>([
    ['a number for a string', { ip: 10 }, [{ path: 'ip', code: 'type' }]],
    [
      'a string for an integer',
      { ip: '10.0.0.5', limit: '5' },
      [{ path: 'limit', code: 'type' }]
    ],
    [
      'a fraction for an integer',
      { ip: '10.0.0.5', limit: 1.5 },
      [{ path: 'limit', code: 'type' }]
    ],
    [
      'NaN for a number',
      { ip: '10.0.0.5', ratio: NaN },
      [{ path: 'ratio', code: 'type' }]
    ],
    [
      'a string for a boolean',
      { ip: '10.0.0.5', verbose: 'true' },
      [{ path: 'verbose', code: 'type' }]
    ],
    [
      'null for an optional field',
      { ip: '10.0.0.5', level: null },
      [{ path: 'level', code: 'type' }]
    ],
    [
      'a string for an array',
      { ip: '10.0.0.5', tags: 'a' },
      [{ path: 'tags', code: 'type' }]
    ],
    [
      'a wrong item',
      { ip: '10.0.0.5', tags: ['a', 1] },
      [{ path: 'tags[1]', code: 'type' }]
    ],
    [
      'a hole in an array',
      { ip: '10.0.0.5', tags: new Array<string>(1) },
      [{ path: 'tags[0]', code: 'type' }]
    ],
    [
      'an array for an object',
      { ip: '10.0.0.5', filter: [] },
      [{ path: 'filter', code: 'type' }]
    ],
    [
      'undefined for a field',
      { ip: '10.0.0.5', level: undefined },
      [{ path: 'level', code: 'type' }]
    ]
  ])('%s is a type error', (_, value, errors) => {
    expect(errorsOf(value)).toEqual(errors)
  })

  it('an integer field accepts a whole number written as a float', () => {
    expect(validateInput(schema, { ip: '10.0.0.5', limit: 5.0 }).ok).toBe(true)
  })

  it.each<[string, unknown, InputError[]]>([
    [
      'enum on a string',
      { ip: '10.0.0.5', level: 'mid' },
      [{ path: 'level', code: 'enum' }]
    ],
    [
      'enum on a number',
      { ip: '10.0.0.5', ratio: 2 },
      [{ path: 'ratio', code: 'enum' }]
    ],
    [
      'minimum',
      { ip: '10.0.0.5', limit: 0 },
      [{ path: 'limit', code: 'minimum' }]
    ],
    [
      'maximum',
      { ip: '10.0.0.5', limit: 501 },
      [{ path: 'limit', code: 'maximum' }]
    ],
    ['minLength', { ip: '1.1.1' }, [{ path: 'ip', code: 'minLength' }]],
    [
      'maxLength',
      { ip: '1234567890.1234567' },
      [{ path: 'ip', code: 'maxLength' }]
    ],
    ['pattern', { ip: '10.0.0.x' }, [{ path: 'ip', code: 'pattern' }]],
    [
      'maxItems',
      { ip: '10.0.0.5', tags: ['a', 'b', 'c', 'd'] },
      [{ path: 'tags', code: 'maxItems' }]
    ]
  ])('a failed %s is reported under its name', (_, value, errors) => {
    expect(errorsOf(value)).toEqual(errors)
  })

  it('reports every error, not the first only', () => {
    expect(
      errorsOf({ ip: 'x', limit: 0, tags: [1], other: 1 }).map(e => e.path)
    ).toEqual(['ip', 'ip', 'limit', 'tags[0]', 'other'])
  })

  it('an error carries a path and a code, never the value', () => {
    for (const error of errorsOf({ ip: 'secret-value', level: 'secret' })) {
      expect(Object.keys(error).sort()).toEqual(['code', 'path'])
      expect(JSON.stringify(error)).not.toContain('secret')
    }
  })

  it('lengths count code points, not UTF-16 units', () => {
    const short: InputSchema = {
      type: 'object',
      properties: { a: { type: 'string', maxLength: 2, minLength: 2 } }
    }
    expect(validateInput(short, { a: '😀😀' }).ok).toBe(true)
    expect(errorsOf({ a: '😀😀😀' }, short)).toEqual([
      { path: 'a', code: 'maxLength' }
    ])
  })

  it('the pattern is not anchored and reads unicode', () => {
    const word: InputSchema = {
      type: 'object',
      properties: { a: { type: 'string', pattern: '\\p{L}+' } }
    }
    expect(validateInput(word, { a: '1 ş 2' }).ok).toBe(true)
    expect(errorsOf({ a: '12' }, word)).toEqual([
      { path: 'a', code: 'pattern' }
    ])
  })

  it('a required array must be given; an absent optional one is empty', () => {
    const lists: InputSchema = {
      type: 'object',
      properties: {
        must: { type: 'array', items: { type: 'integer' } },
        may: { type: 'array', items: { type: 'integer' } }
      },
      required: ['must']
    }
    expect(errorsOf({}, lists)).toEqual([{ path: 'must', code: 'required' }])
    expect(validateInput(lists, { must: [] })).toEqual({
      ok: true,
      value: { must: [], may: [] }
    })
  })

  it('an object default is copied, with its own defaults filled', () => {
    const nested: InputSchema = {
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          properties: {
            port: { type: 'integer' },
            proto: { type: 'string', default: 'tcp' },
            ids: { type: 'array', items: { type: 'integer' } }
          },
          default: { port: 80 }
        }
      }
    }
    const first = validateInput(nested, {})
    expect(first).toEqual({
      ok: true,
      value: { filter: { port: 80, proto: 'tcp', ids: [] } }
    })
    const second = validateInput(nested, {})
    if (first.ok && second.ok) {
      expect(first.value.filter).not.toBe(second.value.filter)
    }
  })
})

describe('C-72 Input limits', () => {
  const free: InputSchema = {
    type: 'object',
    properties: {
      text: { type: 'string' },
      list: { type: 'array', items: { type: 'integer' } },
      a: {
        type: 'object',
        properties: {
          b: { type: 'object', properties: { c: { type: 'integer' } } },
          list: { type: 'array', items: { type: 'integer' } }
        }
      }
    }
  }

  it('exposes the limits', () => {
    expect(inputLimits).toEqual({
      maxTextLength: 1000,
      maxDepth: 3,
      maxArrayLength: 50
    })
    expect(Object.isFrozen(inputLimits)).toBe(true)
  })

  it('a string over the length limit is limit, whatever the schema allows', () => {
    const max = 'x'.repeat(inputLimits.maxTextLength)
    expect(validateInput(free, { text: max }).ok).toBe(true)
    expect(errorsOf({ text: `${max}y` }, free)).toEqual([
      { path: 'text', code: 'limit' }
    ])
    const wide: InputSchema = {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 5000, pattern: '^z' } }
    }
    expect(errorsOf({ text: `${max}y` }, wide)).toEqual([
      { path: 'text', code: 'limit' }
    ])
  })

  it('the text limit counts code points', () => {
    const emoji = '😀'.repeat(inputLimits.maxTextLength)
    expect(validateInput(free, { text: emoji }).ok).toBe(true)
  })

  it('an array over the length limit is limit, and its items are not checked', () => {
    const max = Array.from({ length: inputLimits.maxArrayLength }, (_, i) => i)
    expect(validateInput(free, { list: max }).ok).toBe(true)
    expect(errorsOf({ list: [...max, 'x'] }, free)).toEqual([
      { path: 'list', code: 'limit' }
    ])
  })

  it('a container deeper than the limit is limit', () => {
    expect(validateInput(free, { a: { b: { c: 1 }, list: [1] } }).ok).toBe(true)
    const deep: InputSchema = {
      type: 'object',
      properties: {
        a: {
          type: 'object',
          properties: {
            b: { type: 'object', properties: { c: { type: 'object' } } }
          }
        }
      }
    }
    expect(errorsOf({ a: { b: { c: {} } } }, deep)).toEqual([
      { path: 'a.b.c', code: 'limit' }
    ])
  })
})
