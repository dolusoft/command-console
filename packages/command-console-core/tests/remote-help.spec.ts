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
  envelopeMaxBytes,
  isCliReply,
  remoteBytes,
  type CliReply,
  type HelpResultReply,
  type InputSchema
} from '@dolusoft/command-protocol'

import { command, deferred, flush } from './helpers'

// A fake gate and clock, as remote.spec.ts has; only what help needs.
const setup = (
  options: Partial<ConsoleOptions> & { commands: CommandDefinition[] }
) => {
  const listeners = new Set<(raw: unknown) => void>()
  const clock = { now: 1_000_000 }
  const gate = {
    tab: 't1',
    send: vi.fn(() => Promise.resolve()),
    subscribe: (listener: (raw: unknown) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    schedule: () => () => undefined
  } satisfies ConsoleGate
  const replies: CliReply[] = []
  const binding: RemoteBinding = {
    bindingId: 'b1',
    grantId: 'g1',
    approvedAt: 900_000,
    send: reply => {
      replies.push(JSON.parse(JSON.stringify(reply)) as CliReply)
    },
    publishCapabilities: () => undefined
  }
  const console = createConsole({
    gate,
    createEnvelopeId: () => 'e1',
    now: () => clock.now,
    ...options
  })
  console.attachRemote(binding)
  let next = 0
  const deliver = (raw: unknown) => {
    for (const listener of [...listeners]) {
      listener(raw)
    }
  }
  const stamp = () => ({
    origin: { kind: 'cli', grantId: 'g1', bindingId: 'b1' },
    stampedAt: clock.now,
    expiresAt: clock.now + 30_000
  })
  /** Sends a `help-request` and returns its one `help-result`. */
  const help = (
    argv: string[],
    want: 'text' | 'json' = 'json',
    extra: Record<string, unknown> = {}
  ): HelpResultReply => {
    const id = (extra.id as string | undefined) ?? `h${++next}`
    deliver({
      v: 1,
      kind: 'help-request',
      id,
      argv,
      want,
      ...stamp(),
      ...extra
    })
    const found = replies.filter(
      (reply): reply is HelpResultReply =>
        reply.kind === 'help-result' && reply.id === id
    )
    expect(found).toHaveLength(1)
    return found[0]
  }
  return { console, clock, replies, deliver, stamp, help }
}

const findInput: InputSchema = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'The words to find in the page.' },
    limit: { type: 'integer', minimum: 1, maximum: 50 }
  },
  required: ['text']
}

const stopInput: InputSchema = {
  type: 'object',
  properties: { id: { type: 'integer' }, yes: { type: 'boolean' } },
  required: ['id']
}

const listInput: InputSchema = {
  type: 'object',
  properties: { cursor: { type: 'string' } }
}

const commands = (): CommandDefinition[] => [
  command('nav.find', () => undefined, {
    input: findInput,
    danger: 'read',
    aliases: ['find'],
    summary: 'Finds a page by its words.'
  }),
  command('tasks.list', () => undefined, {
    input: listInput,
    danger: 'read',
    summary: 'Lists the tasks.'
  }),
  command('tasks.stop', () => undefined, {
    input: stopInput,
    danger: 'change',
    confirm: { field: 'yes' },
    summary: 'Stops a task.'
  }),
  command('secret.set', () => undefined, {
    input: findInput,
    danger: 'change',
    sensitive: true
  }),
  command('debug.dump', () => undefined, {
    input: listInput,
    danger: 'read',
    hidden: true
  }),
  command('data.drop', () => undefined, {
    input: listInput,
    danger: 'irreversible'
  }),
  command('local.only', () => undefined)
]

const namespaces = [{ name: 'tasks', summary: 'Background tasks.' }]

