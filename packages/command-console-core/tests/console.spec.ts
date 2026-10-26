import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  consoleFeatures,
  createConsole,
  type Console,
  type ConsoleState,
  type OptionalFeatures,
  type RecallFeature,
  type Updater
} from '@dolusoft/command-console-core'
import {
  isJsonValue,
  type CommandResponse,
  type ConsoleEntry,
  type ContextFrame
} from '@dolusoft/command-protocol'

import {
  command,
  ctrlC,
  deepFreeze,
  deferred,
  enter,
  flush,
  returning
} from './helpers'

const resolve = <T>(updater: Updater<T>, old: T): T =>
  typeof updater === 'function' ? (updater as (old: T) => T)(old) : updater

describe('C-01 Plain console', () => {
  it('works with the core features only', async () => {
    const console = createConsole({ commands: [returning('hi', 'hello')] })
    expect(await console.run('hi')).toBe(true)
    expect(console.getState().entries).toHaveLength(2)
  })

  it('has no optional method at run time', () => {
    const console = createConsole({ commands: [] })
    for (const name of [
      'recallPrevious',
      'recallNext',
      'clearRecall',
      'complete',
      'completeNext',
      'completePrevious',
      'acceptCompletion',
      'closeCompletion',
      'pushContext',
      'popContext',
      'resetContext'
    ]) {
      expect(name in console, name).toBe(false)
    }
  })

  it('has no optional method in its type', () => {
    const console = createConsole({ commands: [] })
    // @ts-expect-error recall is not a feature of this console
    expect(console.recallPrevious).toBeUndefined()
    // @ts-expect-error completion is not a feature of this console
    expect(console.complete).toBeUndefined()
    // @ts-expect-error context is not a feature of this console
    expect(console.pushContext).toBeUndefined()
    expectTypeOf(console).toEqualTypeOf<Console>()
  })

  it('types the methods of the features it is given', () => {
    expectTypeOf<Console<{ recallFeature: RecallFeature }>>().toHaveProperty(
      'recallPrevious'
    )
    expectTypeOf<
      Console<{ recallFeature: RecallFeature }>
    >().not.toHaveProperty('pushContext')
    expectTypeOf<Console<OptionalFeatures>>().toHaveProperty('pushContext')
    expectTypeOf<Console<OptionalFeatures>>().toHaveProperty('complete')
  })

  it('consoleFeatures keeps the object and its type', () => {
    const recall = { name: 'recall' } as RecallFeature
    const features = consoleFeatures({ recallFeature: recall })
    expect(features.recallFeature).toBe(recall)
    expectTypeOf(features).toEqualTypeOf<{ recallFeature: RecallFeature }>()
    const empty = consoleFeatures({})
    const console = createConsole({ features: empty, commands: [] })
    // @ts-expect-error an empty feature set adds no method
    expect(console.clearRecall).toBeUndefined()
  })
})

describe('C-02 Features', () => {
  it('merges the feature defaults under the given options', async () => {
    const console = createConsole({ commands: [returning('a', 'x')] })
    expect(console.getPrompt()).toBe('>')
    await console.run('a')
    expect(console.getState().entries[0]).toMatchObject({ prompt: '>' })

    const custom = createConsole({ commands: [], prompt: '$' })
    expect(custom.getPrompt()).toBe('$')
  })

  it('treats an option given as undefined as not given', () => {
    const console = createConsole({ commands: [], prompt: undefined })
    expect(console.getPrompt()).toBe('>')
  })

  it('keeps the defaults across setOptions', () => {
    const console = createConsole({ commands: [], prompt: '$' })
    console.setOptions({ commands: [] })
    expect(console.getPrompt()).toBe('>')
    console.setOptions(old => ({ ...old, prompt: '#' }))
    expect(console.getPrompt()).toBe('#')
  })

  it('throws when setOptions changes the feature set', () => {
    const recall = { name: 'recall' } as RecallFeature
    const console = createConsole({ commands: [] })
    expect(() =>
      console.setOptions({
        commands: [],
        features: { recallFeature: recall }
      } as never)
    ).toThrow(/feature set/)
  })

  it('throws on an unknown feature key', () => {
    expect(() =>
      createConsole({
        commands: [],
        features: { sortingFeature: {} } as never
      })
    ).toThrow(/Unknown feature sortingFeature/)
  })
})

