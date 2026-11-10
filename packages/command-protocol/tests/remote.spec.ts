import { describe, expect, it } from 'vitest'

import {
  capabilitiesParts,
  chunkData,
  envelopeMaxBytes,
  errorClassOf,
  isCliReply,
  joinChunks,
  parseCliMessage,
  readCapabilitiesParts,
  refusedCliRequest,
  remoteArgvMaxItems,
  remoteBytes,
  remoteChunksMax,
  remoteEnvelopes,
  remoteFeatures,
  remoteLineMax,
  type CapabilitiesPayload,
  type FinishedReply
} from '@dolusoft/command-protocol'

const stamp = {
  origin: { kind: 'cli', grantId: 'g1', bindingId: 'b1' },
  stampedAt: 1000,
  expiresAt: 31_000
}

const request = (extra: Record<string, unknown> = {}) => ({
  v: 1,
  kind: 'cli-request',
  id: 'r1',
  line: 'search --ip 1',
  ...stamp,
  ...extra
})

describe('C-96 Remote envelopes', () => {
  it('reads a cli-request and a cancel, keeping only the known fields', () => {
    const raw = request({ view: 'v1', extra: 1 })
    const copy = structuredClone(raw)
    expect(parseCliMessage(raw)).toEqual({
      ok: true,
      message: {
        v: 1,
        kind: 'cli-request',
        id: 'r1',
        line: 'search --ip 1',
        view: 'v1',
        ...stamp
      }
    })
    expect(raw).toEqual(copy)
    expect(
      parseCliMessage({ v: 1, kind: 'cancel', id: 'r1', ...stamp, line: 'x' })
    ).toEqual({
      ok: true,
      message: { v: 1, kind: 'cancel', id: 'r1', ...stamp }
    })
    expect(parseCliMessage(request({ view: null }))).toEqual({
      ok: true,
      message: request()
    })
  })

  it('refuses another version, a value too large, and malformed fields', () => {
    expect(parseCliMessage(request({ v: 2 }))).toEqual({
      ok: false,
      code: 'unsupported-version'
    })
    expect(
      parseCliMessage(request({ pad: 'x'.repeat(envelopeMaxBytes) }))
    ).toEqual({ ok: false, code: 'too-large' })
    const invalid = [
      null,
      'x',
      { v: '1' },
      request({ kind: 'request' }),
      request({ id: '' }),
      request({ origin: { kind: 'browser', grantId: 'g', bindingId: 'b' } }),
      request({ origin: { kind: 'cli', grantId: '', bindingId: 'b' } }),
      request({ origin: null }),
      request({ stampedAt: -1 }),
      request({ expiresAt: Number.NaN }),
      request({ expiresAt: 1000 }),
      request({ line: 5 }),
      request({ line: 'x'.repeat(remoteLineMax + 1) }),
      request({ view: '' }),
      request({ big: 1n })
    ]
    for (const raw of invalid) {
      expect(parseCliMessage(raw)).toEqual({ ok: false, code: 'invalid' })
    }
  })

  it('refusedCliRequest reads only the kind, id and origin ids of a refused cli-request or help-request', () => {
    expect(refusedCliRequest(request({ v: 2, line: 5 }))).toEqual({
      kind: 'cli-request',
      id: 'r1',
      grantId: 'g1',
      bindingId: 'b1'
    })
    expect(
      refusedCliRequest(request({ kind: 'help-request', want: 'html' }))
    ).toEqual({
      kind: 'help-request',
      id: 'r1',
      grantId: 'g1',
      bindingId: 'b1'
    })
    for (const raw of [
      null,
      request({ kind: 'cancel' }),
      request({ kind: 'nope' }),
      request({ id: '' }),
      request({ id: 1 }),
      request({ origin: null }),
      request({ origin: { kind: 'cli', grantId: 'g1', bindingId: '' } })
    ]) {
      expect(refusedCliRequest(raw)).toBeUndefined()
    }
  })

  it('cuts data into at most three chunks within 16 KB, between code points', () => {
    const text = JSON.stringify(
      Array.from({ length: 700 }, (_, i) => `satır ${i} ağ 🙂`)
    )
    const chunks = chunkData('r1', text)!
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.length).toBeLessThanOrEqual(remoteChunksMax)
    for (const [index, chunk] of chunks.entries()) {
      expect(chunk).toMatchObject({ index, total: chunks.length })
      expect(remoteBytes(chunk)).toBeLessThanOrEqual(envelopeMaxBytes)
      expect(chunk.bytes).toBe(new TextEncoder().encode(chunk.data).length)
      expect(encodeURIComponent(chunk.data)).toBeTruthy()
    }
    expect(chunks.map(chunk => chunk.data).join('')).toBe(text)
    expect(chunkData('r1', '')).toEqual([])
    expect(chunkData('r1', '"'.repeat(30_000))).toBeUndefined()
  })

  it('joins the chunks of a result, or nothing when one is missing or wrong', () => {
    const text = JSON.stringify('ğ'.repeat(12_000))
    const chunks = chunkData('r1', text)!
    const finished: FinishedReply = {
      v: 1,
      kind: 'finished',
      id: 'r1',
      outcome: { status: 'ok' },
      chunks: chunks.length,
      bytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0)
    }
    expect(joinChunks(finished, [...chunks].reverse())).toBe(text)
    expect(joinChunks(finished, chunks.slice(1))).toBeUndefined()
    expect(joinChunks(finished, [chunks[0], chunks[0]])).toBeUndefined()
    expect(
      joinChunks({ ...finished, bytes: finished.bytes + 1 }, chunks)
    ).toBeUndefined()
    expect(
      joinChunks(finished, [{ ...chunks[0], bytes: 1 }, ...chunks.slice(1)])
    ).toBeUndefined()
    expect(
      joinChunks(finished, [{ ...chunks[0], total: 9 }, ...chunks.slice(1)])
    ).toBeUndefined()
  })

  it('isCliReply knows the shape of each reply', () => {
    const replies = [
      {
        v: 1,
        kind: 'help-result',
        id: 'h',
        status: 'error',
        code: 'unknown-command',
        class: 'usage',
        suggest: ['tasks.list']
      },
      {
        v: 1,
        kind: 'received',
        id: 'r',
        hidden: true,
        dataAgeMs: null,
        change: false,
        viewRelevant: true
      },
      { v: 1, kind: 'awaiting-approval', id: 'r', expiresAt: 5 },
      { v: 1, kind: 'chunk', id: 'r', index: 0, total: 1, bytes: 1, data: 'x' },
      {
        v: 1,
        kind: 'finished',
        id: 'r',
        outcome: { status: 'ok' },
        chunks: 0,
        bytes: 0
      },
      { v: 1, kind: 'cancel-requested', id: 'r' },
      { v: 1, kind: 'cancelled-before-start', id: 'r' }
    ]
    for (const reply of replies) {
      expect(isCliReply(reply)).toBe(true)
    }
    const wrong = [
      null,
      { v: 2, kind: 'received', id: 'r', hidden: true, dataAgeMs: null },
      { v: 1, kind: 'other', id: 'r' },
      { ...replies[0], text: ['a'], result: {} },
      { ...replies[0], suggest: 'tasks.list' },
      { ...replies[1], hidden: 'no' },
      { ...replies[1], change: undefined },
      { ...replies[2], expiresAt: -1 },
      { ...replies[3], index: 0.5 },
      { ...replies[4], outcome: { status: '' } },
      { ...replies[4], next: [1] },
      { ...replies[4], help: '' },
      { ...replies[5], id: '' },
      { ...replies[3], data: 'x'.repeat(envelopeMaxBytes) }
    ]
    for (const reply of wrong) {
      expect(isCliReply(reply)).toBe(false)
    }
  })
})

