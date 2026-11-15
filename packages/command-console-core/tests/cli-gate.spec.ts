import { describe, expect, it, vi } from 'vitest'

import {
  agentTools,
  CommandError,
  createConsole,
  type CommandDefinition,
  type ConsoleGate,
  type ConsoleOptions,
  type RemoteBinding
} from '@dolusoft/command-console-core'
import type { CliReply, Envelope } from '@dolusoft/command-protocol'

import { deferred, flush, outputs } from './helpers'

const transport = () => {
  const listeners = new Set<(raw: unknown) => void>()
  const callbacks: ((raw: unknown) => void)[] = []
  const timers: {
    ms: number
    fire: () => void
    cancel: ReturnType<typeof vi.fn>
  }[] = []
  const gate = {
    tab: 'tab',
    send: vi.fn<(envelope: Envelope) => Promise<void>>(() => Promise.resolve()),
    subscribe: vi.fn((listener: (raw: unknown) => void) => {
      listeners.add(listener)
      callbacks.push(listener)
      return vi.fn(() => {
        listeners.delete(listener)
      })
    }),
    schedule: vi.fn((ms: number, fire: () => void) => {
      const cancel = vi.fn()
      timers.push({ ms, fire, cancel })
      return cancel
    })
  } satisfies ConsoleGate
  return {
    gate,
    listeners,
    callbacks,
    timers,
    deliver: (raw: unknown) => {
      for (const listener of [...listeners]) {
        listener(raw)
      }
    }
  }
}

const read = (
  run = vi.fn<CommandDefinition['run']>(() => ({ summary: 'read' }))
): CommandDefinition => ({
  name: 'read',
  input: { type: 'object', properties: {} },
  danger: 'read',
  run
})
const change = (
  run = vi.fn<CommandDefinition['run']>(() => ({ summary: 'changed' }))
): CommandDefinition => ({
  name: 'change',
  input: { type: 'object', properties: {} },
  danger: 'change',
  run
})
const message = (command = 'read', id = 'r1') => ({
  v: 1,
  kind: 'cli-request',
  id,
  argv: [command],
  origin: { kind: 'cli', bindingId: 'binding', grantId: 'grant' },
  stampedAt: 1000,
  expiresAt: 31_000
})
const setup = (options: Partial<ConsoleOptions> = {}) => {
  const incoming = transport()
  // No send or tab: this path cannot relay a local command.
  const cliGate = {
    subscribe: incoming.gate.subscribe,
    schedule: incoming.gate.schedule
  }
  const clock = { now: 1000 }
  const replies: CliReply[] = []
  const binding: RemoteBinding = {
    bindingId: 'binding',
    grantId: 'grant',
    approvedAt: 0,
    send: reply => {
      replies.push(reply)
    },
    publishCapabilities: vi.fn()
  }
  const console = createConsole({
    commands: [read(), change()],
    cliGate,
    now: () => clock.now,
    ...options
  })
  const finished = () => replies.filter(reply => reply.kind === 'finished')
  return {
    console,
    incoming,
    cliGate,
    clock,
    replies,
    binding,
    finished,
    attach: () => console.attachRemote(binding)
  }
}

