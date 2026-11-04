// Property tests of the canonical line: random values of fixed schemas,
// from fixed seeds, written with formatCommandLine and read back with
// parseOptions.
import { describe, expect, it } from 'vitest'

import {
  checkInputSchema,
  formatCommandLine,
  type InputSchema,
  type InputSchemaNode,
  type JsonValue,
  parseOptions,
  tokenize,
  validateInput
} from '@dolusoft/command-protocol'

import { forAll, integer, type Random, text } from './support/random'

const cases = 1000

const schemas: readonly InputSchema[] = [
  {
    type: 'object',
    properties: {
      ip: { type: 'string' },
      from: { type: 'string' },
      limit: { type: 'integer', default: 100 },
      ratio: { type: 'number' },
      verbose: { type: 'boolean' },
      level: { type: 'string', enum: ['low', '--high', 'a b'] }
    },
    required: ['ip']
  },
  {
    type: 'object',
    properties: {
      tags: { type: 'array', items: { type: 'string' } },
      flags: { type: 'array', items: { type: 'boolean' } },
      numbers: { type: 'array', items: { type: 'number' } },
      pairs: {
        type: 'array',
        items: { type: 'array', items: { type: 'string' } }
      },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'integer' }, name: { type: 'string' } }
        }
      }
    },
    required: ['tags']
  },
  {
    type: 'object',
    properties: {
      filter: {
        type: 'object',
        properties: {
          port: { type: 'integer' },
          proto: { type: 'string', default: 'tcp' },
          inner: {
            type: 'object',
            properties: { on: { type: 'boolean' }, text: { type: 'string' } }
          },
          ids: { type: 'array', items: { type: 'integer' } }
        },
        required: ['port']
      },
      on: { type: 'boolean', default: true }
    }
  }
]

/** Words that look like syntax: names, booleans, numbers, JSON. */
const tricky = ['--x', '--', 'true', 'false', '42', '-1', '[]', '{}', '"', "'"]

function randomString(random: Random): string {
  return random() < 0.2
    ? tricky[integer(random, 0, tricky.length - 1)]
    : text(random, 12)
}

function randomNumber(random: Random, whole: boolean): number {
  const n = integer(random, -1000, 1000)
  if (whole) {
    return random() < 0.1 ? n * 1e15 : n
  }
  const pick = random()
  return pick < 0.3 ? n / 8 : pick < 0.4 ? n * 1e-9 : pick < 0.5 ? n * 1e21 : n
}

/** A random value `node` accepts; an optional field is left out at times. */
function valueOf(random: Random, node: InputSchemaNode): JsonValue {
  switch (node.type) {
    case 'string':
      return node.enum
        ? node.enum[integer(random, 0, node.enum.length - 1)]
        : randomString(random)
    case 'number':
    case 'integer':
      return randomNumber(random, node.type === 'integer')
    case 'boolean':
      return random() < 0.5
    case 'array':
      return Array.from({ length: integer(random, 0, 4) }, () =>
        valueOf(random, node.items)
      )
    case 'object': {
      const result: Record<string, JsonValue> = {}
      for (const [name, child] of Object.entries(node.properties ?? {})) {
        if (node.required?.includes(name) || random() < 0.6) {
          result[name] = valueOf(random, child)
        }
      }
      return result
    }
  }
}

function argsOf(line: string): string[] {
  const result = tokenize(line)
  expect(result.ok).toBe(true)
  return result.tokens.slice(1).map(t => t.value)
}

describe('C-74 Canonical line: parseOptions ∘ formatCommandLine', () => {
  it.each(schemas.map((schema, n) => [n, schema] as const))(
    'a random value of schema %i reads back as its validated value',
    (n, schema) => {
      checkInputSchema(schema)
      forAll(
        20 + n,
        cases,
        random => valueOf(random, schema) as Record<string, JsonValue>,
        value => {
          const valid = validateInput(schema, value)
          expect(valid.ok).toBe(true)
          const line = formatCommandLine('cmd.name', value, schema)
          const tokens = tokenize(line).tokens
          expect(tokens[0].value).toBe('cmd.name')
          const back = parseOptions(argsOf(line), schema)
          expect(back).toEqual(valid)
          // The canonical line of the read-back value is the same line.
          if (back.ok) {
            expect(formatCommandLine('cmd.name', back.value, schema)).toBe(line)
          }
        }
      )
    }
  )
})
