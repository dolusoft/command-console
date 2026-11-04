import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  agentTools,
  contextFeature,
  createConsole,
  type CommandDefinition,
  type CommandRequest,
  type ConsoleGate,
  type ConsoleOptions,
  type RunInfo
} from '@dolusoft/command-console-core'
import type {
  CommandOutcome,
  Envelope,
  InputSchema
} from '@dolusoft/command-protocol'

import { command, ctrlC, deferred, enter, flush, outputs } from './helpers'

// A fake gate: `send` records the envelope, the test hands the echo back
// with `deliver` and fires the timers with `tick` (no real clock).
const fakeGate = (tab = 't1') => {
  const sent: Envelope[] = []
  const listeners = new Set<(raw: unknown) => void>()
  const timers: { ms: number; fn: () => void; cancelled: boolean }[] = []
  const sendResult = { next: (): Promise<void> => Promise.resolve() }
  const gate = {
    tab,
    send: vi.fn((envelope: Envelope) => {
      sent.push(envelope)
      return sendResult.next()
    }),
    subscribe: vi.fn((listener: (raw: unknown) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }),
    schedule: vi.fn((ms: number, fn: () => void) => {
      const timer = { ms, fn, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    })
  } satisfies ConsoleGate
  const deliver = (raw: unknown) => {
    for (const listener of [...listeners]) {
      listener(raw)
    }
  }
  return {
    gate,
    sent,
    listeners,
    timers,
    sendResult,
    deliver,
    /** Hands the last envelope back as its echo (a JSON copy). */
    echo: (change: Partial<Envelope> = {}) =>
      deliver({
        ...(JSON.parse(JSON.stringify(sent.at(-1))) as Envelope),
        ...change
      }),
    /** Fires every timer that is not cancelled. */
    tick: () => {
      for (const timer of timers.filter(t => !t.cancelled)) {
        timer.cancelled = true
        timer.fn()
      }
    }
  }
}

const searchInput: InputSchema = {
  type: 'object',
  properties: {
    ip: { type: 'string' },
    limit: { type: 'integer', default: 50 },
    verbose: { type: 'boolean' }
  },
  required: ['ip']
}

/** A described `read` command that records its requests. */
const search = (
  run: CommandDefinition['run'] = () => undefined,
  extra: Partial<CommandDefinition> = {}
): CommandDefinition =>
  command('search', run, {
    input: searchInput,
    danger: 'read',
    summary: 'Searches.',
    ...extra
  })

const ids = () => {
  let next = 0
  return () => `e${++next}`
}

const gated = (
  options: Partial<ConsoleOptions> & { commands: CommandDefinition[] },
  fake = fakeGate()
) => ({
  fake,
  console: createConsole({
    gate: fake.gate,
    createEnvelopeId: ids(),
    ...options
  })
})

const type = (
  console: { setInput(v: string): void; handleKey(k: typeof enter): boolean },
  line: string
) => {
  console.setInput(line)
  console.handleKey(enter)
}

const messagesOf = (entries: ReturnType<typeof outputs>) =>
  entries.flatMap(entry => entry.blocks)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('C-76 Command input and danger', () => {
  it('throws on an input schema outside the subset, naming the command', () => {
    expect(() =>
      createConsole({
        commands: [
          command('a', undefined, {
            input: { type: 'object', additionalProperties: false } as never
          })
        ]
      })
    ).toThrow(/command a: Input schema/)
  })

  it('throws on an unknown danger and a normalize that is not a function', () => {
    expect(() =>
      createConsole({
        commands: [command('a', undefined, { danger: 'delete' as never })]
      })
    ).toThrow(/danger/)
    expect(() =>
      createConsole({
        commands: [command('a', undefined, { normalize: 1 as never })]
      })
    ).toThrow(/normalize/)
  })

  it('checks them again on setOptions', () => {
    const console = createConsole({ commands: [] })
    expect(() =>
      console.setOptions(old => ({
        ...old,
        commands: [command('a', undefined, { danger: 'x' as never })]
      }))
    ).toThrow(/danger/)
  })

  it('getCommands copies input and danger', () => {
    const console = createConsole({
      commands: [search(), command('plain')]
    })
    const [spec, plain] = console.getCommands()
    expect(spec).toEqual({
      name: 'search',
      aliases: [],
      summary: 'Searches.',
      input: searchInput,
      danger: 'read'
    })
    expect(spec.input).not.toBe(searchInput)
    expect(plain).toEqual({ name: 'plain', aliases: [] })
  })
})

describe('C-77 Schema lines', () => {
  it('options that do not match append invalid-args and start no run', async () => {
    const run = vi.fn()
    const beforeRun = vi.fn()
    const console = createConsole({ commands: [search(run)], beforeRun })
    expect(await console.run('search --limit 3')).toBe(true)
    expect(run).not.toHaveBeenCalled()
    expect(beforeRun).not.toHaveBeenCalled()
    expect(console.getState().running).toBeNull()
    expect(outputs(console.getState().entries)).toEqual([
      expect.objectContaining({
        tone: 'error',
        blocks: [
          {
            type: 'message',
            code: 'invalid-args',
            params: { path: 'ip', reason: 'required' }
          }
        ]
      })
    ])
  })

  it('a sensitive line gives invalid-args with a null path', async () => {
    const console = createConsole({
      commands: [search(undefined, { sensitive: true })]
    })
    await console.run('search --secret x')
    expect(messagesOf(outputs(console.getState().entries))).toEqual([
      {
        type: 'message',
        code: 'invalid-args',
        params: { path: null, reason: 'additional' }
      }
    ])
  })

  it('an irreversible command is not allowed from the line, with or without input', async () => {
    const run = vi.fn()
    const beforeRun = vi.fn()
    const fake = fakeGate()
    const console = createConsole({
      gate: fake.gate,
      createEnvelopeId: ids(),
      commands: [
        search(run, { danger: 'irreversible' }),
        command('wipe', run, { danger: 'irreversible' })
      ],
      beforeRun
    })
    await console.run('search --ip a')
    await console.run('search --port 1')
    await console.run('wipe all')
    expect(run).not.toHaveBeenCalled()
    expect(beforeRun).not.toHaveBeenCalled()
    expect(fake.gate.send).not.toHaveBeenCalled()
    const notAllowed = {
      type: 'message',
      code: 'operation-failed',
      params: { code: 'not-allowed' }
    }
    expect(messagesOf(outputs(console.getState().entries))).toEqual([
      notAllowed,
      notAllowed,
      notAllowed
    ])
  })

  it('without a gate the command runs locally with input, view and the canonical line', async () => {
    const requests: CommandRequest[] = []
    const console = createConsole({
      commands: [
        search(request => void requests.push(request), { aliases: ['s'] })
      ],
      activeView: () => 'v1'
    })
    await console.run('s --verbose --ip "10.0.0.5"')
    expect(requests).toEqual([
      {
        name: 's',
        command: 'search',
        args: ['--ip', '10.0.0.5', '--limit', '50', '--verbose'],
        rest: '--ip 10.0.0.5 --limit 50 --verbose',
        line: 'search --ip 10.0.0.5 --limit 50 --verbose',
        context: [],
        input: { ip: '10.0.0.5', limit: 50, verbose: true },
        view: 'v1'
      }
    ])
  })

  it('normalize maps the value before the run, and its result is checked', async () => {
    const requests: CommandRequest[] = []
    const console = createConsole({
      commands: [
        search(request => void requests.push(request), {
          normalize: input => ({ ...input, ip: `ip:${input.ip as string}` })
        })
      ]
    })
    await console.run('search --ip a')
    expect(requests[0].input).toEqual({ ip: 'ip:a', limit: 50 })
    expect(requests[0].line).toBe('search --ip ip:a --limit 50')
  })

  it('a throwing normalize or one with an invalid result fails the run', async () => {
    const onError = vi.fn()
    const run = vi.fn()
    const console = createConsole({
      commands: [
        search(run, {
          normalize: () => {
            throw new Error('boom')
          }
        }),
        command('bad', run, {
          input: searchInput,
          normalize: () => ({ ip: 1 })
        })
      ],
      onError
    })
    await console.run('search --ip a')
    await console.run('bad --ip a')
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError.mock.calls[0][0]).toEqual(new Error('boom'))
    expect((onError.mock.calls[0][1] as RunInfo).command).toBe('search')
    expect(onError.mock.calls[1][0]).toBeInstanceOf(TypeError)
    expect(messagesOf(outputs(console.getState().entries))).toEqual([
      { type: 'message', code: 'command-failed' },
      { type: 'message', code: 'command-failed' }
    ])
  })

  it('with a gate, a command without danger or with sensitive runs locally', async () => {
    const run = vi.fn()
    const { console, fake } = gated({
      commands: [
        command('nodanger', run, { input: searchInput }),
        search(run, { name: 'secret', sensitive: { fromArg: 2 } })
      ]
    })
    await console.run('nodanger --ip a')
    await console.run('secret --ip a')
    expect(run).toHaveBeenCalledTimes(2)
    expect(fake.gate.send).not.toHaveBeenCalled()
  })

  it('with a gate, a line the isSensitive predicate marks runs locally', async () => {
    const run = vi.fn()
    const { console, fake } = gated({
      commands: [search(run)],
      isSensitive: line => line.includes('hidden')
    })
    await console.run('search --ip hidden')
    expect(run).toHaveBeenCalledTimes(1)
    expect(fake.gate.send).not.toHaveBeenCalled()
  })
})

