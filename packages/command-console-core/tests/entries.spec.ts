import { describe, expect, it, vi } from 'vitest'

import { createConsole } from '@dolusoft/command-console-core'
import type { ConsoleEntry } from '@dolusoft/command-protocol'

import { returning } from './helpers'

const out = (id: string): ConsoleEntry => ({
  id,
  kind: 'output',
  tone: 'default',
  blocks: [{ type: 'text', text: id }]
})

describe('C-55 maxEntries and ids', () => {
  it('appending beyond maxEntries drops the oldest in the same action', async () => {
    const console = createConsole({
      commands: [returning('a', 'x')],
      maxEntries: 3,
      initialState: { entries: [out('w1'), out('w2')] }
    })
    const listener = vi.fn()
    console.subscribe(listener)
    await console.run('a')
    expect(listener).toHaveBeenCalledOnce()
    expect(console.getState().entries.map(e => e.id)).toEqual([
      'w2',
      'c1',
      'c3'
    ])
    console.appendEntries([out('n1'), out('n2'), out('n3'), out('n4')])
    expect(console.getState().entries.map(e => e.id)).toEqual([
      'n2',
      'n3',
      'n4'
    ])
  })

  it('a controlled slice gets one updater that already applies the limit', () => {
    const reports: unknown[] = []
    const console = createConsole({
      commands: [],
      maxEntries: 1,
      state: { entries: [out('a')] },
      onEntriesChange: updater => reports.push(updater)
    })
    console.appendEntries([out('b'), out('c')])
    expect(reports).toHaveLength(1)
    const updater = reports[0] as (old: ConsoleEntry[]) => ConsoleEntry[]
    expect(updater([out('a')]).map(e => e.id)).toEqual(['c'])
  })

  it('generated ids skip ids already present', async () => {
    const console = createConsole({
      commands: [returning('a', 'x')],
      initialState: { entries: [out('c1'), out('c2'), out('c4')] }
    })
    await console.run('a')
    expect(
      console
        .getState()
        .entries.slice(3)
        .map(e => e.id)
    ).toEqual(['c3', 'c6'])
  })

  it('appending a duplicate id throws and changes nothing', () => {
    const console = createConsole({
      commands: [],
      initialState: { entries: [out('a')] }
    })
    const before = console.getState()
    expect(() => console.appendEntries([out('b'), out('a')])).toThrow(
      /already present: a/
    )
    expect(() => console.appendEntries([out('x'), out('x')])).toThrow(
      /already present: x/
    )
    expect(console.getState()).toBe(before)
  })

  it('createId replaces the counter; a repeated id throws', async () => {
    let n = 0
    const console = createConsole({
      commands: [returning('a', 'x')],
      createId: () => `id-${n++}`
    })
    await console.run('a')
    expect(console.getState().entries.map(e => e.id)).toEqual(['id-0', 'id-2'])
    const repeating = createConsole({
      commands: [returning('a', 'x')],
      createId: () => 'same'
    })
    // A programming error throws at the call, as appendEntries does.
    expect(() => repeating.run('a')).toThrow(/already in entries/)
  })

  it('clearEntries empties the entries', () => {
    const console = createConsole({
      commands: [],
      initialState: { entries: [out('a')] }
    })
    console.clearEntries()
    expect(console.getState().entries).toEqual([])
  })
})
