// What an agent reads back (1.3): the message of a refused or failed
// operation, a summary made when it is read, a string for a list, and the
// paged `help`.
import { describe, expect, it, vi } from 'vitest'

import {
  agentTools,
  CommandError,
  createConsole,
  type CommandDefinition,
  type CommandRequest
} from '@dolusoft/command-console-core'
import type { InputSchema, JsonValue } from '@dolusoft/command-protocol'

import { command, outputs } from './helpers'

const agent = 'external-agent' as const

const rowsInput: InputSchema = {
  type: 'object',
  properties: {
    last: { type: 'string', enum: ['15m', '1h', '24h', '7d'] },
    columns: { type: 'array', items: { type: 'string' } },
    limit: { type: 'integer', minimum: 1, maximum: 500 },
    filter: {
      type: 'object',
      properties: {
        hosts: { type: 'array', items: { type: 'string' } },
        ports: { type: 'array', items: { type: 'integer' } }
      }
    }
  },
  required: ['last']
}

/** A described `read` command. */
const rows = (
  run: CommandDefinition['run'] = () => ({ summary: 'ok' }),
  extra: Partial<CommandDefinition> = {}
): CommandDefinition =>
  command('dataview.rows', run, {
    input: rowsInput,
    danger: 'read',
    summary: 'Reads rows.',
    ...extra
  })

const ask = (
  console: Parameters<typeof agentTools>[0],
  args: Record<string, unknown> | undefined,
  name = 'dataview.rows'
) =>
  console.request(
    args === undefined
      ? { command: name, actor: agent }
      : { command: name, args, actor: agent }
  )

