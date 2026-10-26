import { describe, expect, it, vi } from 'vitest'

import { createConsole, type RunInfo } from '@dolusoft/command-console-core'

import { command, ctrlC, deferred, flush, outputs, withoutIds } from './helpers'
import {
  coreLeakPaths,
  createProbe,
  leakSecret,
  runLeakPath,
  stringsOf,
  type LeakOptions
} from './support/leak-matrix'

const create = (options: LeakOptions) => createConsole(options)

const redactedInput = {
  kind: 'input',
  prompt: '>',
  text: null,
  redacted: true
}

describe('C-30 Sensitivity', () => {
  const commands = [
    command('login', () => 'ok', { sensitive: true, aliases: ['li'] }),
    command('set', () => 'ok', { sensitive: { fromArg: 1 } }),
    command('show', () => 'ok')
  ]

  it.each([
    ['the name', 'login a b'],
    ['an alias', 'li a'],
    ['another case', 'LOGIN a'],
    ['a quoted name', '"login" a'],
    ['a partly quoted name', 'lo"gin" a'],
    ['an unknown case variant', 'Set x y'],
    ['fromArg without the argument', 'set x'],
    ['a line with an open quote', 'login "a']
  ])(
    'a line naming a sensitive command by %s is redacted',
    async (_label, line) => {
      const console = createConsole({ commands })
      await console.run(line)
      expect(console.getState().entries[0]).toEqual({
        id: 'c1',
        ...redactedInput,
        status: 'submitted'
      })
      expect(console.isSensitive(line)).toBe(true)
    }
  )

  it('a line the predicate marks is redacted', async () => {
    const isSensitive = vi.fn((line: string) => line.includes('token'))
    const console = createConsole({ commands, isSensitive })
    await console.run('show token=x')
    expect(console.getState().entries[0]).toMatchObject(redactedInput)
    await console.run('show other')
    expect(console.getState().entries.at(-2)).toMatchObject({
      text: 'show other',
      redacted: false
    })
  })

  it('a throwing predicate marks the line', async () => {
    const console = createConsole({
      commands,
      isSensitive: () => {
        throw new Error('predicate')
      }
    })
    await console.run('show x')
    expect(console.getState().entries[0]).toMatchObject(redactedInput)
    expect(console.isSensitive('show x')).toBe(true)
  })

  it('a line that is not sensitive keeps its text', async () => {
    const console = createConsole({ commands })
    await console.run('show login')
    expect(console.getState().entries[0]).toMatchObject({
      text: 'show login',
      redacted: false
    })
    expect(console.isSensitive('show login')).toBe(false)
  })

  it('a sensitive line increments input.revision', async () => {
    const console = createConsole({ commands })
    await console.run('show x')
    expect(console.getState().input.revision).toBe(0)
    console.setInput('login x')
    await console.submit()
    expect(console.getState().input.revision).toBe(1)
  })
})

describe('C-32 Redacted cancel', () => {
  it('a sensitive line ended with Ctrl+C is redacted and cleared', () => {
    const console = createConsole({
      commands: [command('login', undefined, { sensitive: true })]
    })
    console.setInput('login admin hunter2')
    console.handleKey(ctrlC)
    expect(withoutIds(console.getState().entries)).toEqual([
      { ...redactedInput, status: 'cancelled' }
    ])
    expect(console.getState().input).toEqual({
      value: '',
      caret: 0,
      revision: 1
    })
  })
})