describe('C-113 Remote help', () => {
  it('gives the agent help tool result for json, over the commands the CLI may run', async () => {
    const t = setup({ commands: commands(), namespaces })
    const reply = t.help([])
    expect(isCliReply(reply)).toBe(true)
    expect(reply).toMatchObject({ v: 1, status: 'ok' })
    expect(reply.text).toBeUndefined()
    const tool = agentTools(t.console, { context: () => null })[1]
    const agent = (await tool.execute({})) as {
      commands: { name: string }[]
    }
    const result = reply.result as typeof agent
    expect(result.commands.map(spec => spec.name)).toEqual([
      'nav.find',
      'tasks.list',
      'tasks.stop'
    ])
    // The agent sees the same open commands; hidden ones it may also skip.
    expect(result.commands).toEqual(
      agent.commands.filter(spec => spec.name !== 'data.drop')
    )
    expect(JSON.stringify(reply)).not.toMatch(/secret|debug|data\.drop|local/)
  })

  it('gives one command by name or alias, the ASCII case ignored', () => {
    const t = setup({ commands: commands() })
    for (const target of ['nav.find', 'FIND', 'Nav.Find']) {
      expect(t.help([target]).result).toMatchObject({
        name: 'nav.find',
        danger: 'read',
        input: findInput
      })
    }
  })

  it('writes plain English lines wrapped to the width, without the CLI name', () => {
    const t = setup({ commands: commands(), namespaces })
    const root = t.help([], 'text', { width: 30 }).text!
    expect(root).toEqual([
      'Namespaces:',
      '  nav (1 command)',
      '  tasks (2 commands)',
      '      Background tasks.',
      'Commands:',
      '  nav.find · read',
      '      Finds a page by its',
      '      words.',
      '  tasks.list · read',
      '      Lists the tasks.',
      '  tasks.stop · change',
      '      Stops a task.'
    ])
    const one = t.help(['tasks.stop'], 'text').text!
    expect(one).toEqual([
      'tasks.stop · change',
      'Stops a task.',
      'Usage:',
      '  tasks.stop --id <integer> [options]',
      'Runs as a preview without --yes; with --yes it makes the change.',
      'Fields:',
      '  --id <integer> · required',
      '  --yes <boolean> · optional'
    ])
    const find = t.help(['find'], 'text', { width: 24 }).text!
    expect(find).toContain('      The words to find')
    for (const line of [...root, ...one, ...find]) {
      expect(line).not.toMatch('gecko')
      expect(
        Array.from(line).some(char => {
          const point = char.codePointAt(0)!
          return point < 0x20 || (point >= 0x7f && point <= 0x9f)
        })
      ).toBe(false)
    }
    for (const line of find) {
      expect(Array.from(line).length).toBeLessThanOrEqual(24)
    }
    // Without a width the lines are at most 80 code points.
    expect(t.help(['tasks'], 'text').text).toEqual([
      'Commands in tasks:',
      '  tasks.list · read',
      '      Lists the tasks.',
      '  tasks.stop · change',
      '      Stops a task.'
    ])
  })

  it('drops control characters of a summary', () => {
    const t = setup({
      commands: [
        command('nav.find', () => undefined, {
          input: findInput,
          danger: 'read',
          summary: 'Red \u001b[31mtext\u0007 here'
        })
      ]
    })
    const lines = t.help([], 'text').text!
    expect(lines).toContain('      Red [31mtext here')
  })

  it('answers an unknown name, sent alone, with unknown-command and the nearest name', () => {
    const t = setup({ commands: commands() })
    expect(t.help(['nav.fnd'])).toEqual({
      v: 1,
      kind: 'help-result',
      id: expect.any(String) as unknown,
      status: 'error',
      code: 'unknown-command',
      class: 'usage',
      message: 'unknown command: nav.fnd; did you mean: nav.find',
      suggest: ['nav.find']
    })
    expect(t.help(['zzz'])).toMatchObject({
      code: 'unknown-command',
      message: 'unknown command: zzz'
    })
    expect(t.help(['zzz']).suggest).toBeUndefined()
    // A hidden, irreversible or undescribed command is not open to the CLI.
    for (const name of ['debug.dump', 'data.drop', 'local.only']) {
      expect(t.help([name])).toMatchObject({ code: 'unknown-command' })
    }
    // Free text is not echoed (P16).
    expect(t.help(['"x y"']).message).toBe('unknown command')
  })

  it('says nothing more about a sensitive name', () => {
    const t = setup({ commands: commands() })
    for (const name of ['secret.set', 'SECRET.SET']) {
      const reply = t.help([name])
      expect(reply).toEqual({
        v: 1,
        kind: 'help-result',
        id: reply.id,
        status: 'error',
        code: 'unknown-command',
        class: 'usage'
      })
    }
    expect(JSON.stringify(t.help(['secret.sett']))).not.toMatch(/secret\.set"/)
  })

  it('refuses another option, a second name and a missing value without echoing them', () => {
    const t = setup({ commands: commands() })
    for (const argv of [
      ['--verbose'],
      ['-x'],
      ['nav.find', 'tasks'],
      ['--cursor'],
      ['--limit=']
    ]) {
      const reply = t.help(argv)
      expect(reply).toMatchObject({
        status: 'error',
        code: 'invalid-args',
        class: 'usage'
      })
      expect(reply.message).not.toMatch(/verbose|-x\b|tasks"/)
    }
    expect(t.help(['nav.find', '--limit', '0'])).toMatchObject({
      code: 'invalid-args',
      help: 'nav.find'
    })
    expect(t.help(['--cursor', 'abc'])).toMatchObject({ code: 'invalid-args' })
  })

  it('pages with --cursor and --limit and names the next page as argv', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      command(`tasks.c${String(index).padStart(2, '0')}`, () => undefined, {
        input: listInput,
        danger: 'read'
      })
    )
    const t = setup({ commands: many })
    const first = t.help([])
    expect((first.result as { commands: unknown[] }).commands).toHaveLength(30)
    expect(first.next).toEqual(['help', '--cursor', '30'])
    const second = t.help(first.next!.slice(1))
    expect((second.result as { commands: unknown[] }).commands).toHaveLength(10)
    expect(second.next).toBeUndefined()
    expect(t.help(['tasks', '--limit', '15']).next).toEqual([
      'help',
      'tasks',
      '--cursor',
      '15',
      '--limit',
      '15'
    ])
    expect(t.help(['tasks.', '--cursor=35', '--limit=2']).next).toEqual([
      'help',
      'tasks.',
      '--cursor',
      '37',
      '--limit',
      '2'
    ])
    expect(t.help(['--limit', '15'], 'text').next).toEqual([
      'help',
      '--cursor',
      '15',
      '--limit',
      '15'
    ])
  })

  it('keeps text within 12 KB: a page lists fewer commands and gives next', () => {
    const many = Array.from({ length: 100 }, (_, index) =>
      command(`tasks.c${String(index).padStart(3, '0')}`, () => undefined, {
        input: listInput,
        danger: 'read',
        summary: `${'word '.repeat(39)}end`
      })
    )
    const t = setup({ commands: many })
    const reply = t.help(['--limit', '100'], 'text', { width: 20 })
    expect(
      new TextEncoder().encode(JSON.stringify(reply.text)).length
    ).toBeLessThanOrEqual(12_288)
    const shown = reply.text!.filter(line => line.startsWith('  tasks.'))
    expect(shown.length).toBeGreaterThan(1)
    expect(shown.length).toBeLessThan(100)
    expect(reply.next).toEqual([
      'help',
      '--cursor',
      String(shown.length),
      '--limit',
      '100'
    ])
    expect(remoteBytes(reply)).toBeLessThanOrEqual(envelopeMaxBytes)
  })

  it('cuts one command that does not fit, saying so', () => {
    const properties = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [
        `f${index}`,
        { type: 'string', description: 'x '.repeat(150) }
      ])
    )
    const t = setup({
      commands: [
        command('big.one', () => undefined, {
          input: { type: 'object', properties } as InputSchema,
          danger: 'read'
        })
      ]
    })
    const reply = t.help(['big.one'], 'text')
    expect(reply.status).toBe('ok')
    expect(reply.text!.at(-1)).toBe('(cut to fit; --json has the rest)')
    expect(
      new TextEncoder().encode(JSON.stringify(reply.text)).length
    ).toBeLessThanOrEqual(12_288)
  })

  it('answers while a command runs, with no received, no approval and no entry', async () => {
    const gate = deferred<undefined>()
    const t = setup({
      commands: [
        command('wait', () => gate.promise, {
          input: listInput,
          danger: 'read'
        }),
        ...commands()
      ]
    })
    t.deliver({
      v: 1,
      kind: 'cli-request',
      id: 'r1',
      argv: ['wait'],
      ...t.stamp()
    })
    const entries = t.console.getState().entries.length
    expect(t.help(['tasks.stop'], 'text').status).toBe('ok')
    expect(t.replies.filter(reply => reply.kind === 'received')).toHaveLength(1)
    expect(
      t.replies.filter(reply => reply.kind === 'awaiting-approval')
    ).toEqual([])
    expect(t.console.getState().entries).toHaveLength(entries)
    gate.resolve(undefined)
    await flush()
  })

  it('checks the stamp, answers an id once and ignores another binding', () => {
    const t = setup({ commands: commands() })
    expect(
      t.help([], 'json', { expiresAt: t.clock.now - 1, stampedAt: 0 })
    ).toMatchObject({ code: 'expired', class: 'not-run' })
    expect(
      t.help([], 'json', {
        stampedAt: t.clock.now + 60_000,
        expiresAt: t.clock.now + 90_000
      })
    ).toMatchObject({ code: 'clock-skew' })
    t.help([], 'json', { id: 'once' })
    t.deliver({
      v: 1,
      kind: 'help-request',
      id: 'once',
      argv: [],
      want: 'json',
      ...t.stamp()
    })
    expect(
      t.replies.filter(
        reply => reply.kind === 'help-result' && reply.id === 'once'
      )
    ).toHaveLength(1)
    const before = t.replies.length
    t.deliver({
      v: 1,
      kind: 'help-request',
      id: 'other',
      argv: [],
      want: 'json',
      ...t.stamp(),
      origin: { kind: 'cli', grantId: 'g1', bindingId: 'b2' }
    })
    expect(t.replies).toHaveLength(before)
  })

  it('answers an unreadable help-request once with an error; a cancel and an unknown kind stay silent', () => {
    const t = setup({ commands: commands() })
    const bad = (extra: Record<string, unknown>) => ({
      v: 1,
      kind: 'help-request',
      id: 'bad',
      argv: [],
      want: 'json',
      ...t.stamp(),
      ...extra
    })
    t.deliver(bad({ want: 'html' }))
    t.deliver(bad({ want: 'html' }))
    const answers = t.replies.filter(reply => reply.kind === 'help-result')
    expect(answers).toEqual([
      {
        v: 1,
        kind: 'help-result',
        id: 'bad',
        status: 'error',
        code: 'invalid-args',
        class: 'usage',
        message: 'The request is not a valid help request.'
      }
    ])
    t.deliver(bad({ id: 'v2', v: 2 }))
    t.deliver(bad({ id: 'big', pad: 'x'.repeat(70_000) }))
    expect(
      t.replies
        .filter(reply => reply.kind === 'help-result')
        .map(reply => reply.kind === 'help-result' && reply.code)
    ).toEqual(['invalid-args', 'unsupported-version', 'too-large'])
    const before = t.replies.length
    t.deliver(bad({ id: 'c', kind: 'cancel', expiresAt: 0 }))
    t.deliver(bad({ id: 'n', kind: 'nope' }))
    t.deliver(bad({ id: '', want: 'html' }))
    expect(t.replies).toHaveLength(before)
  })
})