describe('C-03 Inputs never mutated', () => {
  it('works through every action with deep-frozen inputs', async () => {
    const response: CommandResponse = deepFreeze({
      output: [{ type: 'list', items: ['a', 'b'] }],
      effects: [{ type: 'clear' }]
    })
    const blocks = deepFreeze([{ type: 'text', text: 'b' }] as const)
    const pending = deferred<string>()
    const initial: ConsoleEntry[] = deepFreeze([
      {
        id: 'w1',
        kind: 'output',
        tone: 'default',
        blocks: [{ type: 'text', text: 'welcome' }]
      }
    ])
    const options = deepFreeze({
      commands: [
        returning('resp', response),
        returning('blocks', [...blocks]),
        command('wait', () => pending.promise),
        command('bad', () => {
          throw new Error('x')
        })
      ],
      initialState: { entries: initial, recall: ['old'] },
      prompt: '$'
    })
    const console = createConsole(options)
    await console.run('blocks')
    await console.run('bad')
    await console.run('unknown "x')
    await console.run('nope')
    console.setInput('typed')
    console.cancel()
    const waiting = console.run('wait')
    console.cancel()
    pending.resolve('late')
    await waiting
    await console.run('resp')
    console.appendEntries(
      deepFreeze([{ id: 'z', kind: 'output', tone: 'notice', blocks: [] }])
    )
    console.reset()
    expect(console.getState().entries).toEqual(initial)
    expect(console.getState().entries).not.toBe(initial)
    console.dispose()
  })

  it('never writes a controlled slice it reads', async () => {
    const entries: ConsoleEntry[] = deepFreeze([])
    const onEntriesChange = vi.fn()
    const console = createConsole({
      commands: [returning('a', 'x')],
      state: { entries },
      onEntriesChange
    })
    await console.run('a')
    expect(entries).toEqual([])
    expect(onEntriesChange).toHaveBeenCalledOnce()
  })
})

describe('C-04 Controlled slices', () => {
  it('reads a controlled slice from the options; state wins over initialState', () => {
    const controlled: ConsoleEntry[] = [
      {
        id: 's',
        kind: 'input',
        prompt: '>',
        text: 'a',
        redacted: false,
        status: 'submitted'
      }
    ]
    const console = createConsole({
      commands: [],
      initialState: { entries: [] },
      state: { entries: controlled }
    })
    expect(console.getState().entries).toBe(controlled)
  })

  it('reports one updater per action that composes every change', async () => {
    const reports: Updater<ConsoleEntry[]>[] = []
    const console = createConsole({
      commands: [
        command('two', (_request, run) => {
          run.write('a')
          run.write('b')
          return 'c'
        })
      ],
      state: { entries: [] },
      onEntriesChange: updater => reports.push(updater)
    })
    await console.run('two')
    expect(reports).toHaveLength(1)
    const value = resolve(reports[0], [])
    expect(value.map(entry => entry.kind)).toEqual([
      'input',
      'output',
      'output',
      'output'
    ])
    // The updater replays the changes onto any base.
    const base: ConsoleEntry[] = [
      { id: 'x', kind: 'output', tone: 'default', blocks: [] }
    ]
    expect(resolve(reports[0], base)).toHaveLength(5)
    // The slice is not written: the options still win.
    expect(console.getState().entries).toEqual([])
  })

  it('takes the value passed back with setOptions as the next base', async () => {
    let entries: ConsoleEntry[] = []
    const console = createConsole({
      commands: [returning('a', 'x')],
      state: { entries },
      onEntriesChange: updater => {
        // The consumer edits what it accepts: it keeps only the outputs.
        entries = resolve(updater, entries).filter(e => e.kind === 'output')
        console.setOptions(old => ({ ...old, state: { entries } }))
      }
    })
    await console.run('a')
    expect(console.getState().entries).toHaveLength(1)
    await console.run('a')
    expect(console.getState().entries.map(e => e.kind)).toEqual([
      'output',
      'output'
    ])
  })

  it('a rejected report gives the consumer value back on the next tick', async () => {
    const entries: ConsoleEntry[] = []
    const reports: Updater<ConsoleEntry[]>[] = []
    const console = createConsole({
      commands: [returning('a', 'x')],
      state: { entries },
      onEntriesChange: updater => reports.push(updater)
    })
    await console.run('a')
    await flush()
    await console.run('a')
    // Rejected (never passed back): the second action builds on [] again.
    expect(resolve(reports[1], entries)).toHaveLength(2)
    expect(console.getState().entries).toBe(entries)
  })

  it('controls recall and context the same way', () => {
    const recall = ['a']
    const context: ContextFrame[] = [{ id: 'f', prompt: 'f>' }]
    const onRecallChange = vi.fn()
    const onContextChange = vi.fn()
    const console = createConsole({
      commands: [],
      state: { recall, context },
      onRecallChange,
      onContextChange
    })
    expect(console.getState().recall).toBe(recall)
    expect(console.getState().context).toBe(context)
    console.reset()
    expect(
      resolve(onRecallChange.mock.calls[0][0] as Updater<string[]>, recall)
    ).toEqual([])
    expect(onContextChange).toHaveBeenCalledOnce()
  })
})