describe('C-89 Error message', () => {
  it('a CommandError from run gives its message, thrown or rejected', async () => {
    const console = createConsole({
      commands: [
        rows(() => {
          throw new CommandError(
            'invalid-args',
            'OTEL-LOGS is an internal source; it takes no filter.'
          )
        }),
        rows(
          () => Promise.reject(new CommandError('failed', 'Backend down.')),
          {
            name: 'later'
          }
        )
      ]
    })
    expect(await ask(console, { last: '1h' })).toEqual({
      status: 'error',
      code: 'invalid-args',
      message: 'OTEL-LOGS is an internal source; it takes no filter.'
    })
    expect(await ask(console, { last: '1h' }, 'later')).toEqual({
      status: 'error',
      code: 'failed',
      message: 'Backend down.'
    })
  })

  it('cuts the message to 300 code points', async () => {
    const long = '😀'.repeat(400)
    const console = createConsole({
      commands: [
        rows(() => {
          throw new CommandError('failed', long)
        })
      ]
    })
    const outcome = await ask(console, { last: '1h' })
    expect(outcome.status).toBe('error')
    const message = (outcome as { message: string }).message
    expect(Array.from(message)).toHaveLength(300)
    expect(message.endsWith('…')).toBe(true)
  })

  it('another error, and a CommandError without a message, give none', async () => {
    const console = createConsole({
      commands: [
        rows(() => {
          throw new Error('SELECT * FROM secret_table')
        }),
        rows(
          () => {
            throw new CommandError('target-not-found')
          },
          { name: 'bare' }
        ),
        rows(
          () => {
            throw new CommandError('busy' as 'failed', 'claims a core code')
          },
          { name: 'core' }
        )
      ]
    })
    expect(await ask(console, { last: '1h' })).toEqual({
      status: 'error',
      code: 'failed'
    })
    expect(await ask(console, { last: '1h' }, 'bare')).toEqual({
      status: 'error',
      code: 'target-not-found'
    })
    expect(await ask(console, { last: '1h' }, 'core')).toEqual({
      status: 'error',
      code: 'failed',
      message: 'claims a core code'
    })
  })

  it('a CommandError from normalize or beforeRun gives no message', async () => {
    const thrower = () => {
      throw new CommandError('invalid-args', 'from outside run')
    }
    const normalized = createConsole({
      commands: [rows(undefined, { normalize: thrower })]
    })
    const before = createConsole({ commands: [rows()], beforeRun: thrower })
    for (const console of [normalized, before]) {
      expect(await ask(console, { last: '1h' })).toEqual({
        status: 'error',
        code: 'failed'
      })
    }
  })

  it('the message never reaches the entries', async () => {
    const console = createConsole({
      commands: [
        rows(() => {
          throw new CommandError('invalid-args', 'only for the caller')
        })
      ]
    })
    await ask(console, { last: '1h' })
    expect(JSON.stringify(console.getState())).not.toContain(
      'only for the caller'
    )
    expect(outputs(console.getState().entries)[0].blocks).toEqual([
      { type: 'message', code: 'command-failed' }
    ])
  })

  it('a refused input says which field and what it wants', async () => {
    const console = createConsole({ commands: [rows()] })
    const message = async (args: Record<string, unknown>) =>
      ((await ask(console, args)) as { message?: string }).message
    expect(await message({ last: '1h', columns: 5 })).toBe(
      'columns: expected array of string'
    )
    expect(await message({ last: '2d' })).toBe('last: one of 15m|1h|24h|7d')
    expect(await message({ time: '1h' })).toBe(
      'last: required; unknown field "time"'
    )
    expect(await message({ last: '1h', lmit: 3 })).toBe(
      'unknown field "lmit" (did you mean limit?)'
    )
    expect(await message({ last: '1h', filter: { host: ['a'] } })).toBe(
      'unknown field "filter.host" (did you mean filter.hosts?)'
    )
    expect(await message({ last: '1h', limit: 0 })).toBe('limit: minimum 1')
    expect(await message({ last: '1h', filter: { ports: ['x'] } })).toBe(
      'filter.ports[0]: expected integer'
    )
    expect(await message({ last: 'secret-value', limit: 'x' })).toBe(
      'last: one of 15m|1h|24h|7d; limit: expected integer'
    )
    // Every refusal is invalid-args, and nothing reaches the entries.
    expect(await ask(console, { last: 7 })).toEqual({
      status: 'error',
      code: 'invalid-args',
      message: 'last: expected string'
    })
    expect(console.getState().entries).toEqual([])
  })

  it('a refused line says what is wrong, unless the line is sensitive', async () => {
    const console = createConsole({
      commands: [rows()],
      isSensitive: line => line.includes('--token')
    })
    expect(
      await console.request({ line: 'dataview.rows --lst 1h', actor: agent })
    ).toEqual({
      status: 'error',
      code: 'invalid-args',
      message: 'unknown field "lst" (did you mean last?); last: required'
    })
    expect(
      await console.request({ line: 'dataview.rows "1h', actor: agent })
    ).toEqual({
      status: 'error',
      code: 'invalid-args',
      message: 'unterminated quote'
    })
    expect(
      await console.request({
        line: 'dataview.rows --token abc',
        actor: agent
      })
    ).toEqual({ status: 'error', code: 'invalid-args' })
  })

  it('the run tool hands the message to the agent', async () => {
    const console = createConsole({ commands: [rows()] })
    const [, , run] = agentTools(console, { context: () => null })
    expect(
      await run.execute({ command: 'dataview.rows', args: { lst: '1h' } })
    ).toEqual({
      status: 'error',
      code: 'invalid-args',
      message: 'last: required; unknown field "lst" (did you mean last?)'
    })
  })
})

describe('C-90 Summary made when read', () => {
  it('a summary function is called each time the spec is made', () => {
    let language = 'key'
    const summary = vi.fn(() =>
      language === 'key' ? 'modules.terminal.help.rows' : 'Reads rows.'
    )
    const console = createConsole({ commands: [rows(undefined, { summary })] })
    expect(summary).not.toHaveBeenCalled()
    expect(console.getCommands()[0].summary).toBe('modules.terminal.help.rows')
    language = 'en'
    expect(console.getCommands()[0].summary).toBe('Reads rows.')
  })

  it('help lists and describes with the text of now', async () => {
    let text = 'before'
    const console = createConsole({
      commands: [rows(undefined, { summary: () => text })]
    })
    const [, help] = agentTools(console, { context: () => null })
    text = 'after'
    expect(await help.execute({})).toMatchObject({
      commands: [{ name: 'dataview.rows', summary: 'after' }]
    })
    expect(await help.execute({ command: 'dataview.rows' })).toMatchObject({
      summary: 'after'
    })
  })

  it('a function that throws or returns no string gives no summary', () => {
    const console = createConsole({
      commands: [
        rows(undefined, {
          summary: () => {
            throw new Error('not loaded')
          }
        }),
        rows(undefined, {
          name: 'other',
          summary: (() => 5) as unknown as () => string
        })
      ]
    })
    for (const spec of console.getCommands()) {
      expect(spec).not.toHaveProperty('summary')
    }
  })
})