describe('C-105 Error class', () => {
  it('gives each error code its class; cancelled is its own', () => {
    expect(errorClassOf('invalid-args')).toBe('usage')
    expect(errorClassOf('not-allowed')).toBe('denied')
    expect(errorClassOf('not-delivered')).toBe('not-run')
    expect(errorClassOf('unknown-outcome')).toBe('unknown')
    expect(errorClassOf('failed')).toBe('failed')
    expect(errorClassOf('cancelled')).toBe('cancelled')
  })
})

describe('C-106 CLI request argv', () => {
  const argvRequest = (argv: unknown, extra: Record<string, unknown> = {}) =>
    request({ line: undefined, argv, ...extra })

  it('reads an argv request, a copy of its items', () => {
    const argv = ['tasks.stop', '--id', '8812']
    const parsed = parseCliMessage(argvRequest(argv, { view: 'v1' }))
    expect(parsed).toEqual({
      ok: true,
      message: {
        v: 1,
        kind: 'cli-request',
        id: 'r1',
        argv,
        view: 'v1',
        ...stamp
      }
    })
    expect(
      parsed.ok && 'argv' in parsed.message && parsed.message.argv
    ).not.toBe(argv)
  })

  it('takes exactly one of argv and line', () => {
    expect(parseCliMessage(request({ argv: ['search'] }))).toEqual({
      ok: false,
      code: 'invalid'
    })
    expect(parseCliMessage(request({ line: undefined }))).toEqual({
      ok: false,
      code: 'invalid'
    })
  })

  it('keeps argv within 256 items and 4000 code points, its name not empty', () => {
    const ok = (argv: unknown) => parseCliMessage(argvRequest(argv)).ok
    expect(remoteArgvMaxItems).toBe(256)
    expect(ok(['a', ...Array<string>(remoteArgvMaxItems - 1).fill('')])).toBe(
      true
    )
    expect(ok(['a', ...Array<string>(remoteArgvMaxItems).fill('')])).toBe(false)
    expect(ok(['a', 'x'.repeat(remoteLineMax - 1)])).toBe(true)
    expect(ok(['a', 'x'.repeat(remoteLineMax)])).toBe(false)
    expect(ok(['a', '🙂'.repeat(remoteLineMax - 1)])).toBe(true)
    expect(ok([])).toBe(false)
    expect(ok([''])).toBe(false)
    expect(ok(['a', 1])).toBe(false)
    expect(ok('a')).toBe(false)
  })
})

