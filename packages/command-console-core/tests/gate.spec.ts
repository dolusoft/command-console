import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  agentTools,
  CommandError,
  contextFeature,
  createConsole,
  type CommandDefinition,
  type CommandRequest,
  type ConsoleGate,
  type ConsoleOptions,
  type RunInfo
} from '@dolusoft/command-console-core'
import {
  dataMaxBytes,
  type CommandOutcome,
  type Envelope,
  type InputSchema
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
    getRandomValues.mockImplementation((bytes: Uint8Array) => {
      bytes.forEach((_, i) => (bytes[i] = i))
      return bytes
    })
    fake.echo()
    await flush()
    void console.run('search --ip c')
    await flush()
    expect(fake.sent[2].id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
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
    expect(await help.execute({})).toEqual({
      namespaces: [
        { name: 'search', count: 1 },
        { name: 'change', count: 1 },
        { name: 'open', count: 1 },
        { name: 'marked', count: 1 }
      ],
      commands: [
        { name: 'search', summary: 'Searches.', danger: 'read' },
        { name: 'change', summary: 'Searches.', danger: 'change' },
        { name: 'open', summary: 'Searches.', danger: 'read' },
        { name: 'marked', summary: 'Searches.', danger: 'read' }
      ]
    })
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
    expect(await run.execute({ line: 'change --ip a' })).toMatchObject({
      status: 'error',
      code: 'not-allowed',
      line: 'change --ip a --limit 50'
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
    for (const [input, message] of [
      [null, 'expected { line } or { command, args?, view? }'],
      ['search', 'expected { line } or { command, args?, view? }'],
      [{}, 'expected { line } or { command, args?, view? }'],
      [{ command: 'search', args: [] }, 'args: expected object'],
      [{ command: 'search', args: null }, 'args: expected object'],
      [{ command: 'search', args: {}, view: 1 }, 'view: expected string']
    ] as const) {
      expect(await tools[2].execute(input)).toEqual({
        status: 'error',
        code: 'invalid-args',
        message
      })
    }
  })
})

