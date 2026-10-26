import { describe, expect, it, vi } from 'vitest'

import {
  createConsole,
  type CommandRequest,
  type Console,
  type RunContext,
  type RunInfo
} from '@dolusoft/command-console-core'
import type { CommandResponse, ConsoleEntry } from '@dolusoft/command-protocol'

import {
  command,
  ctrlC,
  deferred,
  enter,
  flush,
  key,
  outputs,
  returning,
  withoutIds
} from './helpers'

const typeAndEnter = (console: Console, line: string) => {
  console.setInput(line)
  return console.handleKey(enter)
}

describe('C-09 Submit', () => {
  it('Enter ends the line with the prompt and the trimmed text, then clears the input', async () => {
    const console = createConsole({
      commands: [returning('hi', 'hello')],
      prompt: '$'
    })
    console.setInput('  hi  ')
    expect(console.handleKey(enter)).toBe(true)
    await flush()
    expect(withoutIds(console.getState().entries)).toEqual([
      {
        kind: 'input',
        prompt: '$',
        text: 'hi',
        redacted: false,
        status: 'submitted'
      },
      {
        kind: 'output',
        tone: 'default',
        blocks: [{ type: 'text', text: 'hello' }],
        inputId: 'c1'
      }
    ])
    expect(console.getState().input).toEqual({
      value: '',
      caret: 0,
      revision: 0
    })
  })

  it('an empty line adds an empty input entry and nothing else', async () => {
    const run = vi.fn()
    const beforeRun = vi.fn()
    const console = createConsole({ commands: [command('a', run)], beforeRun })
    console.setInput('   ')
    console.handleKey(enter)
    await flush()
    expect(withoutIds(console.getState().entries)).toEqual([
      {
        kind: 'input',
        prompt: '>',
        text: '',
        redacted: false,
        status: 'submitted'
      }
    ])
    expect(console.getState().input.value).toBe('')
    expect(console.getState().running).toBeNull()
    expect(run).not.toHaveBeenCalled()
    expect(beforeRun).not.toHaveBeenCalled()
  })
})

describe('C-11 Unterminated quote', () => {
  it('gives unterminated-quote with the index and runs nothing', async () => {
    const run = vi.fn()
    const console = createConsole({ commands: [command('echo', run)] })
    expect(await console.run('echo "open')).toBe(true)
    expect(run).not.toHaveBeenCalled()
    const [entry] = outputs(console.getState().entries)
    expect(entry).toMatchObject({
      tone: 'error',
      blocks: [
        { type: 'message', code: 'unterminated-quote', params: { index: 5 } }
      ]
    })
    expect(console.getState().running).toBeNull()
  })
})

describe('C-12 Request', () => {
  it('run gets one request with name, command, args, rest, line and context', async () => {
    const seen: CommandRequest[] = []
    const console = createConsole({
      commands: [
        command(
          'show',
          request => {
            seen.push(request)
          },
          { aliases: ['s'] }
        )
      ]
    })
    await console.run('  s  "a b"\tc\\d  ')
    expect(seen).toEqual([
      {
        name: 's',
        command: 'show',
        args: ['a b', 'c\\d'],
        rest: '"a b"\tc\\d',
        line: 's  "a b"\tc\\d',
        context: []
      }
    ])
  })

  it('a line without arguments has empty args and rest', async () => {
    const seen: CommandRequest[] = []
    const console = createConsole({
      commands: [command('a', request => void seen.push(request))]
    })
    await console.run('a')
    expect(seen[0]).toMatchObject({ args: [], rest: '', line: 'a' })
  })
})