describe('C-91 Text for a list', () => {
  it('a string for an array of strings is a list of one, before the check', async () => {
    const inputs: Record<string, JsonValue>[] = []
    const console = createConsole({
      commands: [
        rows(undefined, {
          normalize: input => {
            inputs.push(input)
            const columns = (input.columns as string[]).flatMap(c =>
              c.split(',')
            )
            return { ...input, columns }
          }
        })
      ]
    })
    const args = { last: '1h', columns: 'a,b', filter: { hosts: 'h1' } }
    expect(await ask(console, args)).toEqual({ status: 'ok', summary: 'ok' })
    expect(inputs[0]).toMatchObject({
      columns: ['a,b'],
      filter: { hosts: ['h1'], ports: [] }
    })
    // The caller's object is not changed.
    expect(args).toEqual({
      last: '1h',
      columns: 'a,b',
      filter: { hosts: 'h1' }
    })
    // The entry shows the checked input, before `normalize`.
    expect(console.getState().entries[0]).toMatchObject({
      text: `dataview.rows --last 1h --columns a,b --filter '{"hosts":["h1"],"ports":[]}'`
    })
  })

  it('an array of another type is not made from a string', async () => {
    const console = createConsole({ commands: [rows()] })
    expect(await ask(console, { last: '1h', filter: { ports: '80' } })).toEqual(
      {
        status: 'error',
        code: 'invalid-args',
        message: 'filter.ports: expected array of integer'
      }
    )
  })

  it('the run tool and a line read a list the same way', async () => {
    const requests: CommandRequest[] = []
    const console = createConsole({
      commands: [
        rows(request => {
          requests.push(request)
          return { summary: 'ok' }
        })
      ]
    })
    const [, , run] = agentTools(console, { context: () => null })
    await run.execute({
      command: 'dataview.rows',
      args: { last: '1h', columns: 'a' }
    })
    await run.execute({ line: 'dataview.rows --last 1h --columns a' })
    expect(requests.map(r => r.input)).toEqual([
      expect.objectContaining({ columns: ['a'] }),
      expect.objectContaining({ columns: ['a'] })
    ])
  })
})

describe('C-83 Agent tools: run without args', () => {
  it('{ command } alone runs with {}', async () => {
    const requests: CommandRequest[] = []
    const tabsInput: InputSchema = {
      type: 'object',
      properties: { all: { type: 'boolean', default: false } }
    }
    const console = createConsole({
      commands: [
        command(
          'dataview.tabs',
          request => {
            requests.push(request)
            return { summary: '2 tabs' }
          },
          { input: tabsInput, danger: 'read' }
        )
      ]
    })
    const [, , run] = agentTools(console, { context: () => null })
    expect(await run.execute({ command: 'dataview.tabs' })).toEqual({
      status: 'ok',
      summary: '2 tabs'
    })
    expect(
      await console.request({ command: 'dataview.tabs', actor: agent })
    ).toEqual({ status: 'ok', summary: '2 tabs' })
    expect(requests.map(r => r.input)).toEqual([{ all: false }, { all: false }])
  })
})