describe('C-86 Command error', () => {
  const agent = 'external-agent' as const

  it('a CommandError from run gives its code, with the usual error entry and onError', async () => {
    const errors: unknown[] = []
    const thrown = new CommandError('target-not-found', 'No tab t9.')
    const console = createConsole({
      commands: [
        search(() => {
          throw thrown
        }),
        search(() => Promise.reject(new CommandError('invalid-args')), {
          name: 'later'
        })
      ],
      onError: error => errors.push(error)
    })
    expect(
      await console.request({ line: 'search --ip a', actor: agent })
    ).toEqual({
      status: 'error',
      code: 'target-not-found',
      message: 'No tab t9.'
    })
    expect(
      await console.request({ line: 'later --ip a', actor: agent })
    ).toEqual({ status: 'error', code: 'invalid-args' })
    await flush()
    expect(errors[0]).toBe(thrown)
    expect(errors).toHaveLength(2)
    expect(messagesOf(outputs(console.getState().entries))).toEqual([
      { type: 'message', code: 'command-failed' },
      { type: 'message', code: 'command-failed' }
    ])
  })

  it('a CommandError of another copy of the core is known by its name', async () => {
    class OtherCommandError extends Error {
      readonly code = 'target-not-found'
      constructor() {
        super('No tab t9.')
        this.name = 'CommandError'
      }
    }
    const console = createConsole({
      commands: [
        search(() => {
          throw new OtherCommandError()
        })
      ]
    })
    expect(
      await console.request({ line: 'search --ip a', actor: agent })
    ).toEqual({
      status: 'error',
      code: 'target-not-found',
      message: 'No tab t9.'
    })
  })

  it('formatError still draws the entry of a CommandError', async () => {
    const console = createConsole({
      commands: [
        search(() => {
          throw new CommandError('target-not-found')
        })
      ],
      formatError: () => ({ output: 'no such tab' })
    })
    expect(
      await console.request({ line: 'search --ip a', actor: agent })
    ).toEqual({ status: 'error', code: 'target-not-found' })
    expect(outputs(console.getState().entries)[0]).toMatchObject({
      tone: 'error',
      blocks: [{ type: 'text', text: 'no such tab' }]
    })
  })

  it('a code the command cannot give, and any other error, are failed', async () => {
    const codes = ['busy', 'timeout', 'id-conflict', 'cancelled', 'nope']
    const console = createConsole({
      commands: [
        ...codes.map(code =>
          search(
            () => {
              throw new CommandError(code as 'failed')
            },
            { name: code }
          )
        ),
        search(() => {
          throw new CommandError('failed')
        }),
        search(
          () => {
            throw Object.assign(new Error('x'), { code: 'target-not-found' })
          },
          { name: 'plain' }
        )
      ]
    })
    for (const name of [...codes, 'search', 'plain']) {
      expect(
        await console.request({ line: `${name} --ip a`, actor: agent })
      ).toEqual({ status: 'error', code: 'failed' })
    }
  })

  it('a CommandError from beforeRun, normalize or createEnvelopeId is failed', async () => {
    const before = createConsole({
      commands: [search()],
      beforeRun: () => {
        throw new CommandError('target-not-found')
      }
    })
    const normalized = createConsole({
      commands: [
        search(undefined, {
          normalize: () => {
            throw new CommandError('target-not-found')
          }
        })
      ]
    })
    const ided = createConsole({
      gate: fakeGate().gate,
      commands: [search()],
      createEnvelopeId: () => {
        throw new CommandError('target-not-found')
      }
    })
    for (const console of [before, normalized, ided]) {
      expect(
        await console.request({ line: 'search --ip a', actor: agent })
      ).toEqual({ status: 'error', code: 'failed' })
    }
  })

  it('a gated command that throws a CommandError after its echo gives its code', async () => {
    const { console, fake } = gated({
      commands: [
        search(() => {
          throw new CommandError('target-not-found')
        })
      ]
    })
    const outcome = console.request({ line: 'search --ip a', actor: agent })
    await flush()
    fake.echo()
    expect(await outcome).toEqual({
      status: 'error',
      code: 'target-not-found'
    })
  })

  it('is an Error with its code, its message and its cause', () => {
    const cause = new Error('inner')
    const error = new CommandError('invalid-args', 'Bad view.', { cause })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('CommandError')
    expect(error.code).toBe('invalid-args')
    expect(error.message).toBe('Bad view.')
    expect(error.cause).toBe(cause)
    expect(new CommandError('failed').message).toBe('failed')
  })
})

describe('C-87 Error response', () => {
  const agent = 'external-agent' as const

  it('a response with tone error from run is failed, without its summary, and is still applied', async () => {
    const console = createConsole({
      commands: [
        search(() => ({
          output: 'No such view.',
          tone: 'error',
          summary: '0 rows'
        }))
      ]
    })
    expect(
      await console.request({ line: 'search --ip a', actor: agent })
    ).toEqual({ status: 'error', code: 'failed' })
    expect(outputs(console.getState().entries)).toMatchObject([
      { tone: 'error', blocks: [{ type: 'text', text: 'No such view.' }] }
    ])
  })

  it('a response with tone error from beforeRun is failed', async () => {
    const console = createConsole({
      commands: [search()],
      beforeRun: () => ({ output: 'Denied.', tone: 'error' })
    })
    expect(
      await console.request({ line: 'search --ip a', actor: agent })
    ).toEqual({ status: 'error', code: 'failed' })
  })

  it('a gated command whose response has tone error is failed', async () => {
    const { console, fake } = gated({
      commands: [
        search(() => Promise.resolve({ output: 'x', tone: 'error' as const }))
      ]
    })
    const outcome = console.request({ line: 'search --ip a', actor: agent })
    await flush()
    fake.echo()
    expect(await outcome).toEqual({ status: 'error', code: 'failed' })
  })

  it('a response with another tone, or none, is ok', async () => {
    const console = createConsole({
      commands: [
        search(() => ({ output: 'x', tone: 'notice', summary: 'n' })),
        search(() => ({ output: 'x', tone: 'default' }), { name: 'plain' }),
        search(() => 'x', { name: 'text' })
      ]
    })
    expect(
      await console.request({ line: 'search --ip a', actor: agent })
    ).toEqual({ status: 'ok', summary: 'n' })
    expect(
      await console.request({ line: 'plain --ip a', actor: agent })
    ).toEqual({ status: 'ok' })
    expect(
      await console.request({ line: 'text --ip a', actor: agent })
    ).toEqual({ status: 'ok' })
  })
})

