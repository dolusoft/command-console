import { describe, expect, it, vi } from 'vitest'

import {
  agentTools,
  createConsole,
  type CommandDefinition,
  type ConsoleGate,
  type ConsoleOptions,
  type RemoteBinding
} from '@dolusoft/command-console-core'
import {
  joinChunks,
  type ChunkReply,
  type CliReply,
  type InputSchema
} from '@dolusoft/command-protocol'

import { command, ctrlC, deferred, flush, outputs } from './helpers'

// A fake gate and clock: the test delivers CLI messages, fires timers and
// moves the clock by hand.
const setup = (
  options: Partial<ConsoleOptions> & { commands: CommandDefinition[] },
  bindingExtra: Partial<RemoteBinding> = {}
) => {
  const listeners = new Set<(raw: unknown) => void>()
  const timers: { ms: number; fn: () => void; cancelled: boolean }[] = []
  const clock = { now: 1_000_000 }
  const gate = {
    tab: 't1',
    send: vi.fn(() => Promise.resolve()),
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
  const replies: CliReply[] = []
  const binding: RemoteBinding = {
    bindingId: 'b1',
    grantId: 'g1',
    approvedAt: 900_000,
    send: reply => {
      replies.push(JSON.parse(JSON.stringify(reply)) as CliReply)
    },
    ...bindingExtra
  }
  const console = createConsole({
    gate,
    createEnvelopeId: () => 'e1',
    now: () => clock.now,
    ...options
  })
  let next = 0
  const deliver = (raw: unknown) => {
    for (const listener of [...listeners]) {
      listener(raw)
    }
  }
  const stamp = (extra: Record<string, unknown> = {}) => ({
    origin: { kind: 'cli', grantId: 'g1', bindingId: 'b1' },
    stampedAt: clock.now,
    expiresAt: clock.now + 30_000,
    ...extra
  })
  const request = (line: string, extra: Record<string, unknown> = {}) => {
    const id = (extra.id as string | undefined) ?? `r${++next}`
    deliver({ v: 1, kind: 'cli-request', id, line, ...stamp(extra) })
    return id
  }
  const cancel = (id: string) =>
    deliver({ v: 1, kind: 'cancel', id, ...stamp() })
  const of = <K extends CliReply['kind']>(kind: K, id?: string) =>
    replies.filter(
      (r): r is Extract<CliReply, { kind: K }> =>
        r.kind === kind && (id === undefined || ('id' in r && r.id === id))
    )
  const finished = (id: string) => of('finished', id)[0]
  return {
    console,
    gate,
    binding,
    clock,
    timers,
    listeners,
    replies,
    deliver,
    request,
    cancel,
    of,
    finished,
    attach: () => console.attachRemote(binding),
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
  properties: { ip: { type: 'string' }, limit: { type: 'integer' } },
  required: ['ip']
}

const search = (run: CommandDefinition['run'] = () => ({ summary: 'found' })) =>
  command('search', run, {
    input: searchInput,
    danger: 'read',
    aliases: ['s']
  })

const stopInput: InputSchema = {
  type: 'object',
  properties: { id: { type: 'integer' }, yes: { type: 'boolean' } },
  required: ['id']
}

/** A change command with a preview arm, as frontendx writes them. */
const stop = (
  run = vi.fn((request: { input?: Record<string, unknown> }) =>
    request.input?.yes === true
      ? { summary: 'stopped' }
      : { summary: 'would stop 1' }
  ),
  extra: Partial<CommandDefinition> = {}
) => ({
  run,
  definition: command('tasks.stop', run, {
    input: stopInput,
    danger: 'change',
    confirm: { field: 'yes' },
    ...extra
  })
})

describe('C-95 Confirm field', () => {
  it('throws unless confirm names a boolean property of a change command', () => {
    const base = { input: stopInput, run: () => undefined }
    expect(() =>
      createConsole({
        commands: [
          { name: 'a', ...base, danger: 'read', confirm: { field: 'yes' } }
        ]
      })
    ).toThrow(/confirm/)
    expect(() =>
      createConsole({
        commands: [
          { name: 'a', ...base, danger: 'change', confirm: { field: 'id' } }
        ]
      })
    ).toThrow(/confirm/)
    expect(() =>
      createConsole({
        commands: [
          { name: 'a', ...base, danger: 'change', confirm: { field: 'nope' } }
        ]
      })
    ).toThrow(/confirm/)
    expect(() =>
      createConsole({
        commands: [
          {
            name: 'a',
            run: () => undefined,
            danger: 'change',
            confirm: { field: 'yes' }
          }
        ]
      })
    ).toThrow(/confirm/)
    expect(() =>
      createConsole({
        commands: [
          {
            name: 'a',
            ...base,
            danger: 'change',
            confirm: null as never
          }
        ]
      })
    ).toThrow(/confirm/)
    expect(() =>
      createConsole({
        commands: [{ name: 'a', ...base, danger: 'change', plan: 1 as never }]
      })
    ).toThrow(/plan/)
  })

  it('getCommands copies confirm into the spec', () => {
    const console = createConsole({ commands: [stop().definition] })
    expect(console.getCommands()[0].confirm).toEqual({ field: 'yes' })
  })

  it("the agent's run takes a preview as read and refuses the change with its line", async () => {
    const { run, definition } = stop()
    const console = createConsole({ commands: [definition] })
    const tools = agentTools(console, { context: () => ({}) })
    const runTool = tools.find(tool => tool.name === 'run')!
    expect(await runTool.execute({ line: 'tasks.stop --id 8812' })).toEqual({
      status: 'ok',
      summary: 'would stop 1'
    })
    expect(run).toHaveBeenCalledTimes(1)
    const refused = await runTool.execute({
      line: 'tasks.stop --id 8812 --yes'
    })
    expect(refused).toMatchObject({
      status: 'error',
      code: 'not-allowed',
      line: 'tasks.stop --id 8812 --yes'
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('a preview with options the schema refuses is invalid-args, not not-allowed', async () => {
    const console = createConsole({ commands: [stop().definition] })
    expect(
      await console.request({
        line: 'tasks.stop --id x',
        actor: 'external-agent'
      })
    ).toMatchObject({ status: 'error', code: 'invalid-args' })
  })

  it('a change command without confirm stays not-allowed for the agent', async () => {
    const console = createConsole({
      commands: [
        command('tasks.kill', () => undefined, {
          input: stopInput,
          danger: 'change'
        })
      ]
    })
    expect(
      await console.request({
        line: 'tasks.kill --id 1 --yes false',
        actor: 'external-agent'
      })
    ).toMatchObject({ code: 'not-allowed' })
  })
})

describe('C-97 Attach remote', () => {
  it('subscribes to the gate on attach, before any envelope', () => {
    const t = setup({ commands: [search()] })
    expect(t.gate.subscribe).not.toHaveBeenCalled()
    t.attach()
    expect(t.gate.subscribe).toHaveBeenCalledTimes(1)
    // A second attach keeps the one subscription.
    t.attach()
    expect(t.gate.subscribe).toHaveBeenCalledTimes(1)
  })

  it('a bound tab that never sent anything hears its CLI', () => {
    const t = setup({ commands: [search()] })
    t.attach()
    const id = t.request('search --ip 1.2.3.4')
    expect(t.finished(id).outcome).toEqual({ status: 'ok', summary: 'found' })
  })

  it('sends the capabilities: described commands, confirm fields, sensitive names', () => {
    const t = setup({
      commands: [
        search(),
        stop().definition,
        command('login', () => undefined, {
          sensitive: true,
          aliases: ['signin']
        }),
        command('wipe', () => undefined, {
          input: stopInput,
          danger: 'irreversible'
        }),
        command('secret', () => undefined, {
          input: searchInput,
          danger: 'read',
          hidden: true
        }),
        command('plain')
      ]
    })
    t.attach()
    expect(t.replies).toEqual([
      {
        v: 1,
        kind: 'capabilities',
        bindingId: 'b1',
        envelope: 1,
        commands: [
          { name: 'search', aliases: ['s'], danger: 'read' },
          {
            name: 'tasks.stop',
            aliases: [],
            danger: 'change',
            confirm: 'yes'
          }
        ],
        sensitive: ['login', 'signin']
      }
    ])
  })

  it('puts the binding in the state; detach clears it and sends nothing more', () => {
    const t = setup({ commands: [search()] })
    t.attach()
    expect(t.console.getState().remote).toEqual({
      bindingId: 'b1',
      approvedAt: 900_000,
      approval: null
    })
    t.console.detachRemote()
    expect(t.console.getState().remote).toBeNull()
    const before = t.replies.length
    t.request('search --ip 1')
    expect(t.replies).toHaveLength(before)
    expect(t.console.getState().entries).toEqual([])
  })

  it('throws without a gate or a clock, or with a malformed binding', () => {
    const plain = createConsole({ commands: [search()] })
    const t = setup({ commands: [search()] })
    expect(() => plain.attachRemote(t.binding)).toThrow(/gate and now/)
    expect(() => t.console.attachRemote({} as never)).toThrow(TypeError)
    expect(() =>
      t.console.attachRemote({ ...t.binding, approvedAt: Number.NaN })
    ).toThrow(TypeError)
  })

  it('ignores a message from another binding or grant', () => {
    const t = setup({ commands: [search()] })
    t.attach()
    t.request('search --ip 1', {
      origin: { kind: 'cli', grantId: 'g1', bindingId: 'other' }
    })
    t.request('search --ip 1', {
      origin: { kind: 'cli', grantId: 'g2', bindingId: 'b1' }
    })
    t.deliver({ v: 1, kind: 'cli-request', id: 'x', line: 'search' })
    expect(t.of('finished')).toEqual([])
  })

  it('dispose unsubscribes and ends the binding', () => {
    const t = setup({ commands: [search()] })
    t.attach()
    t.console.dispose()
    expect(t.listeners.size).toBe(0)
  })

  it('a send that throws or rejects goes to onError and changes nothing else', async () => {
    const onError = vi.fn()
    const t = setup(
      { commands: [search()], onError },
      {
        send: vi
          .fn()
          .mockImplementationOnce(() => {
            throw new Error('down')
          })
          .mockImplementation(() => Promise.reject(new Error('later')))
      }
    )
    t.attach()
    t.request('search --ip 1')
    await flush()
    expect(onError).toHaveBeenCalledTimes(3)
    expect(t.console.getState().running).toBeNull()
  })
})

describe('C-98 Remote accept', () => {
  it('runs a read line as cli: received, an input entry with actor cli, finished', () => {
    const t = setup({ commands: [search()] })
    t.attach()
    const id = t.request('s --ip 1.2.3.4 --limit 5')
    expect(t.replies.slice(1)).toEqual([
      { v: 1, kind: 'received', id, hidden: false, dataAgeMs: null },
      {
        v: 1,
        kind: 'finished',
        id,
        outcome: { status: 'ok', summary: 'found' },
        chunks: 0,
        bytes: 0
      }
    ])
    expect(t.console.getState().entries[0]).toMatchObject({
      kind: 'input',
      text: 'search --ip 1.2.3.4 --limit 5',
      actor: 'cli'
    })
  })

  it('ignores the same request id a second time', () => {
    const run = vi.fn(() => ({ summary: 'found' }))
    const t = setup({ commands: [search(run)] })
    t.attach()
    t.request('search --ip 1', { id: 'same' })
    t.request('search --ip 1', { id: 'same' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(t.of('finished', 'same')).toHaveLength(1)
  })

  it('a late request is expired and does not run', () => {
    const run = vi.fn()
    const t = setup({ commands: [search(run)] })
    t.attach()
    const id = t.request('search --ip 1', {
      stampedAt: t.clock.now - 40_000,
      expiresAt: t.clock.now - 10_000
    })
    expect(run).not.toHaveBeenCalled()
    expect(t.finished(id).outcome).toMatchObject({ code: 'expired' })
    expect(t.of('received')).toEqual([])
    expect(t.console.getState().entries).toEqual([])
  })

  it('a stamp more than 30 s ahead of the tab is clock-skew and does not run', () => {
    const run = vi.fn()
    const t = setup({ commands: [search(run)] })
    t.attach()
    const id = t.request('search --ip 1', {
      stampedAt: t.clock.now + 31_000,
      expiresAt: t.clock.now + 61_000
    })
    expect(run).not.toHaveBeenCalled()
    const outcome = t.finished(id).outcome
    expect(outcome).toMatchObject({ code: 'clock-skew' })
    expect(outcome.status === 'error' && outcome.message).toMatch(/clock/)
    // 30 s is still accepted.
    const ok = t.request('search --ip 1', {
      stampedAt: t.clock.now + 30_000,
      expiresAt: t.clock.now + 60_000
    })
    expect(t.finished(ok).outcome.status).toBe('ok')
  })

  it('is busy while a run exists: no queue', async () => {
    const slow = deferred<undefined>()
    const t = setup({
      commands: [
        search(() => slow.promise),
        command('local', () => slow.promise)
      ]
    })
    t.attach()
    void t.console.run('local')
    const id = t.request('search --ip 1')
    expect(t.finished(id).outcome).toMatchObject({ code: 'busy' })
    slow.resolve(undefined)
    await flush()
    expect(t.console.getState().entries).toHaveLength(1)
  })

  it('refuses a sensitive command or line without running or echoing it', () => {
    const run = vi.fn()
    const t = setup({
      commands: [
        search(run),
        command('login', run, { sensitive: true }),
        command('vault', run, {
          input: searchInput,
          danger: 'read',
          sensitive: { fromArg: 1 }
        })
      ],
      isSensitive: line => line.includes('hunter2')
    })
    t.attach()
    const ids = [
      t.request('login hunter2'),
      t.request('search --ip hunter2'),
      t.request('vault --ip x')
    ]
    expect(run).not.toHaveBeenCalled()
    for (const id of ids) {
      const outcome = t.finished(id).outcome
      expect(outcome).toMatchObject({ code: 'not-allowed' })
      expect(JSON.stringify(outcome)).not.toContain('hunter2')
    }
    expect(t.console.getState().entries).toEqual([])
  })

  it('refuses unknown, hidden, irreversible and undescribed commands and bad lines', () => {
    const t = setup({
      commands: [
        search(),
        command('hid', () => undefined, {
          input: searchInput,
          danger: 'read',
          hidden: true
        }),
        command('wipe', () => undefined, {
          input: stopInput,
          danger: 'irreversible'
        }),
        command('plain')
      ]
    })
    t.attach()
    const code = (line: string) => {
      const outcome = t.finished(t.request(line)).outcome
      return outcome.status === 'error' ? outcome.code : 'ok'
    }
    expect(code('nope')).toBe('unknown-command')
    expect(code('hid --ip 1')).toBe('unknown-command')
    expect(code('wipe --id 1')).toBe('not-allowed')
    expect(code('plain')).toBe('not-allowed')
    expect(code('search --ip "open')).toBe('invalid-args')
    expect(code('   ')).toBe('invalid-args')
    const bad = t.finished(t.request('search --ipp 1')).outcome
    expect(bad).toMatchObject({ code: 'invalid-args' })
    expect(bad.status === 'error' && bad.message).toMatch(/did you mean ip/)
    expect(t.console.getState().entries).toEqual([])
  })

  it('received carries what the page says: hidden and the data age', () => {
    const t = setup(
      { commands: [search()] },
      { status: () => ({ hidden: true, dataAgeMs: 42_000 }) }
    )
    t.attach()
    const id = t.request('search --ip 1')
    expect(t.of('received', id)[0]).toMatchObject({
      hidden: true,
      dataAgeMs: 42_000
    })
  })

  it('a status that throws is reported and received says not hidden, age unknown', () => {
    const onError = vi.fn()
    const t = setup(
      { commands: [search()], onError },
      {
        status: () => {
          throw new Error('no')
        }
      }
    )
    t.attach()
    const id = t.request('search --ip 1')
    expect(t.of('received', id)[0]).toMatchObject({
      hidden: false,
      dataAgeMs: null
    })
    expect(onError).toHaveBeenCalled()
  })

  it('the view is the request’s, else the active view on accept, and finished names it', () => {
    const seen: (string | undefined)[] = []
    const t = setup(
      {
        commands: [
          search(request => {
            seen.push(request.view)
            return { summary: 'found' }
          })
        ],
        activeView: () => 'v-active'
      },
      { viewTitle: view => (view === 'v-1' ? 'Data View' : undefined) }
    )
    t.attach()
    const a = t.request('search --ip 1', { view: 'v-1' })
    const b = t.request('search --ip 1')
    expect(seen).toEqual(['v-1', 'v-active'])
    expect(t.finished(a).view).toEqual({ id: 'v-1', title: 'Data View' })
    expect(t.finished(b).view).toEqual({ id: 'v-active' })
  })

  it('beforeRun still decides', async () => {
    const t = setup({ commands: [search()], beforeRun: () => false })
    t.attach()
    const id = t.request('search --ip 1')
    await flush()
    expect(t.finished(id).outcome).toMatchObject({ code: 'not-allowed' })
  })
})

describe('C-99 Approval plan', () => {
  const approvalSetup = (extra: Partial<CommandDefinition> = {}) => {
    const s = stop(undefined, extra)
    const t = setup({ commands: [s.definition] })
    t.attach()
    return { ...t, run: s.run }
  }

  it('a confirm field that is not true runs the preview as read, flagged preview', () => {
    const t = approvalSetup()
    const id = t.request('tasks.stop --id 8812')
    expect(t.finished(id)).toMatchObject({
      outcome: { status: 'ok', summary: 'would stop 1' },
      preview: true
    })
    expect(t.of('awaiting-approval')).toEqual([])
    expect(t.run).toHaveBeenCalledTimes(1)
  })

  it('a change waits: the plan holds the id, the normalized input, the targets, the view and 2 minutes', async () => {
    const plan = vi.fn(() => ({ targets: ['8812'], preview: '1 task stops' }))
    const t = approvalSetup({ plan, normalize: input => ({ ...input }) })
    const id = t.request('tasks.stop --id 8812 --yes', { view: 'v-1' })
    await flush()
    expect(plan).toHaveBeenCalledWith(
      { id: 8812, yes: true },
      expect.any(AbortSignal)
    )
    expect(t.run).not.toHaveBeenCalled()
    expect(t.console.getState().running?.phase).toBe('approving')
    expect(t.console.getState().remote?.approval).toEqual({
      requestId: id,
      command: 'tasks.stop',
      line: 'tasks.stop --id 8812 --yes',
      input: { id: 8812, yes: true },
      targets: ['8812'],
      preview: '1 task stops',
      view: 'v-1',
      openedAt: t.clock.now,
      acceptsAt: t.clock.now + 1000,
      expiresAt: t.clock.now + 120_000
    })
    expect(t.of('awaiting-approval', id)).toEqual([
      {
        v: 1,
        kind: 'awaiting-approval',
        id,
        expiresAt: t.clock.now + 120_000
      }
    ])
    expect(t.timers.at(-1)?.ms).toBe(120_000)
  })

  it('refuses an approval in the first second, then runs the plan once', () => {
    const t = approvalSetup()
    const id = t.request('tasks.stop --id 8812 --yes')
    expect(t.console.approve(id)).toBe(false)
    t.clock.now += 999
    expect(t.console.approve(id)).toBe(false)
    expect(t.run).not.toHaveBeenCalled()
    t.clock.now += 1
    expect(t.console.approve('other')).toBe(false)
    expect(t.console.approve(id)).toBe(true)
    expect(t.console.approve(id)).toBe(false)
    expect(t.run).toHaveBeenCalledTimes(1)
    expect(t.run.mock.calls[0][0].input).toEqual({ id: 8812, yes: true })
    expect(t.finished(id).outcome).toEqual({
      status: 'ok',
      summary: 'stopped'
    })
    expect(t.finished(id).preview).toBeUndefined()
    expect(t.console.getState().remote?.approval).toBeNull()
    expect(t.timers.at(-1)?.cancelled).toBe(true)
  })

  it('reject ends the request not-allowed and nothing runs', () => {
    const t = approvalSetup()
    const id = t.request('tasks.stop --id 8812 --yes')
    expect(t.console.reject('other')).toBe(false)
    expect(t.console.reject(id)).toBe(true)
    expect(t.run).not.toHaveBeenCalled()
    expect(t.finished(id).outcome).toMatchObject({
      code: 'not-allowed',
      message: expect.stringMatching(/rejected/) as unknown
    })
    expect(t.console.getState().running).toBeNull()
    expect(t.console.getState().remote?.approval).toBeNull()
  })

  it('the plan drops when its time runs out, on suspend, on detach and on Ctrl+C', () => {
    const cases: [string, (t: ReturnType<typeof approvalSetup>) => void][] = [
      ['expired', t => t.tick()],
      ['connection', t => t.console.suspendRemote()],
      ['disconnected', t => t.console.detachRemote()],
      ['', t => t.console.handleKey(ctrlC)]
    ]
    for (const [text, drop] of cases) {
      const t = approvalSetup()
      const id = t.request('tasks.stop --id 8812 --yes')
      t.clock.now += 5000
      drop(t)
      expect(t.console.approve(id)).toBe(false)
      expect(t.run).not.toHaveBeenCalled()
      expect(t.console.getState().running).toBeNull()
      if (text !== 'disconnected') {
        expect(t.console.getState().remote?.approval ?? null).toBeNull()
      }
      if (text !== '' && text !== 'disconnected') {
        expect(t.finished(id).outcome).toMatchObject({
          code: 'not-allowed',
          message: expect.stringMatching(new RegExp(text)) as unknown
        })
      }
    }
  })

  it('an approval after the plan expired is refused and ends the request', () => {
    const t = approvalSetup()
    const id = t.request('tasks.stop --id 8812 --yes')
    t.clock.now += 120_001
    expect(t.console.approve(id)).toBe(false)
    expect(t.finished(id).outcome).toMatchObject({ code: 'not-allowed' })
  })

  it('one approval at a time: a second request is busy', () => {
    const t = approvalSetup()
    t.request('tasks.stop --id 1 --yes')
    const second = t.request('tasks.stop --id 2 --yes')
    expect(t.finished(second).outcome).toMatchObject({ code: 'busy' })
  })

  it('a plan that throws or rejects fails the request; nothing runs', async () => {
    for (const plan of [
      () => {
        throw new Error('no')
      },
      () => Promise.reject(new Error('no'))
    ]) {
      const t = approvalSetup({ plan })
      const id = t.request('tasks.stop --id 1 --yes')
      await flush()
      expect(t.finished(id).outcome).toMatchObject({ code: 'failed' })
      expect(t.run).not.toHaveBeenCalled()
    }
  })

  it('a plan may be asynchronous and its odd fields are left out', async () => {
    const t = approvalSetup({
      plan: () =>
        Promise.resolve({ targets: ['a', 1, 'b'], preview: 5 } as never)
    })
    t.request('tasks.stop --id 1 --yes')
    expect(t.console.getState().remote?.approval).toBeNull()
    await flush()
    const approval = t.console.getState().remote?.approval
    expect(approval?.targets).toEqual(['a', 'b'])
    expect(approval && 'preview' in approval).toBe(false)
  })

  it('a schedule that throws ends the request connection-lost', () => {
    const t = approvalSetup()
    t.gate.schedule.mockImplementation(() => {
      throw new Error('no timers')
    })
    const id = t.request('tasks.stop --id 1 --yes')
    expect(t.finished(id).outcome).toMatchObject({ code: 'connection-lost' })
  })
})

describe('C-100 Remote result', () => {
  it('data comes in chunks before finished, and joins back', () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({
      ip: `10.0.${i}`,
      note: 'ağ trafiği'
    }))
    const t = setup({
      commands: [search(() => ({ summary: 'rows', data: rows }))]
    })
    t.attach()
    const id = t.request('search --ip 1')
    const chunks = t.of('chunk', id)
    const end = t.finished(id)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.length).toBeLessThanOrEqual(3)
    expect(end.chunks).toBe(chunks.length)
    const kinds = t.replies.filter(r => 'id' in r && r.id === id)
    expect(kinds.at(-1)?.kind).toBe('finished')
    const text = joinChunks(end, chunks)
    expect(JSON.parse(text!)).toEqual(rows)
  })

  it('a missing chunk leaves the result incomplete', () => {
    const t = setup({
      commands: [
        search(() => ({
          data: Array.from({ length: 900 }, () => 'x'.repeat(20))
        }))
      ]
    })
    t.attach()
    const id = t.request('search --ip 1')
    const chunks: ChunkReply[] = t.of('chunk', id)
    expect(joinChunks(t.finished(id), chunks.slice(1))).toBeUndefined()
  })

  it('data that does not fit in three chunks is too-large', () => {
    // Quotes double in the chunk's JSON: 32 KB of them takes over 48 KB.
    const t = setup({
      commands: [search(() => ({ data: '"'.repeat(16_000) }))]
    })
    t.attach()
    const id = t.request('search --ip 1')
    expect(t.of('chunk', id)).toEqual([])
    expect(t.finished(id)).toMatchObject({
      outcome: { code: 'too-large' },
      chunks: 0
    })
  })

  it('carries no terminal block: only summary, data, code and message', () => {
    const t = setup({
      commands: [
        search(() => ({
          output: [{ type: 'json', value: { secret: 'masked-in-browser' } }],
          summary: 'one'
        })),
        command(
          'boom',
          () => {
            throw new Error('internal detail')
          },
          { input: searchInput, danger: 'read' }
        )
      ]
    })
    t.attach()
    const id = t.request('search --ip 1')
    expect(JSON.stringify(t.replies)).not.toContain('masked-in-browser')
    expect(t.finished(id).outcome).toEqual({ status: 'ok', summary: 'one' })
    const failed = t.request('boom --ip 1')
    expect(t.finished(failed).outcome).toEqual({
      status: 'error',
      code: 'failed'
    })
    expect(JSON.stringify(t.replies)).not.toContain('internal detail')
  })

  it('a command still running when the binding ends sends nothing', async () => {
    const slow = deferred<{ summary: string }>()
    const t = setup({ commands: [search(() => slow.promise)] })
    t.attach()
    const id = t.request('search --ip 1')
    t.console.detachRemote()
    slow.resolve({ summary: 'late' })
    await flush()
    expect(t.of('finished', id)).toEqual([])
    expect(outputs(t.console.getState().entries)).toEqual([])
  })
})

describe('C-101 Remote cancel', () => {
  it('before the command started: cancelled-before-start, then finished cancelled', () => {
    const t = setup({ commands: [stop().definition] })
    t.attach()
    const id = t.request('tasks.stop --id 1 --yes')
    t.cancel(id)
    expect(t.of('cancelled-before-start', id)).toHaveLength(1)
    expect(t.finished(id).outcome).toMatchObject({ code: 'cancelled' })
    expect(t.console.getState().remote?.approval).toBeNull()
  })

  it('while the command runs: cancel-requested and its signal aborts', () => {
    let signal: AbortSignal | undefined
    const slow = deferred<undefined>()
    const t = setup({
      commands: [
        search((_request, run) => {
          signal = run.signal
          return slow.promise
        })
      ]
    })
    t.attach()
    const id = t.request('search --ip 1')
    t.cancel(id)
    expect(t.of('cancel-requested', id)).toHaveLength(1)
    expect(signal?.aborted).toBe(true)
    expect(t.finished(id).outcome).toMatchObject({ code: 'cancelled' })
  })

  it('a cancel of another id, or after the end, is ignored', () => {
    const t = setup({ commands: [search()] })
    t.attach()
    const id = t.request('search --ip 1')
    const before = t.replies.length
    t.cancel(id)
    t.cancel('other')
    expect(t.replies).toHaveLength(before)
  })
})