describe('C-13 Lookup', () => {
  it('runs registered names and aliases, matched exactly', async () => {
    const run = vi.fn()
    const console = createConsole({
      commands: [command('config.show', run, { aliases: ['cs'] })]
    })
    await console.run('config.show')
    await console.run('cs')
    expect(run).toHaveBeenCalledTimes(2)
    await console.run('Config.show')
    await console.run('config')
    await console.run('CS')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('an unknown name gives command-not-found with the first token', async () => {
    const console = createConsole({ commands: [command('a')] })
    await console.run('"no pe" x y')
    expect(outputs(console.getState().entries)[0].blocks).toEqual([
      { type: 'message', code: 'command-not-found', params: { name: 'no pe' } }
    ])
  })
})

describe('C-14 beforeRun', () => {
  it('runs inside the run with RunInfo and the signal, phase authorizing', async () => {
    const gate = deferred<undefined>()
    const run = vi.fn(() => 'ran')
    let info!: RunInfo
    let signal!: AbortSignal
    const console = createConsole({
      commands: [command('go', run, { aliases: ['g'] })],
      beforeRun: (runInfo, runSignal) => {
        info = runInfo
        signal = runSignal
        return gate.promise
      }
    })
    const done = console.run('g x')
    expect(info).toEqual({
      runId: 'c2',
      inputId: 'c1',
      name: 'g',
      command: 'go',
      sensitive: false,
      context: []
    })
    expect(signal.aborted).toBe(false)
    expect(console.getState().running).toEqual({
      runId: 'c2',
      command: 'go',
      inputId: 'c1',
      phase: 'authorizing'
    })
    // The input is read-only while authorizing.
    console.setInput('typed')
    expect(console.getState().input.value).toBe('')
    expect(run).not.toHaveBeenCalled()
    gate.resolve(undefined)
    expect(await done).toBe(true)
    expect(run).toHaveBeenCalledOnce()
    expect(console.getState().running).toBeNull()
  })

  it('a synchronous undefined goes on in the same action', async () => {
    const console = createConsole({
      commands: [returning('a', 'x')],
      beforeRun: () => undefined
    })
    const listener = vi.fn()
    console.subscribe(listener)
    await console.run('a')
    expect(listener).toHaveBeenCalledOnce()
    expect(outputs(console.getState().entries)).toHaveLength(1)
  })

  it('false stops silently', async () => {
    const run = vi.fn()
    const onError = vi.fn()
    const console = createConsole({
      commands: [command('a', run)],
      beforeRun: () => Promise.resolve(false as const),
      onError
    })
    expect(await console.run('a')).toBe(true)
    expect(run).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(console.getState().entries.map(e => e.kind)).toEqual(['input'])
    expect(console.getState().running).toBeNull()
  })

  it('a response is handled as the fulfil: effects, then output', async () => {
    const run = vi.fn()
    const console = createConsole({
      commands: [command('a', run)],
      initialState: {
        entries: [{ id: 'w', kind: 'output', tone: 'default', blocks: [] }]
      },
      beforeRun: () => ({
        output: 'denied',
        tone: 'notice',
        effects: [{ type: 'clear' }]
      })
    })
    await console.run('a')
    expect(run).not.toHaveBeenCalled()
    expect(withoutIds(console.getState().entries)).toEqual([
      {
        kind: 'output',
        tone: 'notice',
        blocks: [{ type: 'text', text: 'denied' }],
        inputId: 'c1'
      }
    ])
  })

  it('a throw or a rejection ends the run as failed', async () => {
    const onError = vi.fn()
    const thrown = new Error('auth')
    const sync = createConsole({
      commands: [command('a')],
      beforeRun: () => {
        throw thrown
      },
      onError
    })
    await sync.run('a')
    const async = createConsole({
      commands: [command('a')],
      beforeRun: () => Promise.reject(thrown),
      onError
    })
    await async.run('a')
    await flush()
    expect(onError).toHaveBeenCalledTimes(2)
    for (const console of [sync, async]) {
      expect(outputs(console.getState().entries)[0].blocks).toEqual([
        { type: 'message', code: 'command-failed' }
      ])
      expect(console.getState().running).toBeNull()
    }
  })

  it('Ctrl+C while authorizing interrupts and aborts the signal', async () => {
    let signal!: AbortSignal
    const run = vi.fn()
    const gate = deferred<undefined>()
    const console = createConsole({
      commands: [command('a', run)],
      beforeRun: (_info, runSignal) => {
        signal = runSignal
        return gate.promise
      }
    })
    const done = console.run('a')
    expect(console.handleKey(ctrlC)).toBe(true)
    expect(signal.aborted).toBe(true)
    expect(await done).toBe(true)
    gate.resolve(undefined)
    await flush()
    expect(run).not.toHaveBeenCalled()
  })
})

describe('C-15 Cancel line', () => {
  it('Ctrl+C without a run ends the line as cancelled and clears the input', () => {
    const console = createConsole({ commands: [] })
    console.setInput('half typed ')
    expect(console.handleKey(ctrlC)).toBe(true)
    expect(withoutIds(console.getState().entries)).toEqual([
      {
        kind: 'input',
        prompt: '>',
        text: 'half typed',
        redacted: false,
        status: 'cancelled'
      }
    ])
    expect(console.getState().input.value).toBe('')
  })

  it('an empty input ends as a cancelled empty line', () => {
    const console = createConsole({ commands: [] })
    console.cancel()
    expect(console.getState().entries).toMatchObject([
      { kind: 'input', text: '', status: 'cancelled' }
    ])
  })

  it('Ctrl+C with a selection is left to the browser', () => {
    const console = createConsole({ commands: [] })
    console.setInput('copy me')
    expect(
      console.handleKey(key('c', { ctrlKey: true, selection: 'input' }))
    ).toBe(false)
    expect(
      console.handleKey(key('c', { ctrlKey: true, selection: 'document' }))
    ).toBe(false)
    expect(console.getState().entries).toEqual([])
    expect(console.getState().input.value).toBe('copy me')
  })

  it('Cmd+C is never bound', () => {
    const console = createConsole({ commands: [] })
    console.setInput('x')
    expect(console.handleKey(key('c', { metaKey: true }))).toBe(false)
    expect(console.getState().entries).toEqual([])
  })
})

describe('C-16 Run lock', () => {
  it('while a run exists, Enter does nothing and submit()/run() resolve false', async () => {
    const pending = deferred<string>()
    const other = vi.fn()
    const console = createConsole({
      commands: [command('wait', () => pending.promise), command('b', other)]
    })
    const done = console.run('wait')
    expect(console.handleKey(enter)).toBe(false)
    expect(console.handleKey(key('Tab'))).toBe(false)
    expect(console.handleKey(key('ArrowUp'))).toBe(false)
    expect(await console.submit()).toBe(false)
    expect(await console.run('b')).toBe(false)
    expect(other).not.toHaveBeenCalled()
    // The input stays read-only.
    console.setInput('typed')
    expect(console.getState().input.value).toBe('')
    pending.resolve('done')
    expect(await done).toBe(true)
    console.setInput('typed')
    expect(console.getState().input.value).toBe('typed')
  })

  it.each([
    ['fulfil', (d: ReturnType<typeof deferred<string>>) => d.resolve('x')],
    [
      'reject',
      (d: ReturnType<typeof deferred<string>>) => d.reject(new Error('x'))
    ]
  ])('the input is writable again after a %s', async (_label, settle) => {
    const pending = deferred<string>()
    const console = createConsole({
      commands: [command('wait', () => pending.promise)],
      onError: () => undefined
    })
    const done = console.run('wait')
    settle(pending)
    await done
    expect(console.getState().running).toBeNull()
    console.setInput('again')
    expect(console.getState().input.value).toBe('again')
  })

  it('the input is writable again after a cancel, a reset and a synchronous throw', async () => {
    const pending = deferred<string>()
    const console = createConsole({
      commands: [
        command('wait', () => pending.promise),
        command('bad', () => {
          throw new Error('x')
        })
      ],
      onError: () => undefined
    })
    void console.run('wait')
    console.cancel()
    console.setInput('a')
    expect(console.getState().input.value).toBe('a')
    void console.run('wait')
    console.reset()
    console.setInput('b')
    expect(console.getState().input.value).toBe('b')
    await console.run('bad')
    console.setInput('c')
    expect(console.getState().input.value).toBe('c')
  })
})

describe('C-17 Stale runs', () => {
  it('a settle after an interrupt changes nothing and calls nothing', async () => {
    const pending = deferred<CommandResponse>()
    const onError = vi.fn()
    const onClose = vi.fn()
    const console = createConsole({
      commands: [command('wait', () => pending.promise)],
      onError,
      onClose
    })
    const done = console.run('wait')
    console.cancel()
    await done
    const before = console.getState()
    const listener = vi.fn()
    console.subscribe(listener)
    pending.resolve({
      output: 'late',
      effects: [{ type: 'clear' }, { type: 'close' }]
    })
    await flush()
    expect(console.getState()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('a late rejection does not call onError', async () => {
    const pending = deferred<string>()
    const onError = vi.fn()
    const console = createConsole({
      commands: [command('wait', () => pending.promise)],
      onError
    })
    void console.run('wait')
    console.cancel()
    pending.reject(new Error('late'))
    await flush()
    expect(onError).not.toHaveBeenCalled()
    expect(outputs(console.getState().entries).map(e => e.blocks)).toEqual([
      [{ type: 'message', code: 'interrupted' }]
    ])
  })

  it("a stale run never clears another run's running", async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const console = createConsole({
      commands: [
        command('one', () => first.promise),
        command('two', () => second.promise)
      ]
    })
    void console.run('one')
    console.cancel()
    const done = console.run('two')
    const running = console.getState().running
    expect(running?.command).toBe('two')
    first.resolve('stale')
    await flush()
    expect(console.getState().running).toBe(running)
    second.resolve('fresh')
    await done
    expect(console.getState().running).toBeNull()
  })

  it('a write after the run ended does nothing', async () => {
    let context!: RunContext
    const console = createConsole({
      commands: [
        command('a', (_request, run) => {
          context = run
          return 'done'
        })
      ]
    })
    await console.run('a')
    const before = console.getState()
    context.write('late')
    expect(console.getState()).toBe(before)
  })
})

describe('C-18 Errors', () => {
  it('a throw calls onError with RunInfo and appends command-failed without the text', async () => {
    const error = new Error('db password wrong')
    const onError = vi.fn()
    const console = createConsole({
      commands: [
        command('a', () => {
          throw error
        })
      ],
      onError
    })
    await console.run('a x')
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(error, {
      runId: 'c2',
      inputId: 'c1',
      name: 'a',
      command: 'a',
      sensitive: false,
      context: []
    })
    const entries = outputs(console.getState().entries)
    expect(withoutIds(entries)).toEqual([
      {
        kind: 'output',
        tone: 'error',
        blocks: [{ type: 'message', code: 'command-failed' }],
        inputId: 'c1'
      }
    ])
    expect(JSON.stringify(console.getState())).not.toContain('password')
  })

  it("formatError's response is handled as a fulfil with tone error", async () => {
    const formatError = vi.fn((error: unknown, info: RunInfo) => ({
      output: `failed: ${(error as Error).message} in ${info.command}`,
      effects: [{ type: 'clear' as const }]
    }))
    const console = createConsole({
      commands: [command('a', () => Promise.reject(new Error('boom')))],
      formatError
    })
    await console.run('a')
    expect(formatError).toHaveBeenCalledOnce()
    expect(formatError.mock.calls[0][1]).toMatchObject({ command: 'a' })
    expect(withoutIds(console.getState().entries)).toEqual([
      {
        kind: 'output',
        tone: 'error',
        blocks: [{ type: 'text', text: 'failed: boom in a' }],
        inputId: 'c1'
      }
    ])
  })

  it('formatError may set its own tone', async () => {
    const console = createConsole({
      commands: [
        command('a', () => {
          throw new Error('x')
        })
      ],
      formatError: () => ({ output: 'soft', tone: 'notice' })
    })
    await console.run('a')
    expect(outputs(console.getState().entries)[0].tone).toBe('notice')
  })

  it('a throwing formatError falls back to command-failed', async () => {
    const console = createConsole({
      commands: [
        command('a', () => {
          throw new Error('x')
        })
      ],
      formatError: () => {
        throw new Error('format')
      }
    })
    await console.run('a')
    expect(outputs(console.getState().entries)[0].blocks).toEqual([
      { type: 'message', code: 'command-failed' }
    ])
  })

  it('a throwing onError does not break the run end', async () => {
    const console = createConsole({
      commands: [
        command('a', () => {
          throw new Error('x')
        })
      ],
      onError: () => {
        throw new Error('handler')
      }
    })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      expect(await console.run('a')).toBe(true)
      await new Promise(resolve => setImmediate(resolve))
    } finally {
      process.off('unhandledRejection', unhandled)
    }
    expect(console.getState().running).toBeNull()
    expect(unhandled).toHaveBeenCalledOnce()
  })
})

describe('C-25 Effects', () => {
  it('apply in order before the output: clear plus a banner leaves the banner', async () => {
    const console = createConsole({
      commands: [
        returning('a', 'x'),
        returning('cls', {
          output: 'banner',
          effects: [{ type: 'clear' }]
        })
      ]
    })
    await console.run('a')
    await console.run('cls')
    expect(withoutIds(console.getState().entries)).toEqual([
      {
        kind: 'output',
        tone: 'default',
        blocks: [{ type: 'text', text: 'banner' }],
        inputId: 'c4'
      }
    ])
  })

  it('close calls onClose after the run ended', async () => {
    const seen: unknown[] = []
    const console: Console = createConsole({
      commands: [returning('exit', { effects: [{ type: 'close' }] })],
      onClose: () => seen.push(console.getState().running)
    })
    await console.run('exit')
    expect(seen).toEqual([null])
  })

  it('effects without their feature are ignored', async () => {
    const console = createConsole({
      commands: [
        returning('a', {
          output: 'after',
          effects: [
            { type: 'push-context', frame: { id: 'f', prompt: 'f>' } },
            { type: 'pop-context' },
            { type: 'reset-context' },
            { type: 'clear-recall' }
          ]
        })
      ]
    })
    expect(await console.run('a')).toBe(true)
    expect(console.getState().context).toEqual([])
    expect(console.getPrompt()).toBe('>')
    expect(outputs(console.getState().entries)).toHaveLength(1)
  })

  it('clear and close in one response both apply, in order', async () => {
    const order: string[] = []
    const console: Console = createConsole({
      commands: [
        returning('a', { effects: [{ type: 'close' }, { type: 'clear' }] })
      ],
      onClose: () => order.push(`close:${console.getState().entries.length}`)
    })
    await console.run('a')
    expect(console.getState().entries).toEqual([])
    expect(order).toEqual(['close:0'])
  })
})

describe('C-27 Prompt snapshot', () => {
  it('an input entry keeps the prompt it was ended with', async () => {
    const console = createConsole({ commands: [command('a')], prompt: 'one>' })
    await console.run('a')
    console.setOptions(old => ({ ...old, prompt: 'two>' }))
    console.cancel()
    const inputs = console
      .getState()
      .entries.filter(
        (e): e is Extract<ConsoleEntry, { kind: 'input' }> => e.kind === 'input'
      )
    expect(inputs.map(e => e.prompt)).toEqual(['one>', 'two>'])
    expect(console.getPrompt()).toBe('two>')
  })
})

describe('C-28 Returns', () => {
  it.each([
    ['void', undefined, []],
    ['a string', 'text', [{ type: 'text', text: 'text' }]],
    [
      'a block array',
      [{ type: 'list', items: ['a'] }],
      [{ type: 'list', items: ['a'] }]
    ],
    ['an empty block array', [], []],
    ['a response without output', { tone: 'notice' }, []]
  ] as const)(
    '%s gives the specified entries',
    async (_label, value, blocks) => {
      const console = createConsole({
        commands: [returning('a', value as never)]
      })
      await console.run('a')
      const out = outputs(console.getState().entries)
      expect(out.map(e => e.blocks)).toEqual(blocks.length > 0 ? [blocks] : [])
    }
  )

  it('a response sets tone and quiet', async () => {
    const console = createConsole({
      commands: [
        returning('a', {
          output: [{ type: 'text', text: 'ok' }],
          tone: 'notice',
          quiet: true
        })
      ]
    })
    await console.run('a')
    expect(withoutIds(outputs(console.getState().entries))).toEqual([
      {
        kind: 'output',
        tone: 'notice',
        blocks: [{ type: 'text', text: 'ok' }],
        inputId: 'c1',
        quiet: true
      }
    ])
  })

  it('same content, same entries: sync, async, string, block, response', async () => {
    const shapes = [
      () => 'same',
      () => Promise.resolve('same'),
      () => [{ type: 'text' as const, text: 'same' }],
      () => ({ output: 'same' }),
      () =>
        Promise.resolve({ output: [{ type: 'text' as const, text: 'same' }] })
    ]
    const results = await Promise.all(
      shapes.map(async run => {
        const console = createConsole({ commands: [command('a', run)] })
        await console.run('a')
        return console.getState().entries
      })
    )
    for (const entries of results) {
      expect(entries).toEqual(results[0])
    }
  })
})

describe('C-29 Write', () => {
  it('appends in call order and joins the open action', async () => {
    const console = createConsole({
      commands: [
        command('a', (_request, run) => {
          run.write('one')
          run.write([{ type: 'text', text: 'two' }], 'notice')
          return 'three'
        })
      ]
    })
    const listener = vi.fn()
    console.subscribe(listener)
    await console.run('a')
    expect(listener).toHaveBeenCalledOnce()
    expect(
      outputs(console.getState().entries).map(e => [e.tone, e.blocks[0]])
    ).toEqual([
      ['default', { type: 'text', text: 'one' }],
      ['notice', { type: 'text', text: 'two' }],
      ['default', { type: 'text', text: 'three' }]
    ])
    expect(
      outputs(console.getState().entries).every(e => e.inputId === 'c1')
    ).toBe(true)
  })

  it('an asynchronous write is its own action', async () => {
    const step = deferred<void>()
    const end = deferred<undefined>()
    const console = createConsole({
      commands: [
        command('a', async (_request, run) => {
          await step.promise
          run.write('progress')
          return end.promise
        })
      ]
    })
    const listener = vi.fn()
    const done = console.run('a')
    console.subscribe(listener)
    step.resolve()
    await flush()
    expect(listener).toHaveBeenCalledOnce()
    expect(outputs(console.getState().entries)).toHaveLength(1)
    expect(console.getState().running).not.toBeNull()
    end.resolve(undefined)
    await done
  })

  it('does nothing after the run ended, from an abort listener too', () => {
    const pending = deferred<string>()
    let context!: RunContext
    const console = createConsole({
      commands: [
        command('a', (_request, run) => {
          context = run
          run.signal.addEventListener('abort', () => run.write('in listener'))
          return pending.promise
        })
      ]
    })
    void console.run('a')
    console.cancel()
    context.write('after cancel')
    expect(outputs(console.getState().entries).map(e => e.blocks)).toEqual([
      [{ type: 'message', code: 'interrupted' }]
    ])
  })

  it('an empty write appends nothing', async () => {
    const console = createConsole({
      commands: [
        command('a', (_request, run) => {
          run.write([])
        })
      ]
    })
    await console.run('a')
    expect(outputs(console.getState().entries)).toEqual([])
  })
})

describe('C-57 Interrupt', () => {
  it('invalidates, then aborts, then appends interrupted; cleanup runs once', async () => {
    const pending = deferred<string>()
    const order: string[] = []
    let context!: RunContext
    const console = createConsole({
      commands: [
        command('a', (_request, run) => {
          context = run
          run.signal.addEventListener('abort', () => {
            run.write('from listener')
            order.push(`abort:${String(console.getState().running?.runId)}`)
          })
          return pending.promise
        })
      ]
    })
    const listener = vi.fn()
    const done = console.run('a')
    console.subscribe(listener)
    expect(console.handleKey(ctrlC)).toBe(true)
    expect(context.signal.aborted).toBe(true)
    expect(listener).toHaveBeenCalledOnce()
    expect(order).toEqual(['abort:c2'])
    expect(withoutIds(outputs(console.getState().entries))).toEqual([
      {
        kind: 'output',
        tone: 'notice',
        blocks: [{ type: 'message', code: 'interrupted' }],
        inputId: 'c1'
      }
    ])
    expect(console.getState().running).toBeNull()
    expect(await done).toBe(true)
    // A second cancel cancels the (empty) line, it does not interrupt again.
    console.cancel()
    expect(outputs(console.getState().entries)).toHaveLength(1)
    pending.resolve('late')
    await flush()
    expect(outputs(console.getState().entries)).toHaveLength(1)
  })

  it('reset ends the run without interrupted; dispose too', async () => {
    const pending = deferred<string>()
    let signal!: AbortSignal
    const console = createConsole({
      commands: [
        command('a', (_request, run) => {
          signal = run.signal
          return pending.promise
        })
      ]
    })
    const done = console.run('a')
    console.reset()
    expect(signal.aborted).toBe(true)
    expect(console.getState().entries).toEqual([])
    expect(console.getState().running).toBeNull()
    expect(await done).toBe(true)
  })
})

describe('C-63 run and submit', () => {
  it('submit() ends the live input as Enter does', async () => {
    const run = vi.fn(() => 'x')
    const console = createConsole({ commands: [command('a', run)] })
    console.setInput(' a ')
    expect(await console.submit()).toBe(true)
    expect(run).toHaveBeenCalledOnce()
    expect(console.getState().entries[0]).toMatchObject({ text: 'a' })
  })

  it('run(line) replaces the live input and submits it; revision only if it was not empty', async () => {
    const console = createConsole({ commands: [returning('a', 'x')] })
    await console.run('a')
    expect(console.getState().input.revision).toBe(0)
    console.setInput('draft')
    await console.run('a')
    expect(console.getState().input.revision).toBe(1)
    expect(
      console.getState().entries.filter(e => e.kind === 'input')
    ).toHaveLength(2)
  })

  it('resolves after the end action, or when the line ended when nothing ran', async () => {
    const pending = deferred<string>()
    const console = createConsole({
      commands: [command('wait', () => pending.promise)]
    })
    let resolved = false
    const done = console.run('wait').then(result => {
      resolved = true
      return result
    })
    await flush()
    expect(resolved).toBe(false)
    pending.resolve('x')
    expect(await done).toBe(true)
    expect(outputs(console.getState().entries)).toHaveLength(1)
    expect(await console.run('nope')).toBe(true)
    expect(await console.run('')).toBe(true)
    expect(await console.run('wait "x')).toBe(true)
  })

  it('resolves false when a run already exists, and changes nothing', async () => {
    const pending = deferred<string>()
    const console = createConsole({
      commands: [command('wait', () => pending.promise)]
    })
    void console.run('wait')
    const before = console.getState()
    expect(await console.run('wait')).toBe(false)
    expect(await console.submit()).toBe(false)
    expect(console.getState()).toBe(before)
    pending.resolve('x')
  })

  it('a run that Enter starts resolves through submit the same way', async () => {
    const console = createConsole({ commands: [returning('a', 'x')] })
    expect(typeAndEnter(console, 'a')).toBe(true)
    await flush()
    expect(outputs(console.getState().entries)).toHaveLength(1)
  })
})