describe('C-107 Help envelopes', () => {
  const help = (extra: Record<string, unknown> = {}) => ({
    v: 1,
    kind: 'help-request',
    id: 'h1',
    argv: ['tasks'],
    want: 'text',
    ...stamp,
    ...extra
  })

  it('reads a help-request; a width outside 20 to 400 is dropped', () => {
    expect(parseCliMessage(help({ width: 120, extra: 1 }))).toEqual({
      ok: true,
      message: help({ width: 120 })
    })
    expect(parseCliMessage(help({ argv: [], want: 'json' }))).toEqual({
      ok: true,
      message: help({ argv: [], want: 'json' })
    })
    for (const width of [19, 401, 80.5, '80']) {
      expect(parseCliMessage(help({ width }))).toEqual({
        ok: true,
        message: help()
      })
    }
  })

  it('refuses a help-request without argv or with another want', () => {
    for (const raw of [
      help({ argv: undefined }),
      help({ argv: ['x'.repeat(remoteLineMax + 1)] }),
      help({ want: 'html' }),
      help({ want: undefined })
    ]) {
      expect(parseCliMessage(raw)).toEqual({ ok: false, code: 'invalid' })
    }
  })

  it('isCliReply takes a help-result with text or result, not both', () => {
    const reply = { v: 1, kind: 'help-result', id: 'h1', status: 'ok' }
    expect(isCliReply({ ...reply, text: ['tasks.list  Lists tasks'] })).toBe(
      true
    )
    expect(isCliReply({ ...reply, result: { commands: [] } })).toBe(true)
    expect(isCliReply({ ...reply, text: [1] })).toBe(false)
  })
})