describe('C-33 Redacted messages', () => {
  it('command-not-found carries name null for a sensitive line', async () => {
    const console = createConsole({
      commands: [],
      isSensitive: line => line.includes('hunter2')
    })
    await console.run('hunter2')
    expect(outputs(console.getState().entries)[0].blocks).toEqual([
      { type: 'message', code: 'command-not-found', params: { name: null } }
    ])
  })

  it('unterminated-quote carries index null for a sensitive line', async () => {
    const console = createConsole({
      commands: [command('login', undefined, { sensitive: true })]
    })
    await console.run('login "hunter2')
    expect(outputs(console.getState().entries)[0].blocks).toEqual([
      {
        type: 'message',
        code: 'unterminated-quote',
        params: { index: null }
      }
    ])
  })

  it('RunInfo never carries the line or arguments, for any command', async () => {
    const infos: RunInfo[] = []
    const console = createConsole({
      commands: [
        command('login', undefined, { sensitive: true, aliases: ['li'] }),
        command('show', () => {
          throw new Error('x')
        })
      ],
      beforeRun: info => {
        infos.push(info)
        return undefined
      },
      onError: (_error, info) => {
        if (info) {
          infos.push(info)
        }
      }
    })
    await console.run('li hunter2')
    await console.run('show hunter2')
    expect(infos).toHaveLength(3)
    expect(infos[0]).toMatchObject({
      name: null,
      command: 'login',
      sensitive: true
    })
    expect(infos[1]).toMatchObject({ name: 'show', sensitive: false })
    for (const info of infos) {
      expect(Object.keys(info).sort()).toEqual([
        'command',
        'context',
        'inputId',
        'name',
        'runId',
        'sensitive'
      ])
      expect(JSON.stringify(info)).not.toContain('hunter2')
    }
  })
})

describe('C-34 No error text', () => {
  it('the default error entry carries no part of the error', async () => {
    const error = Object.assign(new Error('hunter2 rejected'), {
      detail: 'hunter2',
      cause: new Error('hunter2 cause')
    })
    const pending = deferred<string>()
    const console = createConsole({
      commands: [
        command('sync', () => {
          throw error
        }),
        command('async', () => pending.promise),
        command('value', () => {
          // A thrown non-Error value is not rendered either.
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'hunter2 string'
        })
      ],
      onError: () => undefined
    })
    await console.run('sync')
    const done = console.run('async')
    pending.reject(error)
    await done
    await console.run('value')
    await flush()
    const out = outputs(console.getState().entries)
    expect(out).toHaveLength(3)
    for (const entry of out) {
      expect(entry.blocks).toEqual([
        { type: 'message', code: 'command-failed' }
      ])
    }
    expect(JSON.stringify(console.getState())).not.toContain('hunter2')
  })
})

describe('C-36 Leak matrix (core paths)', () => {
  it.each(coreLeakPaths.map(path => [path.name, path] as const))(
    '%s leaves no trace of the secret',
    async (_name, path) => {
      expect(await runLeakPath(path, create)).toEqual([])
    }
  )

  it('the probe finds a planted secret everywhere it looks', async () => {
    const probe = createProbe(leakSecret)
    const error = new Error(`message ${leakSecret}`, {
      cause: { deep: [leakSecret] }
    })
    probe.scan({ error, [Symbol(leakSecret)]: 1 }, 'planted')
    const where = probe.findings.map(f => f.where)
    expect(where).toContain('planted.error.message')
    expect(where).toContain('planted.error.stack')
    expect(where).toContain('planted.error.cause.deep.0')
    expect(where).toContain('planted[key Symbol(s3cr3t-Vt7q)]')

    // An updater is resolved before it is scanned; a leaking console is caught.
    const leaky = await runLeakPath(
      {
        name: 'leaky',
        drive: async ({ console, secret }) => {
          await console.run(`echo ${secret}`)
        }
      },
      create
    )
    expect(leaky.some(f => f.where.startsWith('onEntriesChange[0]'))).toBe(true)
    expect(leaky.some(f => f.where.startsWith('subscribe['))).toBe(true)
    expect(leaky.some(f => f.where.includes(':state'))).toBe(true)
  })

  it('stringsOf reads Error fields that are not own properties', () => {
    const error = new TypeError('inherited')
    const strings = stringsOf(error).map(([, text]) => text)
    expect(strings).toContain('inherited')
    expect(strings).toContain('TypeError')
  })
})