describe('C-05 Actions', () => {
  it('notifies nothing and calls nothing on creation', () => {
    const callbacks = {
      onEntriesChange: vi.fn(),
      onRecallChange: vi.fn(),
      onContextChange: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
      beforeRun: vi.fn(),
      formatError: vi.fn(),
      isSensitive: vi.fn(),
      createId: vi.fn(() => 'id'),
      shouldRecord: vi.fn()
    }
    const run = vi.fn()
    createConsole({
      commands: [command('a', run)],
      state: { entries: [], recall: [], context: [] },
      ...callbacks
    })
    for (const fn of [...Object.values(callbacks), run]) {
      expect(fn).not.toHaveBeenCalled()
    }
  })

  it('notifies subscribers at most once per action', async () => {
    const console = createConsole({ commands: [returning('a', 'x')] })
    const listener = vi.fn()
    console.subscribe(listener)
    console.setInput('a')
    expect(listener).toHaveBeenCalledTimes(1)
    console.handleKey(enter)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenLastCalledWith(console.getState())
    console.clearEntries()
    console.clearEntries()
    expect(listener).toHaveBeenCalledTimes(3)
    await flush()
  })

  it('stops notifying after unsubscribe', () => {
    const console = createConsole({ commands: [] })
    const listener = vi.fn()
    const stop = console.subscribe(listener)
    stop()
    console.setInput('a')
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps the same state object until the next change', () => {
    const console = createConsole({ commands: [] })
    const first = console.getState()
    expect(console.getState()).toBe(first)
    console.setInput('a')
    expect(console.getState()).not.toBe(first)
  })

  it('a throwing callback does not stop the others or the cleanup', async () => {
    const onError = vi.fn()
    const order: string[] = []
    const console = createConsole({
      commands: [returning('a', { output: 'x', effects: [{ type: 'close' }] })],
      state: { entries: [] },
      onEntriesChange: () => {
        order.push('entries')
        throw new Error('entries callback')
      },
      onClose: () => {
        order.push('close')
        throw new Error('close callback')
      },
      onError
    })
    console.subscribe(() => {
      order.push('first subscriber')
      throw new Error('subscriber')
    })
    console.subscribe(() => order.push('second subscriber'))
    expect(await console.run('a')).toBe(true)
    expect(order).toEqual([
      'entries',
      'close',
      'first subscriber',
      'second subscriber'
    ])
    expect(onError.mock.calls.map(call => (call[0] as Error).message)).toEqual([
      'entries callback',
      'close callback',
      'subscriber'
    ])
    expect(onError.mock.calls.every(call => call[1] === null)).toBe(true)
    expect(console.getState().running).toBeNull()
  })
})