describe('C-120 Separate CLI gate', () => {
  it('attaches with only a receive gate, executes CLI input and keeps submit and request local', async () => {
    const run = vi.fn<CommandDefinition['run']>(() => ({ summary: 'read' }))
    const t = setup({ commands: [read(run)] })
    expect(t.incoming.listeners.size).toBe(0)
    t.attach()
    t.incoming.deliver(message())
    expect(t.finished()[0]?.outcome).toEqual({ status: 'ok', summary: 'read' })
    expect(run).toHaveBeenCalledTimes(1)
    t.console.setInput('read')
    expect(await t.console.submit()).toBe(true)
    expect(
      await t.console.request({ command: 'read', actor: 'external-agent' })
    ).toEqual({ status: 'ok', summary: 'read' })
    expect(run).toHaveBeenCalledTimes(3)
    expect(t.incoming.gate.send).not.toHaveBeenCalled()
    expect(t.incoming.gate.schedule).not.toHaveBeenCalled()
    t.console.dispose()
  })

  it('keeps the gate-only echo path and receives CLI traffic through its shared subscription', async () => {
    const relay = transport()
    const run = vi.fn<CommandDefinition['run']>(() => undefined)
    const t = setup({
      cliGate: undefined,
      gate: relay.gate,
      createEnvelopeId: () => 'e1',
      commands: [read(run)]
    })
    t.attach()
    relay.deliver(message())
    expect(run).toHaveBeenCalledTimes(1)
    const local = t.console.request({
      command: 'read',
      actor: 'external-agent'
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(relay.gate.send).toHaveBeenCalledTimes(1)
    relay.deliver(relay.gate.send.mock.calls[0][0])
    expect(await local).toEqual({ status: 'ok' })
    expect(run).toHaveBeenCalledTimes(2)
    expect(relay.gate.subscribe).toHaveBeenCalledTimes(1)
    t.console.dispose()
    expect(relay.listeners.size).toBe(0)
  })

  it('uses cliGate for CLI traffic and approval timers and gate for local echoes', async () => {
    const relay = transport()
    const run = vi.fn<CommandDefinition['run']>(() => undefined)
    const t = setup({
      gate: relay.gate,
      createEnvelopeId: () => 'e1',
      commands: [read(run), change(run)]
    })
    t.attach()
    expect(relay.listeners.size).toBe(0)
    const local = t.console.request({
      command: 'read',
      actor: 'external-agent'
    })
    const envelope = relay.gate.send.mock.calls[0][0]
    t.incoming.deliver(envelope)
    expect(run).not.toHaveBeenCalled()
    relay.deliver(envelope)
    expect(await local).toEqual({ status: 'ok' })
    relay.deliver(message('change'))
    expect(t.console.getState().remote?.approval).toBeNull()
    t.incoming.deliver(message('change'))
    expect(t.console.getState().running?.phase).toBe('approving')
    expect(t.incoming.timers[0]?.ms).toBe(120_000)
    expect(relay.timers.map(timer => timer.ms)).toEqual([5000])
    t.clock.now += 1000
    expect(t.console.approve('r1')).toBe(true)
    expect(t.incoming.timers[0]?.cancel).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(2)
    t.console.detachRemote()
    expect(t.incoming.listeners.size).toBe(0)
    expect(relay.listeners.size).toBe(1)
    t.console.dispose()
    expect(relay.listeners.size).toBe(0)
  })

  it('expires approval through the receive gate without a relay', () => {
    const run = vi.fn<CommandDefinition['run']>(() => undefined)
    const t = setup({ commands: [change(run)] })
    t.attach()
    t.incoming.deliver(message('change'))
    t.incoming.timers[0].fire()
    expect(t.finished()[0]?.outcome).toMatchObject({
      code: 'not-allowed',
      class: 'denied'
    })
    expect(t.console.getState().running).toBeNull()
    expect(t.console.getState().remote?.approval).toBeNull()
    expect(run).not.toHaveBeenCalled()
    t.console.dispose()
  })

  it.each(['detach', 'suspend', 'dispose'] as const)(
    'cleans the receive subscription and pending approval on %s, ignoring late callbacks',
    action => {
      const run = vi.fn<CommandDefinition['run']>(() => undefined)
      const t = setup({ commands: [change(run), read(run)] })
      t.attach()
      t.incoming.deliver(message('change'))
      const late = t.incoming.callbacks[0]
      if (action === 'detach') {
        t.console.detachRemote()
      } else if (action === 'suspend') {
        t.console.suspendRemote()
      } else {
        t.console.dispose()
      }
      expect(t.incoming.listeners.size).toBe(0)
      expect(t.incoming.timers[0].cancel).toHaveBeenCalledTimes(1)
      const count = t.replies.length
      late(message('read', 'late'))
      t.incoming.timers[0].fire()
      expect(t.replies).toHaveLength(count)
      expect(run).not.toHaveBeenCalled()
      if (action !== 'dispose') {
        t.attach()
        late(message('read', 'stale'))
        expect(run).not.toHaveBeenCalled()
        t.incoming.deliver(message('read', 'fresh'))
        expect(run).toHaveBeenCalledTimes(1)
      }
      t.console.dispose()
    }
  )

  it('replaces a binding without accumulating subscriptions or sending a detached run result', async () => {
    const pending = deferred<string>()
    const run = vi.fn(() => pending.promise)
    const t = setup({ commands: [read(run)] })
    t.attach()
    t.incoming.deliver(message())
    t.attach()
    expect(t.incoming.listeners.size).toBe(1)
    pending.resolve('done')
    await flush()
    expect(t.finished()).toEqual([])
    t.incoming.deliver(message('read', 'r2'))
    await flush()
    expect(t.finished()).toHaveLength(1)
    t.console.dispose()
  })

  it('keeps cliGate fixed and requires now for an attachment', () => {
    const t = setup()
    expect(() =>
      t.console.setOptions(old => ({ ...old, cliGate: transport().gate }))
    ).toThrow(/gate/)
    expect(() =>
      t.console.setOptions(old => ({ ...old, cliGate: undefined }))
    ).toThrow(/gate/)
    t.console.setOptions(old => ({ ...old, prompt: '$' }))
    const missingClock = setup({ now: undefined })
    expect(() => missingClock.attach()).toThrow(/now/)
    expect(missingClock.incoming.listeners.size).toBe(0)
    t.console.dispose()
    missingClock.console.dispose()
  })

  it('leaves the previous binding intact if subscribing fails', () => {
    const t = setup()
    t.attach()
    t.incoming.gate.subscribe.mockImplementationOnce(() => {
      throw new Error('offline')
    })
    expect(() => t.attach()).toThrow('offline')
    t.incoming.deliver(message())
    expect(t.finished()[0]?.outcome.status).toBe('ok')
    expect(t.incoming.listeners.size).toBe(1)
    t.console.dispose()
  })

  it('separates lifetimes when both gates are the same transport object', async () => {
    const shared = transport()
    const run = vi.fn<CommandDefinition['run']>(() => undefined)
    const t = setup({
      gate: shared.gate,
      cliGate: shared.gate,
      createEnvelopeId: () => 'e1',
      commands: [read(run)]
    })
    t.attach()
    const local = t.console.request({
      command: 'read',
      actor: 'external-agent'
    })
    expect(shared.listeners.size).toBe(2)
    t.console.detachRemote()
    expect(shared.listeners.size).toBe(1)
    shared.deliver(shared.gate.send.mock.calls[0][0])
    expect(await local).toEqual({ status: 'ok' })
    t.attach()
    shared.deliver(message())
    expect(run).toHaveBeenCalledTimes(2)
    expect(t.finished()).toHaveLength(1)
    t.console.dispose()
    expect(shared.listeners.size).toBe(0)
  })

  it('reports an unsubscribe failure and still cancels the approval timer on dispose', () => {
    const incoming = transport()
    const error = new Error('unsubscribe failed')
    incoming.gate.subscribe.mockImplementation(listener => {
      incoming.listeners.add(listener)
      return vi.fn(() => {
        throw error
      })
    })
    const onError = vi.fn()
    const t = setup({ cliGate: incoming.gate, onError })
    t.attach()
    incoming.deliver(message('change'))
    t.console.dispose()
    expect(onError).toHaveBeenCalledWith(error, null)
    expect(incoming.timers[0].cancel).toHaveBeenCalledTimes(1)
    const count = t.replies.length
    incoming.deliver(message('read', 'late'))
    expect(t.replies).toHaveLength(count)
  })
})

describe('C-86 Command permission errors', () => {
  it.each(['throw', 'reject', 'other-copy'] as const)(
    'preserves not-allowed through request, WebMCP and CLI (%s)',
    async mode => {
      const denied = Object.assign(new Error('Access revoked.'), {
        name: 'CommandError',
        code: 'not-allowed'
      })
      const error =
        mode === 'other-copy'
          ? denied
          : new CommandError('not-allowed', 'Access revoked.')
      const onError = vi.fn()
      const t = setup({
        commands: [
          read(
            vi.fn(() => {
              if (mode === 'reject') {
                return Promise.reject(error)
              }
              throw error
            })
          )
        ],
        onError
      })
      const expected = {
        status: 'error',
        code: 'not-allowed',
        message: 'Access revoked.'
      }
      expect(
        await t.console.request({ command: 'read', actor: 'external-agent' })
      ).toEqual(expected)
      const tool = agentTools(t.console, { context: () => ({}) }).find(
        candidate => candidate.name === 'run'
      )
      expect(await tool?.execute({ command: 'read' })).toEqual(expected)
      t.attach()
      t.incoming.deliver(message())
      await flush()
      expect(t.finished()[0]?.outcome).toEqual({ ...expected, class: 'denied' })
      expect(onError).toHaveBeenCalledTimes(3)
      expect(
        outputs(t.console.getState().entries).map(entry => entry.blocks)
      ).toEqual([
        [{ type: 'message', code: 'command-failed' }],
        [{ type: 'message', code: 'command-failed' }],
        [{ type: 'message', code: 'command-failed' }]
      ])
      t.console.dispose()
    }
  )

  it('preserves not-allowed from a remote approval plan', () => {
    const t = setup({
      commands: [
        {
          ...change(),
          plan: () => {
            throw new CommandError('not-allowed', 'Access revoked.')
          }
        }
      ]
    })
    t.attach()
    t.incoming.deliver(message('change'))
    expect(t.finished()[0]?.outcome).toMatchObject({
      code: 'not-allowed',
      class: 'denied',
      message: 'Access revoked.'
    })
    expect(t.incoming.timers).toEqual([])
    t.console.dispose()
  })
})
