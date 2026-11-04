import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  type CommandOutcome,
  type CommandResponse,
  type CommandSpec,
  type ConsoleEffect,
  type ConsoleEntry,
  type ContextFrame,
  type Envelope,
  type EnvelopeResult,
  type InputError,
  type InputResult,
  type InputSchema,
  isJsonValue,
  type JsonPrimitive,
  type JsonValue,
  type MessageParams,
  type OutputBlock,
  type Token,
  type TokenizeResult
} from '@dolusoft/command-protocol'

/**
 * `true` when every value `T` admits is JSON. Optional properties may be
 * absent (their `undefined` is ignored); everything else must be a JSON
 * primitive, an array of JSON or an object of JSON. A recursive type (an
 * input schema) is followed `Depth` levels deep, past every distinct node.
 */
type JsonOnly<T, Depth extends unknown[] = []> = Depth['length'] extends 8
  ? true
  : [T] extends [JsonValue]
    ? true
    : T extends JsonPrimitive
      ? true
      : T extends readonly (infer U)[]
        ? JsonOnly<U, [...Depth, unknown]>
        : T extends (...args: never[]) => unknown
          ? false
          : T extends object
            ? false extends {
                [K in keyof T]-?: JsonOnly<
                  Exclude<T[K], undefined>,
                  [...Depth, unknown]
                >
              }[keyof T]
              ? false
              : true
            : false

const frame: ContextFrame = {
  id: 'f1',
  prompt: 'config>',
  data: { service: 'auth', depth: 1, tags: ['a', 'b'], extra: null }
}

const blocks: OutputBlock[] = [
  { type: 'text', text: 'hello\nworld' },
  { type: 'json', value: { a: [1, 2.5, -3], b: { c: true, d: null } } },
  {
    type: 'table',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'size', label: 'Size' }
    ],
    rows: [
      { name: 'a', size: 1 },
      { name: 'b', size: null }
    ]
  },
  { type: 'list', items: ['one', 'two'] },
  { type: 'message', code: 'command-not-found', params: { name: 'shw' } },
  { type: 'message', code: 'command-not-found', params: { name: null } },
  { type: 'message', code: 'unterminated-quote', params: { index: 4 } },
  { type: 'message', code: 'command-failed' },
  { type: 'message', code: 'interrupted' },
  { type: 'custom', kind: 'chart', data: { points: [[0, 1]] } },
  { type: 'custom', kind: 'divider' }
]

const entries: ConsoleEntry[] = [
  {
    id: 'c1',
    kind: 'input',
    prompt: '>',
    text: 'show config',
    redacted: false,
    status: 'submitted'
  },
  {
    id: 'c2',
    kind: 'input',
    prompt: 'config>',
    text: null,
    redacted: true,
    status: 'cancelled'
  },
  {
    id: 'c6',
    kind: 'input',
    prompt: '>',
    text: 'dataview.search --ip 10.0.0.5',
    redacted: false,
    status: 'submitted',
    actor: 'external-agent'
  },
  { id: 'c3', kind: 'output', tone: 'default', blocks, inputId: 'c1' },
  { id: 'c4', kind: 'output', tone: 'notice', blocks: [], quiet: true },
  { id: 'c5', kind: 'output', tone: 'error', blocks: blocks.slice(0, 1) }
]

const effects: ConsoleEffect[] = [
  { type: 'clear' },
  { type: 'close' },
  { type: 'push-context', frame },
  { type: 'pop-context' },
  { type: 'pop-context', count: 2 },
  { type: 'reset-context' },
  { type: 'clear-recall' }
]

const responses: CommandResponse[] = [
  {},
  { output: 'done' },
  { output: blocks, tone: 'notice', quiet: true, effects },
  { tone: 'error', effects: [{ type: 'clear' }] },
  { output: 'shown', summary: '342 rows' }
]

