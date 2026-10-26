import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  type CommandResponse,
  type CommandSpec,
  type ConsoleEffect,
  type ConsoleEntry,
  type ContextFrame,
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
 * primitive, an array of JSON or an object of JSON.
 */
type JsonOnly<T> = [T] extends [JsonValue]
  ? true
  : T extends JsonPrimitive
    ? true
    : T extends readonly (infer U)[]
      ? JsonOnly<U>
      : T extends (...args: never[]) => unknown
        ? false
        : T extends object
          ? false extends {
              [K in keyof T]-?: JsonOnly<Exclude<T[K], undefined>>
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
  { tone: 'error', effects: [{ type: 'clear' }] }
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
  { name: 'debug', hidden: true }
]

const samples: [string, unknown][] = [
  ['context frames', [frame, { id: 'root-child', prompt: '#' }]],
  ['output blocks', blocks],
  ['entries', entries],
  ['effects', effects],
  ['responses', responses],
  ['command specs', specs]
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
