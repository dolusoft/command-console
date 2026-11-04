import { describe, expect, it } from 'vitest'

import {
  type Envelope,
  envelopeBytes,
  envelopeMaxBytes,
  inputLimits,
  parseEnvelope
} from '@dolusoft/command-protocol'

const envelope: Envelope = {
  v: 1,
  id: '3f0c6c1e-6d1b-4a8e-9b7e-2a4c1f2d9e10',
  kind: 'request',
  actor: 'user',
  from: { tab: 't-5b21' },
  target: { tab: 't-5b21', view: 'v-91c0' },
  command: 'dataview.search',
  args: {
    ip: '10.0.0.5',
    from: '2026-11-04T18:40:00Z',
    to: '2026-11-04T19:40:00Z'
  }
}

/** A copy of the envelope with `changes` applied; `undefined` deletes. */
function changed(changes: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = structuredClone(envelope) as never
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      delete copy[key]
    } else {
      copy[key] = value
    }
  }
  return copy
}

describe('C-75 Envelope', () => {
  it('accepts a version 1 request and returns a new, equal envelope', () => {
    const raw = structuredClone(envelope)
    const result = parseEnvelope(raw)
    expect(result).toEqual({ ok: true, envelope })
    if (result.ok) {
      expect(result.envelope).not.toBe(raw)
      expect(result.envelope.args).not.toBe(raw.args)
      expect(result.envelope.from).not.toBe(raw.from)
      expect(result.envelope.target).not.toBe(raw.target)
    }
  })

  it('accepts every actor and a target without a view', () => {
    for (const actor of ['user', 'assistant', 'external-agent']) {
      expect(parseEnvelope(changed({ actor })).ok).toBe(true)
    }
    const result = parseEnvelope(changed({ target: { tab: 't-1' } }))
    expect(result).toMatchObject({
      ok: true,
      envelope: { target: { tab: 't-1' } }
    })
    if (result.ok) {
      expect('view' in result.envelope.target).toBe(false)
    }
  })

  it('a null target.view is no view', () => {
    const result = parseEnvelope(
      changed({ target: { tab: 't-1', view: null } })
    )
    expect(result).toMatchObject({
      ok: true,
      envelope: { target: { tab: 't-1' } }
    })
    if (result.ok) {
      expect('view' in result.envelope.target).toBe(false)
    }
  })

  it('leaves unknown fields out, at the top and inside from and target', () => {
    const result = parseEnvelope(
      changed({
        trace: 'x',
        from: { tab: 't-5b21', user: 'u' },
        target: { tab: 't-5b21', view: 'v-91c0', extra: 1 }
      })
    )
    expect(result).toEqual({ ok: true, envelope })
  })

  it('reads the raw value without changing it', () => {
    const raw = changed({ trace: 'x' })
    const frozen = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
    deepFreeze(frozen)
    expect(parseEnvelope(frozen).ok).toBe(true)
    expect(frozen).toEqual(raw)
  })

  it.each([0, 2, 1.5, -1])('v %j is unsupported-version', v => {
    expect(parseEnvelope(changed({ v }))).toEqual({
      ok: false,
      code: 'unsupported-version'
    })
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', '{"v":1}'],
    ['an array', [envelope]],
    ['a class instance', new Date(0)],
    ['no v', changed({ v: undefined })],
    ['v as a string', changed({ v: '1' })],
    ['no id', changed({ id: undefined })],
    ['an empty id', changed({ id: '' })],
    ['a numeric id', changed({ id: 7 })],
    ['another kind', changed({ kind: 'result' })],
    ['an unknown actor', changed({ actor: 'system' })],
    ['no from', changed({ from: undefined })],
    ['from without tab', changed({ from: {} })],
    ['an empty from.tab', changed({ from: { tab: '' } })],
    ['a target that is a string', changed({ target: 't-1' })],
    ['a numeric target.view', changed({ target: { tab: 't', view: 1 } })],
    ['an empty target.view', changed({ target: { tab: 't', view: '' } })],
    ['no command', changed({ command: undefined })],
    ['an empty command', changed({ command: '' })],
    ['no args', changed({ args: undefined })],
    ['args as an array', changed({ args: [] })],
    ['args as null', changed({ args: null })],
    ['args with undefined', changed({ args: { a: undefined } })],
    ['args with NaN', changed({ args: { a: NaN } })],
    ['args as a class instance', changed({ args: new Map() })]
  ])('%s is invalid', (_, raw) => {
    expect(parseEnvelope(raw)).toEqual({ ok: false, code: 'invalid' })
  })

  it('a cycle is invalid', () => {
    const raw = changed({})
    raw.self = raw
    expect(parseEnvelope(raw)).toEqual({ ok: false, code: 'invalid' })
  })

  it.each<[string, Record<string, unknown>]>([
    ['a long text', { a: 'x'.repeat(inputLimits.maxTextLength + 1) }],
    [
      'a long array',
      { a: Array.from({ length: inputLimits.maxArrayLength + 1 }, () => 0) }
    ],
    ['deep nesting', { a: { b: { c: {} } } }],
    ['a deep array', { a: [[[]]] }],
    ['a long text deep inside', { a: [{ b: 'x'.repeat(1001) }] }]
  ])('args with %s beyond the input limits are invalid', (_, args) => {
    expect(parseEnvelope(changed({ args }))).toEqual({
      ok: false,
      code: 'invalid'
    })
  })

  it('args at the input limits are accepted', () => {
    const args = {
      a: 'x'.repeat(inputLimits.maxTextLength),
      b: Array.from({ length: inputLimits.maxArrayLength }, () => 0),
      c: { d: [1, 'e'] }
    }
    expect(parseEnvelope(changed({ args })).ok).toBe(true)
  })

  it('envelopeBytes is the UTF-8 length of the JSON', () => {
    expect(envelopeBytes(envelope)).toBe(JSON.stringify(envelope).length)
    const turkish: Envelope = { ...envelope, args: { q: 'ş😀' } }
    expect(envelopeBytes(turkish)).toBe(
      JSON.stringify(envelope).length -
        JSON.stringify(envelope.args).length +
        JSON.stringify({ q: '' }).length +
        2 +
        4
    )
  })

  it(`an envelope over ${envelopeMaxBytes} bytes is too-large`, () => {
    expect(envelopeMaxBytes).toBe(16384)
    const fill = (bytes: number): Record<string, unknown> => {
      const base = envelopeBytes({ ...envelope, args: { a: [] } })
      const items: string[] = []
      let left = bytes - base
      while (left > 0) {
        // Each item adds its text plus two quotes and a comma.
        const size = Math.min(500, Math.max(1, left - 3))
        items.push('x'.repeat(size))
        left -= size + 3
      }
      return changed({ args: { a: items } })
    }
    const atLimit = fill(envelopeMaxBytes)
    expect(
      new TextEncoder().encode(JSON.stringify(atLimit)).length
    ).toBeLessThanOrEqual(envelopeMaxBytes)
    expect(parseEnvelope(atLimit).ok).toBe(true)
    const over = changed({
      args: { a: Array.from({ length: 40 }, () => 'ş'.repeat(250)) }
    })
    expect(
      new TextEncoder().encode(JSON.stringify(over)).length
    ).toBeGreaterThan(envelopeMaxBytes)
    expect(parseEnvelope(over)).toEqual({ ok: false, code: 'too-large' })
  })

  it('size counts the raw value, unknown fields included', () => {
    const raw = changed({ padding: 'x'.repeat(envelopeMaxBytes) })
    expect(parseEnvelope(raw)).toEqual({ ok: false, code: 'too-large' })
  })

  it('the version is checked before the size', () => {
    const raw = changed({ v: 2, padding: 'x'.repeat(envelopeMaxBytes) })
    expect(parseEnvelope(raw)).toEqual({
      ok: false,
      code: 'unsupported-version'
    })
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