describe('C-92 Help pages', () => {
  const many = (names: string[], summary = 'Does a thing.') =>
    createConsole({
      commands: names.map(name =>
        command(name, undefined, {
          input: { type: 'object' },
          danger: 'read',
          summary
        })
      )
    })
  const helpOf = (console: Parameters<typeof agentTools>[0]) =>
    agentTools(console, { context: () => null })[1]
  const range = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, i) => `${prefix}.c${i}`)

  it('lists namespaces with their counts and a page of commands', async () => {
    const help = helpOf(
      many(['dataview.search', 'dataview.rows', 'nav.open', 'whoami'])
    )
    expect(await help.execute(undefined)).toEqual({
      namespaces: [
        { name: 'dataview', count: 2 },
        { name: 'nav', count: 1 },
        { name: 'whoami', count: 1 }
      ],
      commands: [
        { name: 'dataview.search', summary: 'Does a thing.', danger: 'read' },
        { name: 'dataview.rows', summary: 'Does a thing.', danger: 'read' },
        { name: 'nav.open', summary: 'Does a thing.', danger: 'read' },
        { name: 'whoami', summary: 'Does a thing.', danger: 'read' }
      ]
    })
  })

  it('prefix keeps one namespace, with or without its dot', async () => {
    const help = helpOf(
      many(['dataview.search', 'dataviews.x', 'dataview', 'nav.open'])
    )
    const names = async (prefix: string) =>
      (
        (await help.execute({ prefix })) as { commands: { name: string }[] }
      ).commands.map(c => c.name)
    expect(await names('dataview')).toEqual(['dataview.search', 'dataview'])
    expect(await names('dataview.')).toEqual(['dataview.search', 'dataview'])
    expect(await names('data')).toEqual([])
    expect(await names('')).toHaveLength(4)
  })

  it('pages by limit (30 by default, 100 at most) and nextCursor', async () => {
    const help = helpOf(many(range('n', 130)))
    const first = (await help.execute({})) as {
      commands: unknown[]
      nextCursor?: string
    }
    expect(first.commands).toHaveLength(30)
    expect(typeof first.nextCursor).toBe('string')
    const big = (await help.execute({ limit: 1000 })) as {
      commands: unknown[]
    }
    expect(big.commands).toHaveLength(100)
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = (await help.execute({ limit: 50, cursor })) as {
        commands: { name: string }[]
        nextCursor?: string
      }
      seen.push(...page.commands.map(c => c.name))
      cursor = page.nextCursor
    } while (cursor !== undefined)
    expect(seen).toEqual(range('n', 130))
  })

  it('a page stays within 8 KB and goes on with nextCursor', async () => {
    const help = helpOf(many(range('n', 100), 'x'.repeat(500)))
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = (await help.execute({ limit: 100, cursor })) as {
        commands: { name: string; summary: string }[]
        nextCursor?: string
      }
      expect(
        new TextEncoder().encode(JSON.stringify(page)).length
      ).toBeLessThanOrEqual(8192)
      expect(page.commands.length).toBeGreaterThan(0)
      expect(page.commands[0].summary).toHaveLength(200)
      seen.push(...page.commands.map(c => c.name))
      cursor = page.nextCursor
    } while (cursor !== undefined)
    expect(seen).toEqual(range('n', 100))
  })

  it('a wrong field is invalid-args with a message', async () => {
    const help = helpOf(many(['a.b']))
    for (const [input, message] of [
      ['a', 'input: expected object'],
      [{ command: 1 }, 'command: expected string'],
      [{ prefix: 1 }, 'prefix: expected string'],
      [{ cursor: 'x' }, 'cursor: not a nextCursor that help returned'],
      [{ cursor: 3 }, 'cursor: not a nextCursor that help returned'],
      [{ limit: 0 }, 'limit: expected integer from 1 to 100'],
      [{ limit: 2.5 }, 'limit: expected integer from 1 to 100']
    ] as const) {
      expect(await help.execute(input)).toEqual({
        status: 'error',
        code: 'invalid-args',
        message
      })
    }
  })

  it('with command it describes one, by name or alias', async () => {
    const console = createConsole({
      commands: [
        rows(undefined, { aliases: ['rows'], usage: 'rows --last 1h' })
      ]
    })
    const help = helpOf(console)
    const one = {
      name: 'dataview.rows',
      summary: 'Reads rows.',
      usage: 'rows --last 1h',
      danger: 'read',
      input: rowsInput
    }
    expect(await help.execute({ command: 'dataview.rows' })).toEqual(one)
    expect(await help.execute({ command: 'rows' })).toEqual(one)
  })
})

