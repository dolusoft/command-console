import { describe, expect, it } from 'vitest'

import {
  chunkData,
  envelopeMaxBytes,
  isCliReply,
  joinChunks,
  parseCliMessage,
  refusedCliRequest,
  remoteBytes,
  remoteChunksMax,
  remoteLineMax,
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

  it('refusedCliRequest reads only the id and origin ids of a refused cli-request', () => {
    expect(refusedCliRequest(request({ v: 2, line: 5 }))).toEqual({
      id: 'r1',
      grantId: 'g1',
      bindingId: 'b1'
    })
    for (const raw of [
      null,
      request({ kind: 'cancel' }),
      request({ kind: 'help-request' }),
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
        kind: 'capabilities',
        bindingId: 'b1',
        envelope: 1,
        commands: [
          { name: 'a', aliases: [], danger: 'change', confirm: 'yes' }
        ],
        sensitive: ['login']
      },
      { v: 1, kind: 'received', id: 'r', hidden: true, dataAgeMs: null },
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
      {
        ...replies[0],
        commands: [{ name: 'a', aliases: [], danger: 'irreversible' }]
      },
      { ...replies[1], hidden: 'no' },
      { ...replies[2], expiresAt: -1 },
      { ...replies[3], index: 0.5 },
      { ...replies[4], outcome: { status: 'maybe' } },
      { ...replies[5], id: '' },
      { ...replies[3], data: 'x'.repeat(envelopeMaxBytes) }
    ]
    for (const reply of wrong) {
      expect(isCliReply(reply)).toBe(false)
    }
  })
})