describe('C-108 Capabilities parts', () => {
  const payload = (count: number): CapabilitiesPayload => ({
    envelopes: [...remoteEnvelopes],
    features: [...remoteFeatures],
    revision: 'a1b2c3d4',
    sensitive: ['login'],
    commands: Array.from({ length: count }, (_, i) => ({
      name: `ns.command-ğ-${i}`,
      aliases: [`c${i}`],
      danger: i % 2 === 0 ? 'read' : 'change'
    }))
  })

  it('names the features and envelopes of this version', () => {
    expect(remoteEnvelopes).toEqual([1])
    expect(remoteFeatures).toEqual([
      'argv',
      'received-v2',
      'suggest-argv',
      'help-v2',
      'error-class',
      'capabilities-v2',
      'effect',
      'dry-run',
      'approval'
    ])
  })

  it('cuts the JSON into one to three parts of 16 KB, the head first', () => {
    const one = capabilitiesParts({ ...payload(2), minCli: '0.3.0' })
    expect(one).toHaveLength(1)
    expect(Object.keys(JSON.parse(one[0]) as object)).toEqual([
      'envelopes',
      'features',
      'minCli',
      'revision',
      'sensitive',
      'commands'
    ])
    const many = capabilitiesParts(payload(500))
    expect(many.length).toBeGreaterThan(1)
    expect(many.length).toBeLessThanOrEqual(remoteChunksMax)
    for (const part of many) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(
        envelopeMaxBytes
      )
    }
    expect(many[0].startsWith('{"envelopes":[1],"features":')).toBe(true)
    expect(readCapabilitiesParts(many)).toEqual(payload(500))
  })

  it('throws when the list does not fit in three parts', () => {
    expect(() => capabilitiesParts(payload(3000))).toThrow(RangeError)
  })

  it('reads the parts back, an unknown danger as change, or nothing', () => {
    const text = JSON.stringify({
      ...payload(1),
      future: true,
      commands: [{ name: 'a', aliases: [], danger: 'explosive', more: 1 }]
    })
    expect(readCapabilitiesParts([text.slice(0, 10), text.slice(10)])).toEqual({
      ...payload(0),
      commands: [{ name: 'a', aliases: [], danger: 'change' }]
    })
    for (const parts of [
      [],
      ['{', '"', '}', ''],
      ['{'],
      ['[]'],
      [1],
      [JSON.stringify({ ...payload(1), revision: '' })],
      [JSON.stringify({ ...payload(1), minCli: 3 })],
      [JSON.stringify({ ...payload(1), envelopes: [1.5] })],
      ['"' + 'x'.repeat(envelopeMaxBytes) + '"']
    ]) {
      expect(readCapabilitiesParts(parts)).toBeUndefined()
    }
  })
})

describe('C-115 Command effect', () => {
  const base = {
    envelopes: [1],
    features: [...remoteFeatures],
    revision: 'a1b2c3d4',
    sensitive: []
  }

  it('capabilitiesParts writes the effect of a change command and never of a read one', () => {
    const [part] = capabilitiesParts({
      ...base,
      commands: [
        { name: 'nav.go', aliases: [], danger: 'change', effect: 'screen' },
        { name: 'tasks.stop', aliases: [], danger: 'change' },
        { name: 'search', aliases: [], danger: 'read', effect: 'server' }
      ]
    })
    expect((JSON.parse(part) as CapabilitiesPayload).commands).toEqual([
      { name: 'nav.go', aliases: [], danger: 'change', effect: 'screen' },
      { name: 'tasks.stop', aliases: [], danger: 'change' },
      { name: 'search', aliases: [], danger: 'read' }
    ])
  })

  it('readCapabilitiesParts keeps a given effect, reads an unknown one as server and drops it on a read', () => {
    const text = JSON.stringify({
      ...base,
      commands: [
        { name: 'a', aliases: [], danger: 'change', effect: 'screen' },
        { name: 'b', aliases: [], danger: 'change', effect: 'cluster' },
        { name: 'c', aliases: [], danger: 'change' },
        { name: 'd', aliases: [], danger: 'read', effect: 'screen' }
      ]
    })
    expect(readCapabilitiesParts([text])?.commands).toEqual([
      { name: 'a', aliases: [], danger: 'change', effect: 'screen' },
      { name: 'b', aliases: [], danger: 'change', effect: 'server' },
      { name: 'c', aliases: [], danger: 'change' },
      { name: 'd', aliases: [], danger: 'read' }
    ])
    const bad = JSON.stringify({
      ...base,
      commands: [{ name: 'a', aliases: [], danger: 'change', effect: 1 }]
    })
    expect(readCapabilitiesParts([bad])).toBeUndefined()
  })
})

describe('C-118 Approval field', () => {
  const finished: FinishedReply = {
    v: 1,
    kind: 'finished',
    id: 'r1',
    outcome: { status: 'ok', summary: 'stopped' },
    chunks: 0,
    bytes: 0
  }

  it('isCliReply takes a finished with an approval string, a value it does not know included', () => {
    for (const approval of ['card', 'none', 'token']) {
      expect(isCliReply({ ...finished, approval })).toBe(true)
    }
    for (const approval of ['', 1, true, null]) {
      expect(isCliReply({ ...finished, approval })).toBe(false)
    }
  })
})
