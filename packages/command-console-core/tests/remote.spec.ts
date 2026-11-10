import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  agentTools,
  CommandError,
  createConsole,
  type CommandDefinition,
  type CommandReturn,
  type ConsoleGate,
  type ConsoleOptions,
  type RemoteBinding
} from '@dolusoft/command-console-core'
import {
  envelopeMaxBytes,
  formatCommandArgv,
  formatCommandLine,
  joinChunks,
  readCapabilitiesParts,
  remoteFeatures,
  tokenize,
  type ChunkReply,
  type JsonValue,
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
  const published: { revision: string; parts: string[] }[] = []
  const binding: RemoteBinding = {
    bindingId: 'b1',
    grantId: 'g1',
    approvedAt: 900_000,
    send: reply => {
      replies.push(JSON.parse(JSON.stringify(reply)) as CliReply)
    },
    publishCapabilities: payload => {
      published.push(payload)
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
  const requestArgv = (argv: string[], extra: Record<string, unknown> = {}) => {
    const id = (extra.id as string | undefined) ?? `r${++next}`
    deliver({ v: 1, kind: 'cli-request', id, argv, ...stamp(extra) })
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
    published,
    deliver,
    request,
    requestArgv,
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
    const helpTool = tools.find(tool => tool.name === 'help')!
    expect(await helpTool.execute({ command: 'tasks.stop' })).toMatchObject({
      confirm: 'yes'
    })
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

  it('a CLI request that normalize confirms is a change: approval, no preview, nothing runs before it', async () => {
    const normalize = vi.fn((input: Record<string, unknown>) => ({
      ...input,
      yes: true
    }))
    const s = stop(undefined, { normalize: normalize })
    const t = setup({ commands: [s.definition] })
    t.attach()
    const id = t.request('tasks.stop --id 8812')
    await flush()
    expect(normalize).toHaveBeenCalledTimes(1)
    expect(s.run).not.toHaveBeenCalled()
    expect(t.of('awaiting-approval', id)).toHaveLength(1)
    expect(t.console.getState().remote?.approval?.input).toEqual({
      id: 8812,
      yes: true
    })
    expect(t.console.reject(id)).toBe(true)
    expect(s.run).not.toHaveBeenCalled()
    expect(t.finished(id).outcome).toMatchObject({ code: 'not-allowed' })
    expect(t.finished(id).preview).toBeUndefined()
    const approved = t.request('tasks.stop --id 8813')
    await flush()
    t.clock.now += 1000
    expect(t.console.approve(approved)).toBe(true)
    expect(s.run).toHaveBeenCalledTimes(1)
    expect(t.finished(approved).preview).toBeUndefined()
  })

  it('a CLI request that normalize turns into a preview runs as the preview', () => {
    const s = stop(undefined, {
      normalize: input => ({ ...input, yes: false })
    })
    const t = setup({ commands: [s.definition] })
    t.attach()
    const id = t.request('tasks.stop --id 8812 --yes')
    expect(t.of('awaiting-approval')).toEqual([])
    expect(t.finished(id)).toMatchObject({
      outcome: { status: 'ok', summary: 'would stop 1' },
      preview: true
    })
  })

  it('a normalize that throws ends a CLI request with finished, not silence', () => {
    const s = stop(undefined, {
      normalize: () => {
        throw new Error('bad')
      }
    })
    const t = setup({ commands: [s.definition] })
    t.attach()
    const id = t.request('tasks.stop --id 8812')
    expect(s.run).not.toHaveBeenCalled()
    expect(t.finished(id).outcome.status).toBe('error')
  })

  it("the agent's request treats an input that normalize confirms as the change", async () => {
    const normalize = vi.fn((input: Record<string, unknown>) => ({
      ...input,
      yes: true
    }))
    const s = stop(undefined, { normalize: normalize })
    const console = createConsole({ commands: [s.definition] })
    const runTool = agentTools(console, { context: () => ({}) }).find(
      tool => tool.name === 'run'
    )!
    expect(
      await runTool.execute({ line: 'tasks.stop --id 8812' })
    ).toMatchObject({ status: 'error', code: 'not-allowed' })
    expect(
      await console.request({
        command: 'tasks.stop',
        args: { id: 8812 },
        actor: 'external-agent'
      })
    ).toMatchObject({ status: 'error', code: 'not-allowed' })
    expect(s.run).not.toHaveBeenCalled()
    expect(console.getState().entries).toEqual([])
  })

  it("the agent's request runs the preview when normalize clears the field, normalizing once", async () => {
    const normalize = vi.fn((input: Record<string, unknown>) => ({
      ...input,
      yes: false
    }))
    const s = stop(undefined, { normalize: normalize })
    const console = createConsole({ commands: [s.definition] })
    expect(
      await console.request({
        line: 'tasks.stop --id 8812 --yes',
        actor: 'external-agent'
      })
    ).toEqual({ status: 'ok', summary: 'would stop 1' })
    expect(normalize).toHaveBeenCalledTimes(1)
    expect(s.run.mock.calls[0][0].input).toEqual({ id: 8812, yes: false })
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

  it('publishes the capabilities in parts: described commands, sensitive names, no reply', () => {
    const t = setup(
      {
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
      },
      { minCli: '0.9.0' }
    )
    t.attach()
    expect(t.replies).toEqual([])
    expect(t.published).toHaveLength(1)
    const [{ revision, parts }] = t.published
    expect(revision).toMatch(/^[0-9a-f]{8}$/)
    expect(parts).toHaveLength(1)
    expect(readCapabilitiesParts(parts)).toEqual({
      envelopes: [1],
      features: [...remoteFeatures],
      minCli: '0.9.0',
      revision,
      sensitive: ['login', 'signin'],
      commands: [
        { name: 'search', aliases: ['s'], danger: 'read' },
        // C-115: a change without `effect` is published as `server`.
        { name: 'tasks.stop', aliases: [], danger: 'change', effect: 'server' }
      ]
    })
    // The head is at the start of the first part; no confirm field.
    expect(parts[0]).toMatch(/^\{"envelopes":\[1\],"features":/)
    expect(parts.join('')).not.toContain('confirm')
  })

  it('the revision comes from the list: the same list, the same revision', () => {
    const a = setup({ commands: [search(), stop().definition] })
    const b = setup({ commands: [search(), stop().definition] })
    const c = setup({ commands: [search()] })
    for (const t of [a, b, c]) {
      t.attach()
    }
    expect(a.published[0].revision).toBe(b.published[0].revision)
    expect(c.published[0].revision).not.toBe(a.published[0].revision)
    expect(a.published[0].parts.join('')).not.toContain('minCli')
  })

  it('a list over three parts makes attachRemote throw and attaches nothing', () => {
    const many = Array.from({ length: 2000 }, (_, index) =>
      command(`namespace.command-${index}`, () => undefined, {
        input: searchInput,
        danger: 'read',
        aliases: [`alias-${index}`]
      })
    )
    const t = setup({ commands: many })
    expect(() => t.attach()).toThrow(RangeError)
    expect(t.console.getState().remote).toBeNull()
    expect(t.published).toEqual([])
  })

  it('a long list is cut into parts of at most 16 KB that join back', () => {
    const many = Array.from({ length: 500 }, (_, index) =>
      command(`namespace.command-${index}`, () => undefined, {
        input: searchInput,
        danger: 'read'
      })
    )
    const t = setup({ commands: many })
    t.attach()
    const { parts } = t.published[0]
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.length).toBeLessThanOrEqual(3)
    for (const part of parts) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(
        envelopeMaxBytes
      )
    }
    expect(readCapabilitiesParts(parts)?.commands).toHaveLength(500)
  })

  it('a publishCapabilities that throws or rejects goes to onError', async () => {
    const onError = vi.fn()
    const t = setup(
      { commands: [search()], onError },
      {
        publishCapabilities: vi
          .fn()
          .mockImplementationOnce(() => {
            throw new Error('down')
          })
          .mockImplementation(() => Promise.reject(new Error('later')))
      }
    )
    t.attach()
    t.console.setOptions(options => ({
      ...options,
      commands: [search(), stop().definition]
    }))
    await flush()
    expect(onError).toHaveBeenCalledTimes(2)
    expect(t.console.getState().remote).not.toBeNull()
  })

  it('puts the binding in the state; detach clears it and sends nothing more', () => {
    const t = setup({ commands: [search()] })
    t.attach()
    expect(t.console.getState().remote).toEqual({
      bindingId: 'b1',
      approvedAt: 900_000,
      level: 'ask-server',
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

  it('setOptions with new commands publishes the capabilities again with a new revision; other options do not', () => {
    const t = setup({ commands: [search()] })
    t.attach()
    t.console.setOptions(options => ({ ...options, prompt: '$' }))
    expect(t.published).toHaveLength(1)
    t.console.setOptions(options => ({
      ...options,
      commands: [...options.commands, stop().definition]
    }))
    expect(t.published).toHaveLength(2)
    expect(
      readCapabilitiesParts(t.published[1].parts)?.commands.map(
        spec => spec.name
      )
    ).toEqual(['search', 'tasks.stop'])
    expect(t.published[1].revision).not.toBe(t.published[0].revision)
    t.console.detachRemote()
    t.console.setOptions(options => ({ ...options, commands: [search()] }))
    expect(t.published).toHaveLength(2)
    expect(t.replies).toEqual([])
  })

  it('a setOptions whose list no longer fits goes to onError and publishes nothing', () => {
    const onError = vi.fn()
    const t = setup({ commands: [search()], onError })
    t.attach()
    t.console.setOptions(options => ({
      ...options,
      commands: Array.from({ length: 2000 }, (_, index) =>
        command(`namespace.command-${index}`, () => undefined, {
          input: searchInput,
          danger: 'read',
          aliases: [`alias-${index}`]
        })
      )
    }))
    expect(t.published).toHaveLength(1)
    expect(onError).toHaveBeenCalledWith(expect.any(RangeError), null)
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
    // `received` throws, `finished` rejects.
    expect(onError).toHaveBeenCalledTimes(2)
    expect(t.console.getState().running).toBeNull()
  })
})

describe('C-98 Remote accept', () => {
  describe('a cli-request parseCliMessage refuses', () => {
    const base = (extra: Record<string, unknown> = {}) => ({
      v: 1,
      kind: 'cli-request',
      id: 'bad',
      line: 'search --ip 1',
      origin: { kind: 'cli', grantId: 'g1', bindingId: 'b1' },
      stampedAt: 1_000_000,
      expiresAt: 1_030_000,
      ...extra
    })
    const refused = (raw: unknown) => {
      const run = vi.fn()
      const t = setup({ commands: [search(run)] })
      t.attach()
      t.deliver(raw)
      expect(run).not.toHaveBeenCalled()
      expect(t.of('received')).toEqual([])
      expect(t.console.getState().entries).toEqual([])
      return t
    }

    it('ends with finished invalid-args for a line over 4000 code points, carrying nothing of it', () => {
      const t = refused(base({ line: `search --ip ${'x'.repeat(4000)}` }))
      const end = t.finished('bad')
      expect(end).toEqual({
        v: 1,
        kind: 'finished',
        id: 'bad',
        outcome: {
          status: 'error',
          code: 'invalid-args',
          class: 'usage',
          message: expect.any(String) as unknown
        },
        chunks: 0,
        bytes: 0
      })
      expect(JSON.stringify(end)).not.toMatch(/xxxx|search/)
    })

    it('ends with unsupported-version for v 2 and too-large past envelopeMaxBytes', () => {
      expect(refused(base({ v: 2 })).finished('bad').outcome).toMatchObject({
        code: 'unsupported-version'
      })
      expect(
        refused(base({ pad: 'x'.repeat(70_000) })).finished('bad').outcome
      ).toMatchObject({ code: 'too-large' })
    })

    it('ends with invalid-args for a request with both argv and line', () => {
      const t = refused(base({ argv: ['search', '--ip', '1'] }))
      expect(t.finished('bad').outcome).toMatchObject({
        code: 'invalid-args',
        class: 'usage'
      })
      expect(t.of('received')).toEqual([])
      expect(t.console.getState().entries).toEqual([])
    })

    it('ends with invalid-args without a line', () => {
      expect(
        refused(base({ line: undefined })).finished('bad').outcome
      ).toMatchObject({ code: 'invalid-args' })
    })

    it('stays silent without a readable id, from another binding, or for another kind', () => {
      for (const raw of [
        base({ id: '' }),
        base({ id: 7 }),
        base({ origin: { kind: 'cli', grantId: 'g1', bindingId: 'other' } }),
        base({ origin: { kind: 'cli', grantId: 'g2', bindingId: 'b1' } }),
        base({ kind: 'help-request', line: undefined }),
        base({ kind: 'cancel', expiresAt: 0 })
      ]) {
        expect(refused(raw).of('finished')).toEqual([])
      }
    })

    it('answers the same refused request once, and not after detach', () => {
      const t = refused(base({ line: undefined }))
      t.deliver(base({ line: undefined }))
      t.deliver(base({ line: 'search --ip 1' }))
      expect(t.of('finished', 'bad')).toHaveLength(1)
      t.console.detachRemote()
      const before = t.replies.length
      t.deliver(base({ id: 'late', line: undefined }))
      expect(t.replies).toHaveLength(before)
    })
  })

  it('runs a read line as cli: received, an input entry with actor cli, finished', () => {
    const t = setup({ commands: [search()] })
    t.attach()
    const id = t.request('s --ip 1.2.3.4 --limit 5')
    expect(t.replies).toEqual([
      {
        v: 1,
        kind: 'received',
        id,
        hidden: false,
        dataAgeMs: null,
        change: false,
        viewRelevant: false
      },
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

  it('--dry-run runs the preview as read, flagged preview', () => {
    const t = approvalSetup()
    const id = t.request('tasks.stop --id 8812 --dry-run')
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
      expect(t.finished(id).outcome).toEqual({
        status: 'error',
        code: 'failed',
        class: 'failed'
      })
      expect(t.run).not.toHaveBeenCalled()
    }
  })

  it('a CommandError the plan throws or rejects ends the request with its code and message, as from run', async () => {
    const error = () =>
      new CommandError('target-not-found', '/x is not a page of your menu.')
    for (const plan of [
      () => {
        throw error()
      },
      () => Promise.reject(error())
    ]) {
      const t = approvalSetup({ plan })
      const id = t.request('tasks.stop --id 1 --yes')
      await flush()
      expect(t.of('received', id)).toHaveLength(1)
      expect(t.of('awaiting-approval', id)).toEqual([])
      expect(t.finished(id).outcome).toEqual({
        status: 'error',
        code: 'target-not-found',
        class: 'failed',
        message: '/x is not a page of your menu.'
      })
      expect(t.run).not.toHaveBeenCalled()
      expect(t.console.getState().remote?.approval ?? null).toBeNull()
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
      code: 'failed',
      class: 'failed'
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

describe('C-98 Remote accept: the argv path', () => {
  it('runs argv without making it a line: items are values as they are', () => {
    const seen: unknown[] = []
    const t = setup({
      commands: [
        search(request => {
          seen.push(request.input)
          return { summary: 'found' }
        })
      ]
    })
    t.attach()
    // A quote in an item is a character, not the start of a quoted text.
    const id = t.requestArgv(['s', '--ip', '"a b'])
    expect(t.finished(id).outcome).toEqual({ status: 'ok', summary: 'found' })
    expect(seen).toEqual([{ ip: '"a b' }])
    const [entry] = t.console.getState().entries
    expect(entry).toMatchObject({ kind: 'input', actor: 'cli' })
    // The history shows the canonical line.
    expect(entry.kind === 'input' && entry.text).toBe(
      formatCommandLine('search', { ip: '"a b' }, searchInput)
    )
  })

  it('checks the argv as typed and as its canonical line for sensitivity', () => {
    const run = vi.fn()
    const t = setup({
      commands: [search(run), command('login', run, { sensitive: true })],
      isSensitive: line => line.includes('hunter2') || line.includes("'x y'")
    })
    t.attach()
    const ids = [
      t.requestArgv(['LOGIN', 'pw']),
      t.requestArgv(['search', '--ip', 'hunter2']),
      // Only a joined form quotes the item.
      t.requestArgv(['search', '--ip', 'x y'])
    ]
    expect(run).not.toHaveBeenCalled()
    for (const id of ids) {
      expect(t.finished(id).outcome).toEqual({
        status: 'error',
        code: 'not-allowed',
        class: 'denied'
      })
    }
    expect(t.of('received')).toEqual([])
  })

  it('refuses options the schema refuses, as for a line', () => {
    const t = setup({ commands: [search()] })
    t.attach()
    const outcome = t.finished(t.requestArgv(['search', '--ipp', '1'])).outcome
    expect(outcome).toMatchObject({ code: 'invalid-args', class: 'usage' })
    expect(t.console.getState().entries).toEqual([])
  })
})

describe('C-110 Received fields', () => {
  it('change is true only for the path that changes data', () => {
    const t = setup({ commands: [search(), stop().definition] })
    t.attach()
    const read = t.request('search --ip 1')
    const preview = t.request('tasks.stop --id 1 --dry-run')
    const change = t.request('tasks.stop --id 1')
    expect(t.of('received', read)[0].change).toBe(false)
    expect(t.of('received', preview)[0].change).toBe(false)
    expect(t.of('received', change)[0].change).toBe(true)
  })

  it('change follows the normalized input, not the typed one', () => {
    const t = setup({
      commands: [
        stop(undefined, {
          normalize: input => ({ ...input, yes: input.id === 7 })
        }).definition
      ]
    })
    t.attach()
    expect(t.of('received', t.request('tasks.stop --id 7'))[0].change).toBe(
      true
    )
    t.tick()
    expect(
      t.of('received', t.request('tasks.stop --id 8 --yes'))[0].change
    ).toBe(false)
  })

  it('viewRelevant is the request’s view or usesView, not the active view alone', () => {
    const page: { active?: string } = {}
    const t = setup({ commands: [search()], activeView: () => page.active })
    t.attach()
    const none = t.request('search --ip 1')
    const named = t.request('search --ip 1', { view: 'v-1' })
    page.active = 'v-active'
    const current = t.request('search --ip 1')
    expect(t.of('received', none)[0].viewRelevant).toBe(false)
    expect(t.finished(none).view).toBeUndefined()
    expect(t.of('received', named)[0].viewRelevant).toBe(true)
    // An active view alone does not make it relevant; finished still names it.
    expect(t.of('received', current)[0].viewRelevant).toBe(false)
    expect(t.finished(current).view).toEqual({ id: 'v-active' })
  })

  it('viewRelevant follows usesView of the command, else of its namespace', () => {
    const read = (name: string, extra: Partial<CommandDefinition> = {}) =>
      command(name, () => ({ summary: 'ok' }), {
        input: searchInput,
        danger: 'read',
        ...extra
      })
    const t = setup({
      commands: [
        read('dataview.search'),
        read('dataview.export', { usesView: false }),
        read('tasks.list'),
        read('tasks.peek', { usesView: true })
      ],
      namespaces: [
        { name: 'dataview', usesView: true },
        { name: 'tasks', summary: 'Tasks.' }
      ],
      activeView: () => 'v-active'
    })
    t.attach()
    const relevant = (line: string) =>
      t.of('received', t.request(`${line} --ip 1`))[0].viewRelevant
    expect(relevant('dataview.search')).toBe(true)
    expect(relevant('dataview.export')).toBe(false)
    expect(relevant('tasks.list')).toBe(false)
    expect(relevant('tasks.peek')).toBe(true)
  })

  it('asks the binding’s status with the canonical command name and passes its age on', () => {
    const status = vi.fn((request: { command: string }) => ({
      hidden: false,
      dataAgeMs: request.command === 'search' ? 5000 : null
    }))
    const t = setup({ commands: [search(), stop().definition] }, { status })
    t.attach()
    const a = t.request('s --ip 1')
    const b = t.request('tasks.stop --id 1')
    expect(status.mock.calls).toEqual([
      [{ command: 'search' }],
      [{ command: 'tasks.stop' }]
    ])
    expect(t.of('received', a)[0].dataAgeMs).toBe(5000)
    expect(t.of('received', b)[0].dataAgeMs).toBeNull()
  })
})

describe('C-111 Remote suggestions', () => {
  const listInput: InputSchema = {
    type: 'object',
    properties: {
      state: { type: 'string' },
      cursor: { type: 'string' },
      limit: { type: 'integer' }
    }
  }
  const reader = (name: string, extra: Partial<CommandDefinition> = {}) =>
    command(name, () => undefined, {
      input: searchInput,
      danger: 'read',
      ...extra
    })

  it('a preview suggests nothing: the change needs no confirm field from the CLI', () => {
    const t = setup({
      commands: [
        stop(undefined, {
          normalize: input => ({ ...input, id: (input.id as number) + 100 })
        }).definition
      ]
    })
    t.attach()
    const end = t.finished(t.request('tasks.stop --id 1 --dry-run'))
    expect(end.preview).toBe(true)
    expect(end).not.toHaveProperty('suggest')
    expect(end).not.toHaveProperty('outcome.line')
  })

  it('unknown-command suggests only the nearest open name, never the arguments', () => {
    const t = setup({
      commands: [
        search(),
        reader('seek'),
        reader('serve'),
        reader('sea'),
        reader('sertch'),
        reader('serc'),
        reader('searcy', { hidden: true }),
        command('searck', () => undefined, { sensitive: true }),
        command('searcz', () => undefined, {
          input: stopInput,
          danger: 'irreversible'
        }),
        command('searcw')
      ]
    })
    t.attach()
    const end = t.finished(t.request('serch --ip secret-value'))
    expect(end.outcome).toEqual({
      status: 'error',
      code: 'unknown-command',
      class: 'usage',
      // The near name is in `suggest` only, never in the message.
      message: 'unknown command: serch'
    })
    // The nearest of four near names; a tie goes by name.
    expect(end.suggest).toEqual(['search'])
    expect(JSON.stringify(end)).not.toContain('secret-value')
    expect(end.help).toBeUndefined()
  })

  it('an alias counts, the case is ignored, and far names give a bare message', () => {
    const t = setup({ commands: [search()] })
    t.attach()
    const far = t.finished(t.requestArgv(['Xyzzy']))
    expect(far.outcome).toMatchObject({ message: 'unknown command: Xyzzy' })
    expect(far.suggest).toBeUndefined()
    // `SX` is one edit from the alias `s`, the case ignored.
    expect(t.finished(t.requestArgv(['SX', '--ip', '1'])).suggest).toEqual([
      'search'
    ])
  })

  it('invalid-args names the command for help and suggests the positional fix', () => {
    const t = setup({
      commands: [
        command('find', () => undefined, {
          input: {
            type: 'object',
            properties: { text: { type: 'string' }, max: { type: 'integer' } },
            required: ['text']
          },
          danger: 'read'
        }),
        stop().definition
      ]
    })
    t.attach()
    const fix = t.finished(t.request('find data  view'))
    expect(fix.outcome).toMatchObject({ code: 'invalid-args', class: 'usage' })
    expect(fix.suggest).toEqual(['find', '--text', 'data view'])
    expect(fix.help).toBe('find')
    // An argument that starts with a dash: no fix, still the help.
    const dashed = t.finished(t.requestArgv(['find', 'data', '-x']))
    expect(dashed.suggest).toBeUndefined()
    expect(dashed.help).toBe('find')
    // The only required field is not a string.
    const integer = t.finished(t.request('tasks.stop 5'))
    expect(integer.suggest).toBeUndefined()
    expect(integer.help).toBe('tasks.stop')
  })

  it('next is the argv of the next page when the data has a nextCursor and the schema a cursor', () => {
    const t = setup({
      commands: [
        command(
          'tasks.list',
          request => ({
            data: {
              items: [],
              nextCursor: request.input?.cursor === '40' ? '' : '40'
            }
          }),
          { input: listInput, danger: 'read' }
        ),
        command('plain.list', () => ({ data: { nextCursor: '40' } }), {
          input: searchInput,
          danger: 'read'
        })
      ]
    })
    t.attach()
    const first = t.finished(t.request('tasks.list --state open --limit 20'))
    expect(first.next).toEqual([
      'tasks.list',
      '--state',
      'open',
      '--cursor',
      '40',
      '--limit',
      '20'
    ])
    expect(t.finished(t.requestArgv(first.next!)).next).toBeUndefined()
    // No `cursor` field: no next.
    expect(t.finished(t.request('plain.list --ip 1')).next).toBeUndefined()
  })

  it('a not-allowed end of an accepted request suggests its canonical argv without the confirm field', () => {
    const t = setup({ commands: [stop().definition] })
    t.attach()
    const id = t.request('tasks.stop --yes --id 3')
    t.tick()
    const end = t.finished(id)
    expect(end.outcome).toMatchObject({
      code: 'not-allowed',
      class: 'denied',
      message: 'The approval expired; nothing changed.'
    })
    expect(end.suggest).toEqual(['tasks.stop', '--id', '3'])
    expect(end).not.toHaveProperty('approval')
  })

  it('a change the user rejected is not suggested again', () => {
    const t = setup({ commands: [stop().definition] })
    t.attach()
    const id = t.request('tasks.stop --yes --id 3')
    t.console.reject(id)
    const end = t.finished(id)
    expect(end.outcome).toMatchObject({
      code: 'not-allowed',
      class: 'denied',
      message: 'The user rejected the change in the browser; nothing changed.'
    })
    expect(end).not.toHaveProperty('suggest')
  })

  it('a sensitive request’s reply has no message, suggest, next or help', () => {
    const t = setup({
      commands: [
        search(),
        command('login', () => undefined, {
          sensitive: true,
          aliases: ['signin']
        })
      ],
      isSensitive: line => line.includes('hunter2')
    })
    t.attach()
    for (const id of [
      t.request('logn hunter2'),
      t.request('Signin x'),
      t.request('search hunter2')
    ]) {
      const end = t.finished(id)
      expect(end.outcome).toEqual({
        status: 'error',
        code: 'not-allowed',
        class: 'denied'
      })
      for (const field of ['suggest', 'next', 'help']) {
        expect(end).not.toHaveProperty(field)
      }
    }
    // A sensitive name is never a suggestion.
    const near = t.finished(t.request('logon'))
    expect(near.suggest).toBeUndefined()
    expect(JSON.stringify(near)).not.toContain('login')
  })

  it('formatCommandArgv gives what tokenize gives of formatCommandLine', () => {
    const schema: InputSchema = {
      type: 'object',
      properties: {
        text: { type: 'string' },
        n: { type: 'number' },
        on: { type: 'boolean' },
        off: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        filter: {
          type: 'object',
          properties: { host: { type: 'string' } }
        }
      }
    }
    const values: Record<string, JsonValue>[] = [
      {},
      { text: 'a b "c" \\ \'d\'', n: 1.5, on: true, off: false },
      { tags: ['', 'x y', '--z'], filter: { host: 'h' } },
      { text: '🙂  ' }
    ]
    for (const value of values) {
      const argv = formatCommandArgv('ns.cmd', value, schema)
      const parsed = tokenize(formatCommandLine('ns.cmd', value, schema))
      expect(parsed.ok).toBe(true)
      expect(parsed.tokens.map(token => token.value)).toEqual(argv)
    }
  })
})

describe('C-112 Remote command name', () => {
  interface Row {
    name: string
    input: { argv: string[] } | { line: string }
    tab: { name: string } | { refuse: string }
    sensitive?: true
  }
  const file = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        'fixtures',
        'remote',
        'command-name.json'
      ),
      'utf8'
    )
  ) as {
    commands: {
      name: string
      aliases: string[]
      danger: 'read' | 'change'
      sensitive?: true
    }[]
    rows: Row[]
  }
  const keyInput: InputSchema = {
    type: 'object',
    properties: { key: { type: 'string' } }
  }
  const commands = file.commands.map(spec =>
    command(spec.name, () => ({ summary: 'ran' }), {
      aliases: spec.aliases,
      ...(spec.sensitive === true
        ? { sensitive: true }
        : { input: keyInput, danger: spec.danger })
    })
  )

  for (const row of file.rows) {
    it(`command-name.json "${row.name}" runs through attachRemote as the tab expects`, () => {
      const t = setup({ commands })
      t.attach()
      const id =
        'argv' in row.input
          ? t.requestArgv(row.input.argv)
          : t.request(row.input.line)
      const end = t.finished(id)
      if ('name' in row.tab) {
        expect(t.of('received', id)).toHaveLength(1)
        const [entry] = t.console.getState().entries
        const text = entry.kind === 'input' ? entry.text : null
        expect(tokenize(text ?? '').tokens[0]?.value).toBe(row.tab.name)
      } else {
        expect(t.of('received', id)).toEqual([])
        expect(end.outcome).toMatchObject({ code: row.tab.refuse })
        expect(t.console.getState().entries).toEqual([])
      }
      if (row.sensitive === true) {
        expect(end.outcome).toEqual({
          status: 'error',
          code: 'not-allowed',
          class: 'denied'
        })
        expect(end).not.toHaveProperty('suggest')
      }
    })
  }

  it('the line tokenizer ends a name at ECMAScript WhiteSpace and LineTerminator only', () => {
    const expected = [
      0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002,
      0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028,
      0x2029, 0x202f, 0x205f, 0x3000, 0xfeff
    ]
    // What splits `a?b` in two: the tokenizer of the local terminal, measured.
    const tokenizer: number[] = []
    for (let code = 0; code <= 0xffff; code++) {
      if (tokenize(`a${String.fromCharCode(code)}b`).tokens.length === 2) {
        tokenizer.push(code)
      }
    }
    expect(tokenizer).toEqual(expected)
    // The remote line ends its name at each of them; U+0085 joins the name.
    const t = setup({ commands: [] })
    t.attach()
    for (const code of [...expected, 0x85]) {
      const { outcome } = t.finished(
        t.request(`nosuch${String.fromCharCode(code)}x`)
      )
      expect(outcome.status === 'error' && outcome.code).toBe(
        code === 0x85 ? 'invalid-args' : 'unknown-command'
      )
    }
  })

  it('an exact name wins over a folded one; the local terminal stays case-sensitive', async () => {
    const ran: string[] = []
    const t = setup({
      commands: [
        command('Get', () => void ran.push('Get'), {
          input: keyInput,
          danger: 'read'
        }),
        command('get', () => void ran.push('get'), {
          input: keyInput,
          danger: 'read'
        })
      ]
    })
    t.attach()
    t.requestArgv(['get'])
    t.requestArgv(['Get'])
    t.requestArgv(['GET'])
    expect(ran).toEqual(['get', 'Get', 'Get'])
    await t.console.run('GET')
    expect(ran).toHaveLength(3)
  })
})

const goInput: InputSchema = {
  type: 'object',
  properties: { to: { type: 'string' } },
  required: ['to']
}

/** A `screen` change without a preview arm, as frontendx's `nav.go`. */
const go = (run = vi.fn((): CommandReturn => ({ summary: 'opened' }))) => ({
  run,
  definition: command('nav.go', run, {
    input: goInput,
    danger: 'change',
    effect: 'screen'
  })
})

describe('C-115 Command effect', () => {
  it('takes screen or server on a change command only', () => {
    const make = (extra: Partial<CommandDefinition>) => () =>
      createConsole({
        commands: [
          { name: 'a', input: goInput, run: () => undefined, ...extra }
        ]
      })
    expect(make({ danger: 'change', effect: 'screen' })).not.toThrow()
    expect(make({ danger: 'change', effect: 'server' })).not.toThrow()
    expect(make({ danger: 'read', effect: 'screen' })).toThrow(/effect/)
    expect(make({ danger: 'irreversible', effect: 'server' })).toThrow(/effect/)
    expect(make({ effect: 'server' })).toThrow(/effect/)
    expect(make({ danger: 'change', effect: 'disk' as never })).toThrow(
      /effect/
    )
    const console = createConsole({ commands: [search()] })
    expect(() =>
      console.setOptions(options => ({
        ...options,
        commands: [
          command('b', () => undefined, {
            input: goInput,
            danger: 'read',
            effect: 'screen'
          })
        ]
      }))
    ).toThrow(/effect/)
  })

  it('getCommands copies effect into the spec', () => {
    const console = createConsole({
      commands: [go().definition, stop().definition]
    })
    const [nav, tasks] = console.getCommands()
    expect(nav.effect).toBe('screen')
    expect(tasks).not.toHaveProperty('effect')
  })

  it('the capabilities carry the effect of every change, server by default, none on a read', () => {
    const t = setup({
      commands: [
        search(),
        go().definition,
        stop().definition,
        stop(undefined, { name: 'tasks.clear', effect: 'server' }).definition
      ]
    })
    t.attach()
    expect(readCapabilitiesParts(t.published[0].parts)?.commands).toEqual([
      { name: 'search', aliases: ['s'], danger: 'read' },
      { name: 'nav.go', aliases: [], danger: 'change', effect: 'screen' },
      { name: 'tasks.stop', aliases: [], danger: 'change', effect: 'server' },
      { name: 'tasks.clear', aliases: [], danger: 'change', effect: 'server' }
    ])
    expect(readCapabilitiesParts(t.published[0].parts)?.features).toEqual(
      expect.arrayContaining(['effect', 'dry-run', 'approval'])
    )
  })

  it('publishes the capabilities-effect fixture as it is', () => {
    const fixtures = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          '..',
          '..',
          '..',
          'fixtures',
          'remote',
          'valid',
          'capabilities.json'
        ),
        'utf8'
      )
    ) as { name: string; parts: string[] }[]
    const fixture = fixtures.find(item => item.name === 'capabilities-effect')!
    const t = setup({
      commands: [
        search(),
        go().definition,
        stop().definition,
        command('login', () => undefined, {
          sensitive: true,
          aliases: ['signin']
        })
      ]
    })
    t.attach()
    expect(t.published[0].parts).toEqual(fixture.parts)
  })

  it('changes nothing for the local terminal or an agent', async () => {
    const g = go()
    const console = createConsole({ commands: [g.definition] })
    await console.run('nav.go --to /a')
    expect(g.run).toHaveBeenCalledTimes(1)
    expect(
      await console.request({
        line: 'nav.go --to /a',
        actor: 'external-agent'
      })
    ).toMatchObject({ status: 'error', code: 'not-allowed' })
    expect(g.run).toHaveBeenCalledTimes(1)
  })
})

describe('C-116 Approval level', () => {
  it('the level is the binding’s, ask-server by default, and the state shows it', () => {
    const t = setup({ commands: [search()] })
    t.attach()
    expect(t.console.getState().remote?.level).toBe('ask-server')
    const never = setup({ commands: [search()] }, { level: 'never-ask' })
    never.attach()
    expect(never.console.getState().remote?.level).toBe('never-ask')
  })

  it('attachRemote throws for a level it does not know', () => {
    const t = setup({ commands: [search()] })
    expect(() =>
      t.console.attachRemote({ ...t.binding, level: 'sometimes' as never })
    ).toThrow(TypeError)
    expect(t.console.getState().remote).toBeNull()
  })

  it('ask-server: a screen change runs without a card, a server change waits for one', () => {
    const g = go()
    const s = stop()
    const t = setup({ commands: [g.definition, s.definition] })
    t.attach()
    const screen = t.request('nav.go --to /dashboard')
    expect(t.of('awaiting-approval', screen)).toEqual([])
    expect(g.run).toHaveBeenCalledTimes(1)
    expect(t.of('received', screen)[0].change).toBe(true)
    const server = t.request('tasks.stop --id 8812')
    expect(t.of('awaiting-approval', server)).toHaveLength(1)
    expect(s.run).not.toHaveBeenCalled()
    expect(t.console.getState().running?.phase).toBe('approving')
  })

  it('never-ask: a server change runs without a card', () => {
    const s = stop()
    const t = setup({ commands: [s.definition] }, { level: 'never-ask' })
    t.attach()
    const id = t.request('tasks.stop --id 8812')
    expect(t.of('awaiting-approval')).toEqual([])
    expect(s.run).toHaveBeenCalledTimes(1)
    expect(s.run.mock.calls[0][0].input).toEqual({ id: 8812, yes: true })
    expect(t.finished(id).outcome).toEqual({ status: 'ok', summary: 'stopped' })
  })

  it('never-ask still refuses an irreversible or a sensitive command, and beforeRun still decides', async () => {
    const run = vi.fn()
    const t = setup(
      {
        commands: [
          command('wipe', run, { input: stopInput, danger: 'irreversible' }),
          command('login', run, { sensitive: true }),
          stop(run as never).definition
        ],
        beforeRun: () => false
      },
      { level: 'never-ask' }
    )
    t.attach()
    const ids = [t.request('wipe --id 1'), t.request('login x')]
    for (const id of ids) {
      expect(t.finished(id).outcome).toMatchObject({ code: 'not-allowed' })
    }
    const refused = t.request('tasks.stop --id 1')
    await flush()
    expect(t.finished(refused).outcome).toMatchObject({ code: 'not-allowed' })
    expect(run).not.toHaveBeenCalled()
  })

  it('setRemoteLevel decides the next request and keeps a waiting approval', () => {
    const s = stop()
    const t = setup({ commands: [s.definition] })
    t.attach()
    const waiting = t.request('tasks.stop --id 1')
    t.console.setRemoteLevel('never-ask')
    expect(t.console.getState().remote).toMatchObject({
      level: 'never-ask',
      approval: { requestId: waiting }
    })
    t.clock.now += 1000
    expect(t.console.approve(waiting)).toBe(true)
    expect(t.finished(waiting).approval).toBe('card')
    const next = t.request('tasks.stop --id 2')
    expect(t.of('awaiting-approval', next)).toEqual([])
    expect(t.finished(next).approval).toBe('none')
    t.console.setRemoteLevel('ask-server')
    const third = t.request('tasks.stop --id 3')
    expect(t.of('awaiting-approval', third)).toHaveLength(1)
  })

  it('setRemoteLevel throws for an unknown level and does nothing without a binding', () => {
    const t = setup({ commands: [search()] })
    const listener = vi.fn()
    t.console.subscribe(listener)
    t.console.setRemoteLevel('never-ask')
    expect(t.console.getState().remote).toBeNull()
    expect(listener).not.toHaveBeenCalled()
    expect(() => t.console.setRemoteLevel('ask' as never)).toThrow(TypeError)
    t.attach()
    t.console.detachRemote()
    t.console.setRemoteLevel('never-ask')
    expect(t.console.getState().remote).toBeNull()
  })
})

describe('C-117 Remote dry run', () => {
  it('a change runs without its confirm field: the plan and the run get it true', async () => {
    const plan = vi.fn(() => ({ targets: ['1'] }))
    const s = stop(undefined, { plan })
    const t = setup({ commands: [s.definition] })
    t.attach()
    const id = t.request('tasks.stop --id 1')
    await flush()
    expect(plan).toHaveBeenCalledWith(
      { id: 1, yes: true },
      expect.any(AbortSignal)
    )
    expect(t.console.getState().remote?.approval?.line).toBe(
      'tasks.stop --id 1 --yes'
    )
    t.clock.now += 1000
    t.console.approve(id)
    expect(s.run.mock.calls[0][0].input).toEqual({ id: 1, yes: true })
    expect(t.finished(id).preview).toBeUndefined()
  })

  it('--dry-run gives the preview, even with --yes or as argv, and suggests nothing', () => {
    const s = stop()
    const t = setup({ commands: [s.definition] })
    t.attach()
    const ids = [
      t.request('tasks.stop --id 1 --dry-run'),
      t.request('tasks.stop --dry-run --id 1 --yes'),
      t.requestArgv(['tasks.stop', '--id', '1', '--dry-run'])
    ]
    for (const id of ids) {
      expect(t.of('received', id)[0].change).toBe(false)
      expect(t.finished(id)).toEqual({
        v: 1,
        kind: 'finished',
        id,
        outcome: { status: 'ok', summary: 'would stop 1' },
        chunks: 0,
        bytes: 0,
        preview: true
      })
    }
    expect(t.of('awaiting-approval')).toEqual([])
    expect(s.run.mock.calls.map(call => call[0].input)).toEqual([
      { id: 1, yes: false },
      { id: 1, yes: false },
      { id: 1, yes: false }
    ])
    const [entry] = t.console.getState().entries
    expect(entry.kind === 'input' && entry.text).toBe(
      'tasks.stop --id 1 --yes false'
    )
  })

  it('--dry-run on a change without a confirm field is invalid-args and nothing runs', () => {
    const g = go()
    const t = setup({ commands: [g.definition] }, { level: 'never-ask' })
    t.attach()
    const id = t.request('nav.go --to /a --dry-run')
    expect(g.run).not.toHaveBeenCalled()
    expect(t.of('received', id)).toEqual([])
    expect(t.finished(id)).toMatchObject({
      outcome: { code: 'invalid-args', class: 'usage' },
      help: 'nav.go'
    })
    expect(t.console.getState().entries).toEqual([])
  })

  it('--dry-run on a read command is dropped and the command runs as it is', () => {
    const seen: unknown[] = []
    const t = setup({
      commands: [
        search(request => {
          seen.push(request.input)
          return { summary: 'found' }
        })
      ]
    })
    t.attach()
    const id = t.request('search --dry-run --ip 1')
    expect(seen).toEqual([{ ip: '1' }])
    expect(t.finished(id).preview).toBeUndefined()
  })

  it('--yes is taken and changes nothing', () => {
    const s = stop()
    const t = setup({ commands: [s.definition] }, { level: 'never-ask' })
    t.attach()
    const a = t.request('tasks.stop --id 1 --yes')
    const b = t.request('tasks.stop --id 1')
    const c = t.request('tasks.stop --id 1 --yes false')
    for (const id of [a, b, c]) {
      expect(t.finished(id)).toMatchObject({
        outcome: { status: 'ok', summary: 'stopped' },
        approval: 'none'
      })
    }
  })

  it('the local terminal and the agent keep the preview without the confirm field', async () => {
    const s = stop()
    const console = createConsole({ commands: [s.definition] })
    expect(
      await console.request({
        line: 'tasks.stop --id 1',
        actor: 'external-agent'
      })
    ).toEqual({ status: 'ok', summary: 'would stop 1' })
    await console.run('tasks.stop --id 2')
    expect(s.run.mock.calls.map(call => call[0].input)).toEqual([
      { id: 1 },
      { id: 2 }
    ])
    await console.run('tasks.stop --id 3 --dry-run')
    expect(s.run).toHaveBeenCalledTimes(2)
  })
})

describe('C-118 Approval field', () => {
  it('a change says card after the window and none without it', () => {
    const t = setup({ commands: [go().definition, stop().definition] })
    t.attach()
    const screen = t.request('nav.go --to /a')
    expect(t.finished(screen).approval).toBe('none')
    const server = t.request('tasks.stop --id 1')
    t.clock.now += 1000
    t.console.approve(server)
    expect(t.finished(server).approval).toBe('card')
  })

  it('a change whose command was called says how even when it failed or was cancelled', () => {
    const slow = deferred<undefined>()
    const t = setup(
      {
        commands: [
          go(
            vi.fn(() => {
              throw new Error('no')
            })
          ).definition,
          stop(vi.fn(() => slow.promise) as never).definition
        ]
      },
      { level: 'never-ask' }
    )
    t.attach()
    const failed = t.request('nav.go --to /a')
    expect(t.finished(failed)).toMatchObject({
      outcome: { code: 'failed' },
      approval: 'none'
    })
    const cancelled = t.request('tasks.stop --id 1')
    t.cancel(cancelled)
    expect(t.of('cancel-requested', cancelled)).toHaveLength(1)
    expect(t.finished(cancelled)).toMatchObject({
      outcome: { code: 'cancelled' },
      approval: 'none'
    })
  })

  it('a read, a preview and a request that did not reach its command carry none', async () => {
    const t = setup({
      commands: [search(), stop().definition],
      beforeRun: info => (info.command === 'search' ? undefined : false)
    })
    t.attach()
    const ids = [
      t.request('search --ip 1'),
      t.request('tasks.stop --id 1 --dry-run'),
      t.request('tasks.stop --id 1'),
      t.request('nope')
    ]
    await flush()
    for (const id of ids) {
      expect(t.finished(id)).not.toHaveProperty('approval')
    }
    const plain = setup({ commands: [stop().definition] })
    plain.attach()
    const rejected = plain.request('tasks.stop --id 1')
    plain.console.reject(rejected)
    const cancelled = plain.request('tasks.stop --id 2')
    plain.cancel(cancelled)
    expect(plain.of('cancelled-before-start', cancelled)).toHaveLength(1)
    for (const id of [rejected, cancelled]) {
      expect(plain.finished(id)).not.toHaveProperty('approval')
    }
  })

  describe('fixtures/remote/sequence/approval.json', () => {
    interface Item {
      name: string
      tab: {
        level: 'ask-server' | 'never-ask'
        command: {
          name: string
          danger: 'change'
          effect?: 'screen' | 'server'
          confirm?: string
          input: InputSchema
        }
        summary: string
        approve?: boolean
        expire?: boolean
      }
      request: Record<string, unknown>
      replies: CliReply[]
    }
    const items = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          '..',
          '..',
          '..',
          'fixtures',
          'remote',
          'sequence',
          'approval.json'
        ),
        'utf8'
      )
    ) as Item[]

    for (const item of items) {
      it(`"${item.name}" gives the replies of the example`, () => {
        const { level, command: spec, summary, approve } = item.tab
        const t = setup(
          {
            commands: [
              command(spec.name, () => ({ summary }), {
                input: spec.input,
                danger: spec.danger,
                ...(spec.effect !== undefined && { effect: spec.effect }),
                ...(spec.confirm !== undefined && {
                  confirm: { field: spec.confirm }
                })
              })
            ]
          },
          { level }
        )
        t.clock.now = item.request.stampedAt as number
        t.attach()
        t.deliver(item.request)
        if (item.tab.expire) {
          t.clock.now += 120_001
          if (approve === undefined) {
            t.tick()
          } else {
            expect(t.console.approve(item.request.id as string)).toBe(false)
          }
        } else if (approve !== undefined) {
          t.clock.now += 1000
          const id = item.request.id as string
          expect(approve ? t.console.approve(id) : t.console.reject(id)).toBe(
            true
          )
        }
        expect(t.replies).toEqual(item.replies)
      })
    }
  })
})