describe('C-78 Gate', () => {
  it('subscribes on the first envelope, never on creation, and only once', async () => {
    const { console, fake } = gated({ commands: [search()] })
    expect(fake.gate.subscribe).not.toHaveBeenCalled()
    expect(fake.gate.schedule).not.toHaveBeenCalled()
    void console.run('search --ip a')
    expect(fake.gate.subscribe).toHaveBeenCalledTimes(1)
    fake.echo()
    await flush()
    void console.run('search --ip b')
    expect(fake.gate.subscribe).toHaveBeenCalledTimes(1)
  })

  it('setOptions with another gate throws; the same gate is kept', () => {
    const { console, fake } = gated({ commands: [] })
    expect(() =>
      console.setOptions(old => ({ ...old, gate: fakeGate().gate }))
    ).toThrow(/gate/)
    expect(() =>
      console.setOptions(old => ({ ...old, gate: fake.gate }))
    ).not.toThrow()
  })

  it('uses crypto.randomUUID by default', async () => {
    const fake = fakeGate()
    const console = createConsole({ gate: fake.gate, commands: [search()] })
    void console.run('search --ip a')
    await flush()
    expect(fake.sent[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('falls back to a v4 UUID from crypto.getRandomValues without crypto.randomUUID', async () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(0xff))
    vi.stubGlobal('crypto', { getRandomValues })
    const fake = fakeGate()
    const console = createConsole({ gate: fake.gate, commands: [search()] })
    void console.run('search --ip a')
    await flush()
    expect(getRandomValues).toHaveBeenCalledTimes(1)
    expect(fake.sent[0].id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    getRandomValues.mockImplementation((bytes: Uint8Array) => bytes.fill(0))
    fake.echo()
    await flush()
    void console.run('search --ip b')
    await flush()
    expect(fake.sent[1].id).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('throws on creation with a gate, no crypto.randomUUID, no crypto.getRandomValues and no createEnvelopeId', () => {
    vi.stubGlobal('crypto', {})
    expect(() =>
      createConsole({ gate: fakeGate().gate, commands: [] })
    ).toThrow(/randomUUID/)
    vi.stubGlobal('crypto', undefined)
    expect(() =>
      createConsole({ gate: fakeGate().gate, commands: [] })
    ).toThrow(/getRandomValues/)
    expect(() =>
      createConsole({
        gate: fakeGate().gate,
        commands: [],
        createEnvelopeId: () => 'x'
      })
    ).not.toThrow()
    expect(() => createConsole({ commands: [] })).not.toThrow()
  })

  it('dispose unsubscribes and cancels the timer', async () => {
    const { console, fake } = gated({ commands: [search()] })
    void console.run('search --ip a')
    await flush()
    expect(fake.listeners.size).toBe(1)
    console.dispose()
    expect(fake.listeners.size).toBe(0)
    expect(fake.timers[0].cancelled).toBe(true)
  })

  it.each([0, -1, NaN, Infinity, '5000', null])(
    'echoTimeoutMs %s throws a TypeError on creation and on setOptions',
    echoTimeoutMs => {
      const fake = fakeGate()
      expect(() =>
        createConsole({
          gate: fake.gate,
          createEnvelopeId: ids(),
          commands: [],
          echoTimeoutMs: echoTimeoutMs as number
        })
      ).toThrow(TypeError)
      const { console } = gated({ commands: [] }, fake)
      expect(() =>
        console.setOptions(old => ({
          ...old,
          echoTimeoutMs: echoTimeoutMs as number
        }))
      ).toThrow(TypeError)
      expect(() =>
        console.setOptions(old => ({ ...old, echoTimeoutMs: 0.5 }))
      ).not.toThrow()
    }
  )

  it('a createEnvelopeId that throws fails the run and sends nothing', async () => {
    const onError = vi.fn()
    const run = vi.fn()
    const fake = fakeGate()
    const console = createConsole({
      gate: fake.gate,
      commands: [search(run)],
      createEnvelopeId: () => {
        throw new Error('no id')
      },
      onError
    })
    expect(await console.run('search --ip a')).toBe(true)
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(fake.gate.send).not.toHaveBeenCalled()
    expect(console.getState().running).toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toEqual(new Error('no id'))
    expect(messagesOf(outputs(console.getState().entries))).toEqual([
      { type: 'message', code: 'command-failed' }
    ])
  })

  it('an id that is already closed fails the run', async () => {
    const onError = vi.fn()
    const fake = fakeGate()
    const console = createConsole({
      gate: fake.gate,
      commands: [search()],
      createEnvelopeId: () => 'same',
      onError
    })
    void console.run('search --ip a')
    fake.tick()
    await flush()
    await console.run('search --ip b')
    await flush()
    expect(fake.sent).toHaveLength(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(messagesOf(outputs(console.getState().entries)).at(-1)).toEqual({
      type: 'message',
      code: 'command-failed'
    })
  })
})

describe('C-79 Envelope', () => {
  it('sends the envelope and keeps the run locked until the echo', async () => {
    const run = vi.fn()
    const { console, fake } = gated({
      commands: [search(run)],
      activeView: () => 'v9'
    })
    const done = console.run('search --ip a')
    await flush()
    expect(fake.sent).toEqual([
      {
        v: 1,
        id: 'e1',
        kind: 'request',
        actor: 'user',
        from: { tab: 't1' },
        target: { tab: 't1', view: 'v9' },
        command: 'search',
        args: { ip: 'a', limit: 50 }
      }
    ])
    expect(run).not.toHaveBeenCalled()
    expect(console.getState().running).toMatchObject({
      command: 'search',
      phase: 'running'
    })
    expect(await console.submit()).toBe(false)
    fake.echo()
    expect(await done).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(console.getState().running).toBeNull()
  })

  it('a line without a view targets the tab', async () => {
    const { console, fake } = gated({ commands: [search()] })
    void console.run('search --ip a')
    await flush()
    expect(fake.sent[0].target).toEqual({ tab: 't1' })
  })

  it.each([
    ['an empty', ''],
    ['a null', null]
  ])(
    '%s view is no view: the envelope and the request carry none',
    async (_, view) => {
      const requests: CommandRequest[] = []
      const fake = fakeGate()
      const console = createConsole({
        gate: fake.gate,
        createEnvelopeId: ids(),
        commands: [search(request => void requests.push(request))],
        activeView: () => view as string
      })
      const typed = console.run('search --ip a')
      await flush()
      fake.echo()
      await typed
      const asked = console.request({
        command: 'search',
        args: { ip: 'b' },
        view: view as string,
        actor: 'external-agent'
      })
      await flush()
      fake.echo()
      expect(await asked).toEqual({ status: 'ok' })
      expect(fake.sent.map(envelope => envelope.target)).toEqual([
        { tab: 't1' },
        { tab: 't1' }
      ])
      expect(requests).toHaveLength(2)
      for (const request of requests) {
        expect(request).not.toHaveProperty('view')
      }
    }
  )

  it('beforeRun is asked once before the send; false sends nothing', async () => {
    const answer = deferred<false | undefined>()
    const beforeRun = vi.fn(() => answer.promise)
    const { console, fake } = gated({ commands: [search()], beforeRun })
    const done = console.run('search --ip a')
    expect(console.getState().running?.phase).toBe('authorizing')
    expect(fake.gate.send).not.toHaveBeenCalled()
    answer.resolve(false)
    expect(await done).toBe(true)
    expect(beforeRun).toHaveBeenCalledTimes(1)
    expect(fake.gate.send).not.toHaveBeenCalled()
  })

  it('an envelope above envelopeMaxBytes is too-large and is not sent', async () => {
    const big: InputSchema = {
      type: 'object',
      properties: { t: { type: 'array', items: { type: 'string' } } }
    }
    const run = vi.fn()
    const { console, fake } = gated({
      commands: [command('big', run, { input: big, danger: 'read' })]
    })
    const line = `big ${Array.from({ length: 20 }, () => `--t ${'x'.repeat(900)}`).join(' ')}`
    await console.run(line)
    expect(fake.gate.send).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(messagesOf(outputs(console.getState().entries))).toEqual([
      {
        type: 'message',
        code: 'operation-failed',
        params: { code: 'too-large' }
      }
    ])
  })

  it('a send that rejects or throws ends the run with connection-lost', async () => {
    const run = vi.fn()
    const { console, fake } = gated({ commands: [search(run)] })
    fake.sendResult.next = () => Promise.reject(new Error('down'))
    expect(await console.run('search --ip a')).toBe(true)
    fake.sendResult.next = () => {
      throw new Error('down')
    }
    expect(await console.run('search --ip b')).toBe(true)
    expect(run).not.toHaveBeenCalled()
    expect(messagesOf(outputs(console.getState().entries))).toEqual([
      {
        type: 'message',
        code: 'operation-failed',
        params: { code: 'connection-lost' }
      },
      {
        type: 'message',
        code: 'operation-failed',
        params: { code: 'connection-lost' }
      }
    ])
  })

  it.each([
    ['subscribe', 'subscribe'],
    ['schedule', 'schedule'],
    ['send', 'send']
  ] as const)(
    'a %s that throws ends the run with connection-lost, in an action of its own',
    async (_, method) => {
      const run = vi.fn()
      const { console, fake } = gated({ commands: [search(run)] })
      fake.gate[method].mockImplementation(() => {
        throw new Error('down')
      })
      const states: (string | null)[] = []
      console.subscribe(state => {
        states.push(state.running?.phase ?? null)
      })
      expect(await console.run('search --ip a')).toBe(true)
      expect(run).not.toHaveBeenCalled()
      expect(console.getState().running).toBeNull()
      // The start of the run and its end: two actions, two notifications.
      expect(states).toEqual([null, null])
      expect(messagesOf(outputs(console.getState().entries))).toEqual([
        {
          type: 'message',
          code: 'operation-failed',
          params: { code: 'connection-lost' }
        }
      ])
      expect(await console.submit()).toBe(true)
    }
  )

  it('no echo within echoTimeoutMs ends the run with timeout', async () => {
    const run = vi.fn()
    const { console, fake } = gated({
      commands: [search(run)],
      echoTimeoutMs: 1234
    })
    const done = console.run('search --ip a')
    await flush()
    expect(fake.timers.map(timer => timer.ms)).toEqual([1234])
    fake.tick()
    expect(await done).toBe(true)
    expect(run).not.toHaveBeenCalled()
    expect(messagesOf(outputs(console.getState().entries))).toEqual([
      { type: 'message', code: 'operation-failed', params: { code: 'timeout' } }
    ])
  })

  it('the default timeout is 5000 ms', async () => {
    const { console, fake } = gated({ commands: [search()] })
    void console.run('search --ip a')
    await flush()
    expect(fake.timers[0].ms).toBe(5000)
  })

  it('a send that rejects after the echo changes nothing', async () => {
    const sent = deferred<void>()
    const output = deferred<string>()
    const { console, fake } = gated({
      commands: [search(() => output.promise)]
    })
    fake.sendResult.next = () => sent.promise
    const done = console.run('search --ip a')
    await flush()
    fake.echo()
    sent.reject(new Error('late'))
    await flush()
    expect(console.getState().running).not.toBeNull()
    output.resolve('done')
    await done
    expect(messagesOf(outputs(console.getState().entries))).toEqual([
      { type: 'text', text: 'done' }
    ])
  })
})

describe('C-80 Echo', () => {
  it('the echo runs the local record, in an action of its own', async () => {
    const requests: CommandRequest[] = []
    const { console, fake } = gated({
      commands: [search(request => void requests.push(request))]
    })
    const done = console.run('search --ip a')
    await flush()
    const listener = vi.fn()
    console.subscribe(listener)
    fake.echo()
    await done
    expect(requests).toHaveLength(1)
    expect(requests[0].input).toEqual({ ip: 'a', limit: 50 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('the transport gets a copy: changing what was sent changes nothing local', async () => {
    const requests: CommandRequest[] = []
    const run = vi.fn((request: CommandRequest) => void requests.push(request))
    const { console, fake } = gated({
      commands: [search(run)],
      activeView: () => 'v1'
    })
    const given: Envelope[] = []
    fake.gate.send.mockImplementation((envelope: Envelope) => {
      given.push(envelope)
      fake.sent.push(JSON.parse(JSON.stringify(envelope)) as Envelope)
      envelope.args.extra = 'x'
      envelope.target.view = 'v2'
      return Promise.resolve()
    })
    const done = console.run('search --ip a')
    await flush()
    fake.echo()
    await done
    expect(run).toHaveBeenCalledTimes(1)
    expect(requests[0].input).toEqual({ ip: 'a', limit: 50 })
    expect(requests[0].input).not.toBe(given[0].args)
    expect(requests[0].view).toBe('v1')
    expect(messagesOf(outputs(console.getState().entries))).toEqual([])
  })

  it('an echo whose args differ closes the operation with id-conflict', async () => {
    const run = vi.fn()
    const onError = vi.fn()
    const { console, fake } = gated({ commands: [search(run)], onError })
    const done = console.run('search --ip a')
    await flush()
    fake.echo({ args: { ip: 'b', limit: 50 } })
    await done
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(onError.mock.calls[0][1]).toMatchObject({ command: 'search' })
    expect(messagesOf(outputs(console.getState().entries))).toEqual([
      {
        type: 'message',
        code: 'operation-failed',
        params: { code: 'id-conflict' }
      }
    ])
  })

  it('a different command or target is an id-conflict too', async () => {
    const run = vi.fn()
    const { console, fake } = gated({
      commands: [search(run), search(run, { name: 'other' })],
      activeView: () => 'v1'
    })
    void console.run('search --ip a')
    await flush()
    fake.echo({ command: 'other' })
    await flush()
    void console.run('search --ip a')
    await flush()
    fake.echo({ target: { tab: 't1', view: 'v2' } })
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(
      messagesOf(outputs(console.getState().entries)).map(
        block => block.type === 'message' && block.params?.code
      )
    ).toEqual(['id-conflict', 'id-conflict'])
  })

  it('an echo whose target.view is null matches a record without a view', async () => {
    const run = vi.fn()
    const { console, fake } = gated({ commands: [search(run)] })
    const done = console.run('search --ip a')
    await flush()
    fake.echo({ target: { tab: 't1', view: null as never } })
    await done
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).not.toHaveProperty('view')
  })

  it('ignores what is not the pending echo', async () => {
    const run = vi.fn()
    const { console, fake } = gated({ commands: [search(run)] })
    void console.run('search --ip a')
    await flush()
    const echo = JSON.parse(JSON.stringify(fake.sent[0])) as Envelope
    fake.deliver('noise')
    fake.deliver({ ...echo, v: 2 })
    fake.deliver({ ...echo, id: 'other' })
    fake.deliver({ ...echo, target: { tab: 't2' }, from: { tab: 't2' } })
    fake.deliver({ ...echo, from: { tab: 't2' } })
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(console.getState().running).not.toBeNull()
    expect(console.getState().entries).toHaveLength(1)
    fake.deliver(echo)
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('C-81 Closed operations', () => {
  it('an echo after the timeout runs nothing', async () => {
    const run = vi.fn()
    const { console, fake } = gated({ commands: [search(run)] })
    void console.run('search --ip a')
    await flush()
    fake.tick()
    fake.echo()
    await flush()
    expect(run).not.toHaveBeenCalled()
  })

  it('cancel while the echo is awaited ends the run as interrupted; the echo runs nothing', async () => {
    const run = vi.fn()
    const { console, fake } = gated({ commands: [search(run)] })
    const done = console.run('search --ip a')
    await flush()
    console.handleKey(ctrlC)
    expect(await done).toBe(true)
    expect(fake.timers[0].cancelled).toBe(true)
    fake.echo()
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(messagesOf(outputs(console.getState().entries))).toEqual([
      { type: 'message', code: 'interrupted' }
    ])
  })

  it('reset while the echo is awaited ends the run without an entry', async () => {
    const run = vi.fn()
    const { console, fake } = gated({ commands: [search(run)] })
    const done = console.run('search --ip a')
    await flush()
    console.reset()
    expect(await done).toBe(true)
    fake.echo()
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(console.getState().entries).toEqual([])
  })

  it('a context change while the echo is awaited interrupts the run', async () => {
    const run = vi.fn()
    const fake = fakeGate()
    const console = createConsole({
      features: { contextFeature },
      gate: fake.gate,
      createEnvelopeId: ids(),
      commands: [search(run)]
    })
    const done = console.run('search --ip a')
    await flush()
    console.pushContext({ id: 'x', prompt: 'x>' })
    expect(await done).toBe(true)
    fake.echo()
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(messagesOf(outputs(console.getState().entries))).toEqual([
      { type: 'message', code: 'interrupted' }
    ])
  })

  it('remembers the last 500 closed ids', async () => {
    const fake = fakeGate()
    const queue = ['old', ...Array.from({ length: 500 }, (_, i) => `n${i}`)]
    const onError = vi.fn()
    const console = createConsole({
      gate: fake.gate,
      commands: [search()],
      createEnvelopeId: () => queue.shift() ?? 'old',
      onError
    })
    for (let i = 0; i < 501; i++) {
      const done = console.run('search --ip a')
      await flush()
      fake.echo()
      await done
    }
    // `old` dropped out of the record: it may be used again.
    const done = console.run('search --ip a')
    await flush()
    fake.echo()
    await done
    expect(fake.sent.at(-1)?.id).toBe('old')
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('C-82 request', () => {
  const agent = 'external-agent' as const

  it('runs a read command for an external agent and resolves ok with the summary', async () => {
    const requests: CommandRequest[] = []
    const console = createConsole({
      commands: [
        search(request => {
          requests.push(request)
          return { output: 'rows', summary: '3 rows' }
        })
      ]
    })
    const outcome = await console.request({
      command: 'search',
      args: { ip: 'a' },
      view: 'v1',
      actor: agent
    })
    expect(outcome).toEqual({ status: 'ok', summary: '3 rows' })
    expect(requests[0]).toMatchObject({
      name: 'search',
      line: 'search --ip a --limit 50',
      input: { ip: 'a', limit: 50 },
      view: 'v1'
    })
    const [entry, out] = console.getState().entries
    expect(entry).toMatchObject({
      kind: 'input',
      text: 'search --ip a --limit 50',
      actor: 'external-agent',
      status: 'submitted'
    })
    expect(out).toMatchObject({ kind: 'output', inputId: entry.id })
  })

  it('a { line } request reads the options and the active view', async () => {
    const fake = fakeGate()
    const console = createConsole({
      gate: fake.gate,
      createEnvelopeId: ids(),
      commands: [search()],
      activeView: () => 'v7'
    })
    const outcome = console.request({ line: 'search --ip a', actor: agent })
    await flush()
    expect(fake.sent[0]).toMatchObject({
      actor: 'external-agent',
      target: { tab: 't1', view: 'v7' }
    })
    fake.echo()
    expect(await outcome).toEqual({ status: 'ok' })
  })

  it('cuts the summary to 200 code points', async () => {
    const console = createConsole({
      commands: [search(() => ({ summary: '😀'.repeat(250) }))]
    })
    const outcome = await console.request({
      line: 'search --ip a',
      actor: agent
    })
    expect(outcome).toEqual({ status: 'ok', summary: '😀'.repeat(200) })
  })

  it('refuses without an entry: busy, unknown, invalid and not allowed', async () => {
    const pending = deferred<undefined>()
    const console = createConsole({
      commands: [
        search(),
        search(undefined, { name: 'change', danger: 'change' }),
        search(undefined, { name: 'gone', danger: 'irreversible' }),
        command('plain'),
        command('nodanger', undefined, { input: searchInput }),
        search(undefined, { name: 'secret', sensitive: { fromArg: 4 } }),
        search(undefined, { name: 'marked' }),
        search(undefined, { name: 'hiddenone', hidden: true }),
        command('slow', () => pending.promise)
      ],
      isSensitive: line => line.startsWith('marked')
    })
    const ask = (input: Parameters<typeof console.request>[0]) =>
      console.request(input)
    const codes: CommandOutcome[] = [
      await ask({ line: '', actor: agent }),
      await ask({ line: 'search "open', actor: agent }),
      await ask({ line: 'nope', actor: agent }),
      await ask({ command: 'nope', args: {}, actor: agent }),
      await ask({ line: 'hiddenone --ip a', actor: agent }),
      await ask({ command: 'hiddenone', args: { ip: 'a' }, actor: agent }),
      await ask({ line: 'plain', actor: agent }),
      await ask({ line: 'nodanger --ip a', actor: agent }),
      await ask({ line: 'secret --ip a', actor: agent }),
      await ask({ line: 'marked --ip a', actor: agent }),
      await ask({ line: 'change --ip a', actor: agent }),
      await ask({ line: 'gone --ip a', actor: agent }),
      await ask({ line: 'search --ip a', actor: 'assistant' }),
      await ask({ line: 'search --ip a', actor: 'user' }),
      await ask({ line: 'search --port 1', actor: agent }),
      await ask({ command: 'search', args: { ip: 1 }, actor: agent })
    ]
    expect(codes.map(o => o.status === 'error' && o.code)).toEqual([
      'invalid-args',
      'invalid-args',
      'unknown-command',
      'unknown-command',
      'unknown-command',
      'unknown-command',
      'not-allowed',
      'not-allowed',
      'not-allowed',
      'not-allowed',
      'not-allowed',
      'not-allowed',
      'not-allowed',
      'not-allowed',
      'invalid-args',
      'invalid-args'
    ])
    expect(console.getState().entries).toEqual([])
    void console.run('slow')
    expect(await ask({ line: 'search --ip a', actor: agent })).toEqual({
      status: 'error',
      code: 'busy'
    })
    expect(console.getState().entries).toHaveLength(1)
  })

  it('resolves failed, cancelled, not-allowed and the gate codes', async () => {
    const pending = deferred<undefined>()
    let refuse = false
    const fake = fakeGate()
    const console = createConsole({
      commands: [
        search(() => {
          throw new Error('x')
        }),
        search(() => pending.promise, { name: 'slow' }),
        search(undefined, { name: 'gated', aliases: [] })
      ],
      beforeRun: () => (refuse ? false : undefined)
    })
    expect(
      await console.request({ line: 'search --ip a', actor: agent })
    ).toEqual({ status: 'error', code: 'failed' })
    const slow = console.request({ line: 'slow --ip a', actor: agent })
    console.cancel()
    expect(await slow).toEqual({ status: 'error', code: 'cancelled' })
    refuse = true
    expect(
      await console.request({ line: 'gated --ip a', actor: agent })
    ).toEqual({ status: 'error', code: 'not-allowed' })

    const withGate = createConsole({
      gate: fake.gate,
      createEnvelopeId: ids(),
      commands: [search()]
    })
    const timedOut = withGate.request({ line: 'search --ip a', actor: agent })
    await flush()
    fake.tick()
    expect(await timedOut).toEqual({ status: 'error', code: 'timeout' })
  })

  it('a line the user types carries no actor', async () => {
    const console = createConsole({ commands: [search()] })
    type(console, 'search --ip a')
    await flush()
    expect(console.getState().entries[0]).not.toHaveProperty('actor')
  })

  it('resolves cancelled after dispose', async () => {
    const console = createConsole({ commands: [search()] })
    console.dispose()
    expect(
      await console.request({ line: 'search --ip a', actor: agent })
    ).toEqual({ status: 'error', code: 'cancelled' })
  })
})

describe('C-83 Agent tools', () => {
  const setup = () => {
    const console = createConsole({
      commands: [
        search(() => ({ summary: 'ok' }), { usage: 'search --ip <ip>' }),
        search(undefined, { name: 'hiddenone', hidden: true }),
        command('plain'),
        search(undefined, { name: 'change', danger: 'change' }),
        search(undefined, { name: 'secret', sensitive: { fromArg: 4 } }),
        search(undefined, { name: 'open', sensitive: false }),
        search(undefined, { name: 'marked' })
      ],
      isSensitive: line => line.startsWith('marked')
    })
    const context = vi.fn(() => ({ tab: 't1', views: [] }))
    return { console, context, tools: agentTools(console, { context }) }
  }

  it('returns context, help and run as plain objects', () => {
    const { tools } = setup()
    expect(tools.map(tool => tool.name)).toEqual(['context', 'help', 'run'])
    expect(tools.map(tool => tool.annotations)).toEqual([
      { readOnlyHint: true, untrustedContentHint: true },
      { readOnlyHint: true },
      { readOnlyHint: true, untrustedContentHint: true }
    ])
    for (const tool of tools) {
      expect(typeof tool.description).toBe('string')
      expect(tool.inputSchema).toMatchObject({ type: 'object' })
      expect(JSON.parse(JSON.stringify(tool.inputSchema))).toEqual(
        tool.inputSchema
      )
    }
  })

  it('context returns what options.context returns; a throw is failed', async () => {
    const { tools, context } = setup()
    expect(await tools[0].execute({})).toEqual({ tab: 't1', views: [] })
    context.mockImplementation(() => {
      throw new Error('x')
    })
    expect(await tools[0].execute({})).toEqual({
      status: 'error',
      code: 'failed'
    })
  })

  it('help lists the described, visible, not sensitive commands or describes one', async () => {
    const { tools } = setup()
    const help = tools[1]
    // `marked` is listed: only a command's own `sensitive` leaves it out.
    expect(await help.execute({})).toEqual([
      { name: 'search', summary: 'Searches.', danger: 'read' },
      { name: 'change', summary: 'Searches.', danger: 'change' },
      { name: 'open', summary: 'Searches.', danger: 'read' },
      { name: 'marked', summary: 'Searches.', danger: 'read' }
    ])
    expect(await help.execute({ command: 'search' })).toEqual({
      name: 'search',
      summary: 'Searches.',
      usage: 'search --ip <ip>',
      danger: 'read',
      input: searchInput
    })
    for (const name of ['plain', 'hiddenone', 'secret', 'nope']) {
      expect(await help.execute({ command: name })).toEqual({
        status: 'error',
        code: 'unknown-command'
      })
    }
  })

  it('run calls request as external-agent and resolves its outcome', async () => {
    const { tools, console } = setup()
    const run = tools[2]
    expect(await run.execute({ line: 'search --ip a' })).toEqual({
      status: 'ok',
      summary: 'ok'
    })
    expect(
      await run.execute({ command: 'search', args: { ip: 'a' }, view: 'v1' })
    ).toEqual({ status: 'ok', summary: 'ok' })
    expect(await run.execute({ line: 'change --ip a' })).toEqual({
      status: 'error',
      code: 'not-allowed'
    })
    expect(await run.execute({ line: 'hiddenone --ip a' })).toEqual({
      status: 'error',
      code: 'unknown-command'
    })
    expect(console.getState().entries[0]).toMatchObject({
      actor: 'external-agent'
    })
  })

  it('run refuses another input with invalid-args and never rejects', async () => {
    const { tools } = setup()
    for (const input of [
      null,
      'search',
      {},
      { command: 'search' },
      { command: 'search', args: [] },
      { command: 'search', args: {}, view: 1 }
    ]) {
      expect(await tools[2].execute(input)).toEqual({
        status: 'error',
        code: 'invalid-args'
      })
    }
  })
})