describe('C-88 Data', () => {
  const agent = 'external-agent' as const
  const ask = (
    console: Pick<ReturnType<typeof createConsole>, 'request'>,
    name = 'search'
  ) => console.request({ line: `${name} --ip a`, actor: agent })

  it('data reaches the ok outcome as a copy, next to the summary, and is never drawn', async () => {
    const rows = [
      { ip: 'a', hits: 3 },
      { ip: 'b', hits: null }
    ]
    const console = createConsole({
      commands: [
        search(() => ({ output: 'two rows', summary: '2 rows', data: rows }))
      ]
    })
    const outcome = await ask(console)
    expect(outcome).toEqual({ status: 'ok', summary: '2 rows', data: rows })
    rows[0].ip = 'z'
    expect(outcome).toMatchObject({ data: [{ ip: 'a', hits: 3 }, {}] })
    expect(outputs(console.getState().entries)).toMatchObject([
      { tone: 'default', blocks: [{ type: 'text', text: 'two rows' }] }
    ])
    expect(JSON.stringify(console.getState())).not.toContain('hits')
  })

  it('a falsy JSON value is data; no data, or undefined, leaves it out', async () => {
    const console = createConsole({
      commands: [
        search(() => ({ data: 0 })),
        search(() => ({ data: null }), { name: 'nothing' }),
        search(() => ({ summary: 's' }), { name: 'plain' }),
        search(() => ({ data: undefined }), { name: 'undef' })
      ]
    })
    expect(await ask(console)).toEqual({ status: 'ok', data: 0 })
    expect(await ask(console, 'nothing')).toEqual({ status: 'ok', data: null })
    const plain = await ask(console, 'plain')
    expect(plain).toEqual({ status: 'ok', summary: 's' })
    expect(plain).not.toHaveProperty('data')
    const undef = await ask(console, 'undef')
    expect(undef).toEqual({ status: 'ok' })
    expect(undef).not.toHaveProperty('data')
  })

  it('data over dataMaxBytes is too-large, and the output is still drawn', async () => {
    // 'ü' is two UTF-8 bytes: within the limit in code units, over it in bytes.
    const limit = dataMaxBytes - 2
    const console = createConsole({
      commands: [
        search(() => ({
          output: 'big',
          summary: 'big',
          data: 'ü'.repeat(limit / 2 + 1)
        })),
        search(() => ({ data: 'a'.repeat(limit) }), { name: 'fits' })
      ]
    })
    expect(await ask(console)).toEqual({ status: 'error', code: 'too-large' })
    expect(outputs(console.getState().entries)).toMatchObject([
      { tone: 'default', blocks: [{ type: 'text', text: 'big' }] }
    ])
    expect(await ask(console, 'fits')).toEqual({
      status: 'ok',
      data: 'a'.repeat(limit)
    })
  })

  it('counts UTF-8 bytes: non-ASCII data at the limit fits, one byte over is too-large', async () => {
    // A JSON string is its two quotes plus the text; 'ü' is two bytes.
    const at = 'ü'.repeat((dataMaxBytes - 2) / 2)
    const console = createConsole({
      commands: [
        search(() => ({ data: at })),
        search(() => ({ data: `${at}a` }), { name: 'over' })
      ]
    })
    expect(await ask(console)).toEqual({ status: 'ok', data: at })
    expect(await ask(console, 'over')).toEqual({
      status: 'error',
      code: 'too-large'
    })
  })

  it('-0 is data and reads back as 0', async () => {
    const console = createConsole({ commands: [search(() => ({ data: -0 }))] })
    const outcome = await ask(console)
    expect(outcome.status).toBe('ok')
    expect(Object.is((outcome as { data: unknown }).data, 0)).toBe(true)
  })

  it('a getter that changes between reads is too-large, the output is drawn, nothing rejects', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    // Each value is JSON on its first read and something else after it.
    const later: (() => unknown)[] = [
      () => {
        throw new Error('gone')
      },
      () => () => 1,
      () => undefined,
      () => Number.NaN,
      () => 'x'.repeat(1_000_000)
    ]
    const reads: number[] = later.map(() => 0)
    const changing = (i: number) => ({
      get rows(): unknown {
        reads[i]++
        return reads[i] === 1 ? 1 : later[i]()
      }
    })
    const console = createConsole({
      commands: later.flatMap((_, i) => [
        search(() => ({ output: `s${i}`, data: changing(i) }) as never, {
          name: `s${i}`
        }),
        search(
          () =>
            Promise.resolve({ output: `a${i}`, data: changing(i) }) as never,
          { name: `a${i}` }
        )
      ])
    })
    try {
      for (let i = 0; i < later.length; i++) {
        for (const name of [`s${i}`, `a${i}`]) {
          reads[i] = 0
          expect(await ask(console, name)).toEqual({
            status: 'error',
            code: 'too-large'
          })
          expect(reads[i]).toBeLessThanOrEqual(2)
        }
      }
      await flush()
      expect(
        outputs(console.getState().entries).map(entry => entry.blocks)
      ).toEqual(
        later.flatMap((_, i) => [
          [{ type: 'text', text: `s${i}` }],
          [{ type: 'text', text: `a${i}` }]
        ])
      )
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('data that is not JSON is too-large', async () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const values: unknown[] = [
      { a: undefined },
      [1, undefined],
      () => 1,
      10n,
      cycle,
      new Date(0),
      Number.NaN,
      {
        get a() {
          throw new Error('x')
        }
      },
      new Array<number>(3),
      { toJSON: () => 1 }
    ]
    const console = createConsole({
      commands: values.map((data, i) =>
        search(() => ({ data }) as never, { name: `c${i}` })
      )
    })
    for (let i = 0; i < values.length; i++) {
      expect(await ask(console, `c${i}`)).toEqual({
        status: 'error',
        code: 'too-large'
      })
    }
  })

  it('the summary is still cut, and an error tone carries no data', async () => {
    const console = createConsole({
      commands: [
        search(() => ({ summary: '😀'.repeat(250), data: [1] })),
        search(() => ({ tone: 'error', data: [1] }), { name: 'bad' })
      ]
    })
    expect(await ask(console)).toEqual({
      status: 'ok',
      summary: '😀'.repeat(200),
      data: [1]
    })
    expect(await ask(console, 'bad')).toEqual({
      status: 'error',
      code: 'failed'
    })
  })

  it('a gated command and beforeRun hand their data on', async () => {
    const { console, fake } = gated({
      commands: [search(() => Promise.resolve({ data: { n: 1 } }))]
    })
    const outcome = ask(console)
    await flush()
    fake.echo()
    expect(await outcome).toEqual({ status: 'ok', data: { n: 1 } })
    const before = createConsole({
      commands: [search()],
      beforeRun: () => ({ output: 'cached', data: ['c'] })
    })
    expect(await ask(before)).toEqual({ status: 'ok', data: ['c'] })
  })

  it('a line the user types never reads data, even data that is not JSON', async () => {
    const read = vi.fn(() => 1)
    const console = createConsole({
      commands: [
        search(() => ({
          output: 'shown',
          data: {
            get rows() {
              return read()
            }
          }
        }))
      ]
    })
    expect(await console.run('search --ip a')).toBe(true)
    expect(read).not.toHaveBeenCalled()
    expect(outputs(console.getState().entries)).toMatchObject([
      { tone: 'default', blocks: [{ type: 'text', text: 'shown' }] }
    ])
  })

  it('the agent tool run returns data', async () => {
    const console = createConsole({
      commands: [search(() => ({ summary: '1 row', data: [{ ip: 'a' }] }))]
    })
    const [, , run] = agentTools(console, { context: () => ({}) })
    expect(run.description).toContain('data?')
    expect(await run.execute({ line: 'search --ip a' })).toEqual({
      status: 'ok',
      summary: '1 row',
      data: [{ ip: 'a' }]
    })
    expect(await run.execute({ command: 'search', args: { ip: 'a' } })).toEqual(
      { status: 'ok', summary: '1 row', data: [{ ip: 'a' }] }
    )
  })
})