describe('C-06 JSON', () => {
  const roundTrips = (value: unknown) => {
    expect(isJsonValue(value)).toBe(true)
    expect(JSON.parse(JSON.stringify(value))).toEqual(value)
  }

  it('every entry and block the console produces survives a JSON round trip', async () => {
    const pending = deferred<string>()
    const console = createConsole({
      commands: [
        returning('text', 'x'),
        returning('blocks', [{ type: 'json', value: { a: [1, null] } }]),
        returning('quiet', { output: 'q', quiet: true, tone: 'notice' }),
        command('write', (_request, run) => {
          run.write('w')
          run.write([{ type: 'list', items: ['i'] }], 'error')
        }),
        command('fail', () => {
          throw new Error('x')
        }),
        command('wait', () => pending.promise),
        command('secret', () => 'ok', { sensitive: { fromArg: 0 } })
      ]
    })
    for (const line of [
      'text',
      'blocks',
      'quiet',
      'write',
      'fail',
      'nope arg',
      'text "open',
      'secret x',
      'secret "open',
      'Secret x',
      ''
    ]) {
      await console.run(line)
    }
    console.setInput('cancelled line')
    console.cancel()
    const waiting = console.run('wait')
    console.cancel()
    pending.resolve('late')
    await waiting
    const { entries } = console.getState()
    expect(entries.length).toBeGreaterThan(20)
    roundTrips(entries)
    for (const entry of entries) {
      roundTrips(entry)
      expect(Object.values(entry)).not.toContain(undefined)
      if (entry.kind === 'output') {
        for (const block of entry.blocks) {
          expect(Object.values(block)).not.toContain(undefined)
        }
      }
    }
  })

  it('the info, request and state it hands out are JSON', async () => {
    const seen: unknown[] = []
    const console = createConsole({
      commands: [
        command('a', request => {
          seen.push(request)
        })
      ],
      beforeRun: info => {
        seen.push(info)
        return undefined
      }
    })
    await console.run('a "b c" d')
    expect(seen).toHaveLength(2)
    for (const value of seen) {
      roundTrips(value)
    }
    const state: Partial<ConsoleState> = { ...console.getState() }
    roundTrips(state)
    roundTrips(console.getCommands())
  })
})

