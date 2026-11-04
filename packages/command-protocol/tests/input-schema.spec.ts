import { describe, expect, it } from 'vitest'

import { checkInputSchema, inputLimits } from '@dolusoft/command-protocol'

const search = {
  type: 'object',
  description: 'Search the data view',
  properties: {
    ip: { type: 'string', pattern: '^[0-9.]+$', maxLength: 15 },
    from: { type: 'string', description: 'ISO time' },
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
    ratio: { type: 'number', enum: [0.5, 1] },
    verbose: { type: 'boolean', default: false },
    level: { type: 'string', enum: ['low', 'high'], minLength: 1 },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    filter: {
      type: 'object',
      properties: { port: { type: 'integer' } },
      required: ['port'],
      default: { port: 80 }
    }
  },
  required: ['ip']
}

/** The message `checkInputSchema` throws for `schema`. */
function failure(schema: unknown): string {
  try {
    checkInputSchema(schema)
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError)
    return (error as Error).message
  }
  throw new Error('checkInputSchema did not throw')
}

describe('C-70 Input schema', () => {
  it('accepts every keyword of the subset where it applies', () => {
    expect(() => checkInputSchema(search)).not.toThrow()
    expect(() => checkInputSchema({ type: 'object' })).not.toThrow()
  })

  it.each<[string, unknown]>([
    ['a string root', { type: 'string' }],
    ['an array root', { type: 'array', items: { type: 'string' } }],
    ['no type', {}],
    ['null', null],
    ['an array', []]
  ])('throws for %s: the root is an object', (_, schema) => {
    expect(failure(schema)).toMatch(/root|object/)
  })

  it.each([
    'additionalProperties',
    'oneOf',
    '$ref',
    'format',
    'minItems',
    'exclusiveMinimum',
    'const'
  ])('throws for the keyword %s outside the subset, naming it', keyword => {
    const message = failure({
      type: 'object',
      properties: { a: { type: 'string', [keyword]: 1 } }
    })
    expect(message).toContain(keyword)
    expect(message).toContain('a')
  })

  it.each<[string, Record<string, unknown>]>([
    ['minimum on a string', { type: 'string', minimum: 1 }],
    ['pattern on a number', { type: 'number', pattern: 'x' }],
    ['enum on a boolean', { type: 'boolean', enum: [true] }],
    ['items on a string', { type: 'string', items: { type: 'string' } }],
    [
      'properties on an array',
      { type: 'array', items: { type: 'string' }, properties: {} }
    ]
  ])('throws for %s: a keyword applies to its own types', (_, node) => {
    expect(failure({ type: 'object', properties: { a: node } })).toMatch(
      /does not apply/
    )
  })

  it.each<[string, Record<string, unknown>]>([
    ['an unknown type', { type: 'date' }],
    ['a type list', { type: ['string', 'null'] }],
    ['a negative maxLength', { type: 'string', maxLength: -1 }],
    ['a fractional minLength', { type: 'string', minLength: 1.5 }],
    [
      'minLength above maxLength',
      { type: 'string', minLength: 3, maxLength: 2 }
    ],
    ['an infinite minimum', { type: 'number', minimum: Infinity }],
    ['minimum above maximum', { type: 'number', minimum: 2, maximum: 1 }],
    ['an empty enum', { type: 'string', enum: [] }],
    ['an enum of the wrong type', { type: 'string', enum: [1] }],
    ['a fractional integer enum', { type: 'integer', enum: [1.5] }],
    ['an array without items', { type: 'array' }],
    [
      'a fractional maxItems',
      { type: 'array', items: { type: 'string' }, maxItems: 0.5 }
    ],
    ['a description that is not text', { type: 'string', description: 1 }],
    ['a pattern that is not text', { type: 'string', pattern: 1 }],
    ['properties that are not an object', { type: 'object', properties: [] }],
    ['required that is not a list', { type: 'object', required: 'a' }]
  ])('throws for %s', (_, node) => {
    expect(() =>
      checkInputSchema({ type: 'object', properties: { a: node } })
    ).toThrow(TypeError)
  })

  it.each(['(', '[a-', '\\p{Nope}', 'a{2,1}'])(
    'throws for the pattern %j, which does not compile',
    pattern => {
      expect(
        failure({
          type: 'object',
          properties: { a: { type: 'string', pattern } }
        })
      ).toMatch(/pattern/)
    }
  )

  it.each(['', '1a', '-a', '_a', 'a b', 'a.b', "a'", '__proto__', 'ş'])(
    'throws for the property name %j',
    name => {
      expect(
        failure({ type: 'object', properties: { [name]: { type: 'string' } } })
      ).toMatch(/name/)
    }
  )

  it.each(['a', 'ip', 'fromTime', 'from_time', 'from-time', 'A1'])(
    'accepts the property name %j',
    name => {
      expect(() =>
        checkInputSchema({
          type: 'object',
          properties: { [name]: { type: 'string' } }
        })
      ).not.toThrow()
    }
  )

  it('throws for a required name that is not a property, or twice', () => {
    expect(
      failure({
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['b']
      })
    ).toContain('b')
    expect(() =>
      checkInputSchema({
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a', 'a']
      })
    ).toThrow(TypeError)
  })

  it('throws for a default the node rejects, and for any default on an array', () => {
    expect(
      failure({
        type: 'object',
        properties: { a: { type: 'integer', minimum: 5, default: 1 } }
      })
    ).toMatch(/default/)
    expect(
      failure({
        type: 'object',
        properties: { a: { type: 'string', default: 3 } }
      })
    ).toMatch(/default/)
    expect(
      failure({
        type: 'object',
        properties: {
          a: { type: 'array', items: { type: 'string' }, default: [] }
        }
      })
    ).toMatch(/default/)
  })

  it(`throws for containers deeper than ${inputLimits.maxDepth}`, () => {
    const three = {
      type: 'object',
      properties: {
        a: {
          type: 'object',
          properties: {
            b: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
    expect(() => checkInputSchema(three)).not.toThrow()
    const four = {
      type: 'object',
      properties: {
        a: {
          type: 'object',
          properties: {
            b: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } }
            }
          }
        }
      }
    }
    expect(failure(four)).toMatch(/deep/)
  })

  it('names the path of the failing node', () => {
    expect(
      failure({
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            properties: {
              ports: { type: 'array', items: { type: 'integer', minimum: 'x' } }
            }
          }
        }
      })
    ).toContain('filter.ports[]')
  })

  it('reads the schema without changing it', () => {
    const frozen = JSON.parse(JSON.stringify(search)) as unknown
    deepFreeze(frozen)
    expect(() => checkInputSchema(frozen)).not.toThrow()
    expect(frozen).toEqual(search)
  })
})

function deepFreeze(value: unknown): void {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value)
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
  }
}