const searchInput: InputSchema = {
  type: 'object',
  description: 'Search',
  properties: {
    ip: { type: 'string', pattern: '^[0-9.]+$', minLength: 7, maxLength: 15 },
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
    level: { type: 'string', enum: ['low', 'high'], default: 'low' },
    ratio: { type: 'number', enum: [0.5, 1] },
    verbose: { type: 'boolean', default: false },
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

const envelopes: Envelope[] = [
  {
    v: 1,
    id: '3f0c6c1e-6d1b-4a8e-9b7e-2a4c1f2d9e10',
    kind: 'request',
    actor: 'assistant',
    from: { tab: 't-1' },
    target: { tab: 't-1', view: 'v-1' },
    command: 'dataview.search',
    args: { ip: '10.0.0.5', tags: ['a'], filter: { port: 53 } }
  },
  {
    v: 1,
    id: 'x',
    kind: 'request',
    actor: 'user',
    from: { tab: 't-1' },
    target: { tab: 't-1' },
    command: 'view.open',
    args: {}
  }
]

const outcomes: CommandOutcome[] = [
  { status: 'ok' },
  { status: 'ok', summary: '342 rows' },
  { status: 'error', code: 'busy' },
  { status: 'error', code: 'invalid-args', message: 'ip is required' }
]

const specs: CommandSpec[] = [
  { name: 'show' },
  {
    name: 'set',
    aliases: ['s'],
    summary: 'Set a value',
    usage: 'set <key> <value>',
    hidden: false,
    sensitive: { fromArg: 1 }
  },
  { name: 'login', sensitive: true },
  { name: 'debug', hidden: true },
  { name: 'dataview.search', input: searchInput, danger: 'read' },
  { name: 'rule.delete', input: { type: 'object' }, danger: 'irreversible' }
]

const samples: [string, unknown][] = [
  ['context frames', [frame, { id: 'root-child', prompt: '#' }]],
  ['output blocks', blocks],
  ['entries', entries],
  ['effects', effects],
  ['responses', responses],
  ['command specs', specs],
  ['envelopes', envelopes],
  ['outcomes', outcomes]
]

describe('C-06 JSON', () => {
  it.each(samples)('%s survive a JSON round trip unchanged', (_, value) => {
    expect(isJsonValue(value)).toBe(true)
    expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value)
  })

  it('every protocol type admits only JSON values', () => {
    expectTypeOf<JsonOnly<ConsoleEntry>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<OutputBlock>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<CommandSpec>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<CommandResponse>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<ConsoleEffect>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<ContextFrame>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<MessageParams>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<Token>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<TokenizeResult>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<InputSchema>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<InputError>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<InputResult>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<Envelope>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<EnvelopeResult>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<CommandOutcome>>().toEqualTypeOf<true>()
  })

  it('the type check itself rejects what is not JSON', () => {
    expectTypeOf<JsonOnly<{ a: () => void }>>().toEqualTypeOf<false>()
    expectTypeOf<JsonOnly<{ a: Date }>>().toEqualTypeOf<false>()
    expectTypeOf<JsonOnly<{ a: bigint }>>().toEqualTypeOf<false>()
    expectTypeOf<JsonOnly<{ a: string | undefined }>>().toEqualTypeOf<true>()
    expectTypeOf<JsonOnly<{ a: symbol }>>().toEqualTypeOf<false>()
  })
})

describe('C-06 JSON: isJsonValue', () => {
  it.each<[string, unknown]>([
    ['a string', 'x'],
    ['an empty string', ''],
    ['zero', 0],
    ['a negative float', -1.5],
    ['the largest number', Number.MAX_VALUE],
    ['true', true],
    ['null', null],
    ['an empty array', []],
    ['an empty object', {}],
    ['a null-prototype object', Object.assign(Object.create(null), { a: 1 })],
    ['nested values', { a: [{ b: [null, 'c'] }] }],
    [
      'a shared, acyclic reference',
      (() => {
        const leaf = { x: 1 }
        return [leaf, { leaf }]
      })()
    ]
  ])('accepts %s', (_, value) => {
    expect(isJsonValue(value)).toBe(true)
  })

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['a bigint', 1n],
    ['a symbol', Symbol('s')],
    ['a function', () => 1],
    ['a Date', new Date(0)],
    ['a Map', new Map()],
    [
      'a class instance',
      new (class Point {
        x = 1
      })()
    ],
    ['an undefined property', { a: undefined }],
    ['an undefined item', [undefined]],
    ['a NaN deep inside', { a: [{ b: [NaN] }] }],
    ['a sparse array', new Array<number>(3)],
    ['a symbol key', { [Symbol('k')]: 1 }],
    ['a boxed string', new String('x')],
    [
      'a cycle',
      (() => {
        const a: Record<string, unknown> = {}
        a.self = a
        return a
      })()
    ],
    [
      'an array cycle',
      (() => {
        const a: unknown[] = []
        a.push([a])
        return a
      })()
    ]
  ])('rejects %s', (_, value) => {
    expect(isJsonValue(value)).toBe(false)
  })

  it('reads its input without changing it', () => {
    const value = Object.freeze({ a: Object.freeze([1, 2]) })
    expect(isJsonValue(value)).toBe(true)
    expect(value).toEqual({ a: [1, 2] })
  })
})