describe('C-93 Why not allowed', () => {
  const stopInput: InputSchema = {
    type: 'object',
    properties: {
      bucket: { type: 'string' },
      token: { type: 'string' },
      all: { type: 'boolean' }
    }
  }
  const setup = () => {
    const run = vi.fn(() => ({ summary: 'stopped' }))
    const console = createConsole({
      commands: [
        command('tasks.stop', run, {
          input: stopInput,
          danger: 'change',
          normalize: value => ({ ...value, bucket: 'normalized' })
        }),
        command('tasks.purge', run, {
          input: stopInput,
          danger: 'irreversible'
        }),
        command('plain', run),
        rows()
      ],
      isSensitive: line => line.includes('--token')
    })
    return { console, run }
  }
  const userOnly =
    'tasks.stop changes data; only the user can run it by typing it in the terminal.'

  it('a change command gives the reason and its canonical line, before normalize', async () => {
    const { console, run } = setup()
    const expected = {
      status: 'error',
      code: 'not-allowed',
      message: `${userOnly} Suggest this line to the user instead of retrying.`,
      line: 'tasks.stop --bucket logs --all'
    }
    expect(
      await console.request({
        command: 'tasks.stop',
        args: { bucket: 'logs', all: true },
        actor: agent
      })
    ).toEqual(expected)
    expect(
      await console.request({
        line: 'tasks.stop --all --bucket logs',
        actor: agent
      })
    ).toEqual(expected)
    expect(run).not.toHaveBeenCalled()
    expect(console.getState().entries).toEqual([])
  })

  it('a sensitive line is never handed back', async () => {
    const { console } = setup()
    const outcomes = [
      await console.request({
        command: 'tasks.stop',
        args: { token: 'hunter2' },
        actor: agent
      }),
      await console.request({
        line: 'tasks.stop --token hunter2',
        actor: agent
      })
    ]
    for (const outcome of outcomes) {
      expect(outcome).toEqual({
        status: 'error',
        code: 'not-allowed',
        message: userOnly
      })
      expect(JSON.stringify(outcome)).not.toContain('hunter2')
    }
  })

  it('args that do not match give the reason and no line', async () => {
    const { console } = setup()
    expect(
      await console.request({
        command: 'tasks.stop',
        args: { bucket: 1 },
        actor: agent
      })
    ).toEqual({
      status: 'error',
      code: 'not-allowed',
      message: `${userOnly} Its args do not match its input: bucket: expected string.`
    })
    expect(
      await console.request({
        line: 'tasks.stop --token x --nope',
        actor: agent
      })
    ).toEqual({ status: 'error', code: 'not-allowed', message: userOnly })
  })

  it('every other not-allowed says why, without a line', async () => {
    const { console } = setup()
    expect(
      await console.request({ command: 'tasks.purge', args: {}, actor: agent })
    ).toEqual({
      status: 'error',
      code: 'not-allowed',
      message:
        'tasks.purge cannot be undone, so it never runs from the console, not even when the user types it.'
    })
    expect(await console.request({ line: 'plain', actor: agent })).toEqual({
      status: 'error',
      code: 'not-allowed',
      message:
        'plain is not open to agents; only the user can run it in the terminal.'
    })
    expect(
      await console.request({ line: 'tasks.stop --all', actor: 'assistant' })
    ).toEqual({
      status: 'error',
      code: 'not-allowed',
      message: 'request runs commands for external-agent only.'
    })
    expect(
      await console.request({
        command: 'dataview.rows',
        args: { last: '1h', columns: ['--token'] },
        actor: agent
      })
    ).toEqual({
      status: 'error',
      code: 'not-allowed',
      message:
        'The line is sensitive; only the user can type it in the terminal.'
    })
  })

  it('the run tool hands the reason and the line to the agent', async () => {
    const { console } = setup()
    const run = agentTools(console, { context: () => null })[2]
    expect(
      await run.execute({ command: 'tasks.stop', args: { all: true } })
    ).toEqual({
      status: 'error',
      code: 'not-allowed',
      message: `${userOnly} Suggest this line to the user instead of retrying.`,
      line: 'tasks.stop --all'
    })
  })

  it('run of help or context points at the tool of that name', async () => {
    const pointer = (name: string, code: string) => ({
      status: 'error',
      code,
      message: `${name} is a tool of its own, not a command for run: call the ${name} tool.`
    })
    // The console's own help is not open to agents.
    const withHelp = createConsole({
      commands: [command('help', vi.fn())]
    })
    const run = agentTools(withHelp, { context: () => null })[2]
    expect(await run.execute({ command: 'help' })).toEqual(
      pointer('help', 'not-allowed')
    )
    expect(await run.execute({ line: '  help syslogs' })).toEqual(
      pointer('help', 'not-allowed')
    )
    expect(await run.execute({ line: 'context' })).toEqual(
      pointer('context', 'unknown-command')
    )
    // Any other refusal is the console's.
    const other = agentTools(setup().console, { context: () => null })[2]
    expect(await other.execute({ line: 'plain' })).toEqual({
      status: 'error',
      code: 'not-allowed',
      message:
        'plain is not open to agents; only the user can run it in the terminal.'
    })
  })

  it('the tools say what danger means', () => {
    const [, help, run] = agentTools(setup().console, { context: () => null })
    expect(help.description).toContain(
      'danger: read you can run; change only the user can run'
    )
    expect(run.description).toContain('do not try it, suggest its line')
    expect(run.description).toContain('message?, line?')
  })
})