describe('C-07 Dispose', () => {
  it('invalidates and aborts the running run, then nothing it does counts', async () => {
    const pending = deferred<string>()
    let signal!: AbortSignal
    let write!: (text: string) => void
    const onError = vi.fn()
    const console = createConsole({
      commands: [
        command('wait', (_request, run) => {
          signal = run.signal
          write = text => run.write(text)
          signal.addEventListener('abort', () => run.write('in listener'))
          return pending.promise
        })
      ],
      onError
    })
    const listener = vi.fn()
    console.subscribe(listener)
    const waiting = console.run('wait')
    listener.mockClear()
    console.dispose()
    expect(signal.aborted).toBe(true)
    expect(await waiting).toBe(true)
    write('late')
    pending.reject(new Error('late'))
    await flush()
    expect(onError).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it('runs disposers once, clears state and makes every call a no-op', async () => {
    const console = createConsole({
      commands: [returning('a', 'x')],
      initialState: {
        entries: [{ id: 'w', kind: 'output', tone: 'default', blocks: [] }]
      }
    })
    console.setInput('typed')
    console.dispose()
    console.dispose()
    expect(console.getState().entries).toEqual([])
    expect(console.getState().input.value).toBe('')
    const listener = vi.fn()
    const stop = console.subscribe(listener)
    stop()
    console.setInput('x')
    console.appendEntries([
      { id: 'n', kind: 'output', tone: 'default', blocks: [] }
    ])
    console.clearEntries()
    console.cancel()
    console.reset()
    console.setOptions({ commands: [] })
    expect(await console.submit()).toBe(false)
    expect(await console.run('a')).toBe(false)
    expect(console.handleKey(enter)).toBe(false)
    expect(console.handleKey(ctrlC)).toBe(false)
    expect(console.getCommands()).toEqual([])
    expect(console.isSensitive('a')).toBe(false)
    expect(console.getPrompt()).toBe('')
    expect(console.getState().entries).toEqual([])
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('C-08 Isolation', () => {
  it('two consoles share no state or ids; disposing one leaves the other', async () => {
    const commands = [returning('a', 'x')]
    const one = createConsole({ commands })
    const two = createConsole({ commands })
    await one.run('a')
    await two.run('a')
    // Run ids share the counter: input c1, run c2, output c3.
    expect(one.getState().entries.map(e => e.id)).toEqual(['c1', 'c3'])
    expect(two.getState().entries.map(e => e.id)).toEqual(['c1', 'c3'])
    expect(one.getState().entries).not.toBe(two.getState().entries)
    one.setInput('only one')
    expect(two.getState().input.value).toBe('')
    one.dispose()
    expect(await two.run('a')).toBe(true)
    expect(two.getState().entries).toHaveLength(4)
  })
})

describe('C-24 Initial state', () => {
  it('seeds entries, recall and context only and adds nothing', () => {
    const entries: ConsoleEntry[] = [
      {
        id: 'w',
        kind: 'output',
        tone: 'default',
        blocks: [{ type: 'text', text: 'hi' }]
      }
    ]
    const context: ContextFrame[] = [{ id: 'f', prompt: 'f>' }]
    const console = createConsole({
      commands: [],
      initialState: {
        entries,
        recall: ['x'],
        context,
        // Not a slice initialState takes.
        input: { value: 'typed', caret: 0, revision: 0 }
      } as never
    })
    expect(console.getState()).toEqual({
      entries,
      input: { value: '', caret: 0, revision: 0 },
      running: null,
      recall: ['x'],
      recallCursor: null,
      recallDraft: null,
      completion: null,
      context
    })
  })

  it('starts empty without initialState', () => {
    expect(createConsole({ commands: [] }).getState().entries).toEqual([])
  })
})

describe('C-56 Command names', () => {
  const invalid: [string, unknown][] = [
    ['an empty name', [command('', () => undefined)]],
    ['whitespace', [command('a b', () => undefined)]],
    ['a tab', [command('a\tb', () => undefined)]],
    ['a single quote', [command("a'", () => undefined)]],
    ['a double quote', [command('a"', () => undefined)]],
    ['a duplicate name', [command('a'), command('a')]],
    [
      'an alias equal to a name',
      [command('a'), command('b', undefined, { aliases: ['a'] })]
    ],
    ['a duplicate alias', [command('a', undefined, { aliases: ['x', 'x'] })]],
    ['an invalid alias', [command('a', undefined, { aliases: ['x y'] })]],
    [
      'a negative fromArg',
      [command('a', undefined, { sensitive: { fromArg: -1 } })]
    ],
    [
      'a fractional fromArg',
      [command('a', undefined, { sensitive: { fromArg: 1.5 } })]
    ],
    [
      'a non-object sensitive',
      [command('a', undefined, { sensitive: 'yes' as never })]
    ],
    ['a missing run', [{ name: 'a' }]],
    ['commands that are not an array', 'a']
  ]

  it.each(invalid)('throws at creation for %s', (_label, commands) => {
    expect(() => createConsole({ commands: commands as never })).toThrow()
  })

  it.each(invalid)(
    'throws at setOptions for %s and keeps the old set',
    (_label, commands) => {
      const console = createConsole({ commands: [returning('ok', 'x')] })
      expect(() =>
        console.setOptions({ commands: commands as never })
      ).toThrow()
      expect(console.getCommands().map(c => c.name)).toEqual(['ok'])
    }
  )

  it('accepts dots, case variants and fromArg 0', () => {
    expect(() =>
      createConsole({
        commands: [
          command('config.show'),
          command('Config'),
          command('config', undefined, { sensitive: { fromArg: 0 } })
        ]
      })
    ).not.toThrow()
  })
})

describe('C-60 Nested actions', () => {
  it('two writes and a return in run are one notification, in order', async () => {
    const console = createConsole({
      commands: [
        command('w', (_request, run) => {
          run.write('a')
          run.write('b')
          return 'c'
        })
      ]
    })
    const listener = vi.fn()
    console.subscribe(listener)
    await console.run('w')
    expect(listener).toHaveBeenCalledOnce()
    const { entries } = console.getState()
    expect(entries.map(e => e.kind)).toEqual([
      'input',
      'output',
      'output',
      'output'
    ])
    expect(entries.slice(1).map(e => e.kind === 'output' && e.blocks)).toEqual([
      [{ type: 'text', text: 'a' }],
      [{ type: 'text', text: 'b' }],
      [{ type: 'text', text: 'c' }]
    ])
  })

  it('a method called from run joins the action', async () => {
    const console: Console = createConsole({
      commands: [
        command('m', () => {
          console.appendEntries([
            { id: 'm1', kind: 'output', tone: 'notice', blocks: [] }
          ])
          return 'after'
        })
      ]
    })
    const listener = vi.fn()
    console.subscribe(listener)
    await console.run('m')
    expect(listener).toHaveBeenCalledOnce()
    expect(console.getState().entries.map(e => e.id)).toEqual([
      'c1',
      'm1',
      'c3'
    ])
  })

  it('asynchronous writes are each their own action', async () => {
    const step = deferred<void>()
    const end = deferred<string>()
    const console = createConsole({
      commands: [
        command('a', async (_request, run) => {
          await step.promise
          run.write('one')
          return end.promise
        })
      ]
    })
    const listener = vi.fn()
    console.subscribe(listener)
    const done = console.run('a')
    expect(listener).toHaveBeenCalledTimes(1)
    step.resolve()
    await flush()
    expect(listener).toHaveBeenCalledTimes(2)
    end.resolve('two')
    await done
    expect(listener).toHaveBeenCalledTimes(3)
  })
})

describe('C-61 Same-tick updates', () => {
  it('two actions in one tick build on the last reported value', async () => {
    const entries: ConsoleEntry[] = []
    const reports: Updater<ConsoleEntry[]>[] = []
    const console = createConsole({
      commands: [returning('a', 'x')],
      state: { entries },
      onEntriesChange: updater => reports.push(updater)
    })
    console.appendEntries([
      { id: 'one', kind: 'output', tone: 'default', blocks: [] }
    ])
    console.appendEntries([
      { id: 'two', kind: 'output', tone: 'default', blocks: [] }
    ])
    expect(reports).toHaveLength(2)
    // The second report was built on the first one's value.
    const first = resolve(reports[0], entries)
    expect(resolve(reports[1], first).map(e => e.id)).toEqual(['one', 'two'])
    // Built on the first report, the second appended id does not collide.
    expect(() =>
      console.appendEntries([
        { id: 'one', kind: 'output', tone: 'default', blocks: [] }
      ])
    ).toThrow(/already present/)
    await flush()
    // After the tick, the consumer's own value (still []) is the base again.
    console.appendEntries([
      { id: 'one', kind: 'output', tone: 'default', blocks: [] }
    ])
    expect(reports).toHaveLength(3)
  })

  it('a value passed back with setOptions wins over the last report', () => {
    const reports: Updater<ConsoleEntry[]>[] = []
    const console = createConsole({
      commands: [],
      state: { entries: [] },
      onEntriesChange: updater => reports.push(updater)
    })
    console.appendEntries([
      { id: 'one', kind: 'output', tone: 'default', blocks: [] }
    ])
    const edited: ConsoleEntry[] = [
      { id: 'edited', kind: 'output', tone: 'default', blocks: [] }
    ]
    console.setOptions(old => ({ ...old, state: { entries: edited } }))
    expect(console.getState().entries).toBe(edited)
    // The same tick: an id from the rejected report no longer collides.
    console.appendEntries([
      { id: 'one', kind: 'output', tone: 'default', blocks: [] }
    ])
    expect(() =>
      console.appendEntries([
        { id: 'edited', kind: 'output', tone: 'default', blocks: [] }
      ])
    ).toThrow(/already present/)
  })

  it('setOptions notifies subscribers when a controlled slice changes', () => {
    const console = createConsole({ commands: [], state: { entries: [] } })
    const listener = vi.fn()
    console.subscribe(listener)
    const next: ConsoleEntry[] = [
      { id: 'x', kind: 'output', tone: 'default', blocks: [] }
    ]
    console.setOptions(old => ({ ...old, state: { entries: next } }))
    expect(listener).toHaveBeenCalledOnce()
    expect(console.getState().entries).toBe(next)
  })
})

describe('C-65 getCommands', () => {
  it('lists the specs that are not hidden, in registration order, with aliases', () => {
    const console = createConsole({
      commands: [
        command('show', undefined, {
          aliases: ['s'],
          summary: 'Shows',
          usage: 'show <key>'
        }),
        command('secret', undefined, { hidden: true }),
        command('set', undefined, { sensitive: { fromArg: 1 } }),
        command('exit', undefined, { sensitive: true })
      ]
    })
    expect(console.getCommands()).toEqual([
      { name: 'show', aliases: ['s'], summary: 'Shows', usage: 'show <key>' },
      { name: 'set', aliases: [], sensitive: { fromArg: 1 } },
      { name: 'exit', aliases: [], sensitive: true }
    ])
    for (const spec of console.getCommands()) {
      expect('run' in spec).toBe(false)
    }
  })

  it('follows setOptions', () => {
    const console = createConsole({ commands: [command('a')] })
    console.setOptions({ commands: [command('b'), command('c')] })
    expect(console.getCommands().map(c => c.name)).toEqual(['b', 'c'])
  })
})