describe('C-94 Namespace summaries', () => {
  const read = (name: string) =>
    command(name, undefined, { input: { type: 'object' }, danger: 'read' })
  const helpOf = (console: Parameters<typeof agentTools>[0]) =>
    agentTools(console, { context: () => null })[1]

  it('getNamespaces reads each summary now, a function each time', () => {
    let language = 'en'
    const console = createConsole({
      commands: [read('syslogs.search')],
      namespaces: [
        {
          name: 'syslogs',
          summary: () =>
            language === 'en' ? 'Service logs.' : 'Servis logları.'
        },
        { name: 'updater', summary: 'Images and restarts.' },
        { name: 'nav' },
        {
          name: 'broken',
          summary: () => {
            throw new Error('x')
          }
        }
      ]
    })
    expect(console.getNamespaces()).toEqual([
      { name: 'syslogs', summary: 'Service logs.' },
      { name: 'updater', summary: 'Images and restarts.' },
      { name: 'nav' },
      { name: 'broken' }
    ])
    language = 'tr'
    expect(console.getNamespaces()[0]).toEqual({
      name: 'syslogs',
      summary: 'Servis logları.'
    })
    expect(createConsole({ commands: [] }).getNamespaces()).toEqual([])
  })

  it('help lists the summary of the namespaces that have one, cut to 160 code points', async () => {
    const long = '\u{1F600}'.repeat(300)
    const console = createConsole({
      commands: [
        read('syslogs.search'),
        read('updater.status'),
        read('nav.open')
      ],
      namespaces: [
        { name: 'updater', summary: long },
        { name: 'syslogs', summary: () => 'Service logs.' },
        { name: 'unused', summary: 'No command.' }
      ]
    })
    const page = (await helpOf(console).execute({ prefix: 'syslogs' })) as {
      namespaces: { name: string; count: number; summary?: string }[]
      commands: { name: string }[]
    }
    expect(page.namespaces).toEqual([
      { name: 'syslogs', count: 1, summary: 'Service logs.' },
      { name: 'updater', count: 1, summary: '\u{1F600}'.repeat(160) },
      { name: 'nav', count: 1 }
    ])
    expect(page.commands.map(c => c.name)).toEqual(['syslogs.search'])
  })

  it('a console without getNamespaces lists no summaries', async () => {
    const console = createConsole({
      commands: [read('syslogs.search')],
      namespaces: [{ name: 'syslogs', summary: 'Service logs.' }]
    })
    const help = helpOf({
      getCommands: () => console.getCommands(),
      request: input => console.request(input)
    })
    expect(await help.execute(undefined)).toEqual({
      namespaces: [{ name: 'syslogs', count: 1 }],
      commands: [{ name: 'syslogs.search', danger: 'read' }]
    })
  })

  it('the page stays within 8 KB: commands leave first, then summaries from the last', async () => {
    const names = Array.from({ length: 60 }, (_, i) => `n${i}`)
    const console = createConsole({
      commands: names.map(name => read(`${name}.go`)),
      namespaces: names.map(name => ({ name, summary: 'ş'.repeat(160) }))
    })
    const page = (await helpOf(console).execute({ limit: 100 })) as {
      namespaces: { name: string; summary?: string }[]
      commands: unknown[]
    }
    expect(
      new TextEncoder().encode(JSON.stringify(page)).length
    ).toBeLessThanOrEqual(8192)
    expect(page.commands).toHaveLength(1)
    expect(page.namespaces).toHaveLength(60)
    expect(page.namespaces[0].summary).toHaveLength(160)
    expect(page.namespaces[59]).not.toHaveProperty('summary')
  })

  it('validates the namespaces at creation and in setOptions', () => {
    for (const namespaces of [
      'x',
      [{ name: '' }],
      [{ name: 'a.b' }],
      [{ name: 'a b' }],
      [{ name: 'a' }, { name: 'a' }],
      [{ name: 'a', summary: 1 }]
    ]) {
      expect(() =>
        createConsole({ commands: [], namespaces: namespaces as never })
      ).toThrow()
    }
    const console = createConsole({ commands: [] })
    expect(() =>
      console.setOptions(old => ({ ...old, namespaces: [{ name: 'a.b' }] }))
    ).toThrow()
    console.setOptions(old => ({
      ...old,
      namespaces: [{ name: 'syslogs', summary: 'Service logs.' }]
    }))
    expect(console.getNamespaces()).toEqual([
      { name: 'syslogs', summary: 'Service logs.' }
    ])
  })
})
