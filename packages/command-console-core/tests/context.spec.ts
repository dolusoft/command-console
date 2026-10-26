// The context feature (spec §6.7, §3.4): C-26, C-27 with frames, C-62 and
// the context paths of the leak matrix (C-36).
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  contextFeature,
  createConsole,
  type CommandRequest,
  type ContextAPI,
  type RunContext,
  type RunInfo,
  type Updater
} from '@dolusoft/command-console-core'
import type {
  CommandResponse,
  ConsoleEntry,
  ContextFrame,
  InputEntry
} from '@dolusoft/command-protocol'

import {
  command,
  deepFreeze,
  deferred,
  enter,
  flush,
  outputs,
  returning
} from './helpers'
import { contextLeakPaths } from './support/context-leak-paths'
import {
  runLeakPath,
  type LeakConsole,
  type LeakOptions
} from './support/leak-matrix'

const db: ContextFrame = { id: 'db', prompt: 'db>', data: { service: 'db' } }
const users: ContextFrame = { id: 'users', prompt: 'db/users>' }
const logs: ContextFrame = { id: 'logs', prompt: 'logs>' }

const features = { contextFeature }

const resolve = <T>(updater: Updater<T>, old: T): T =>
  typeof updater === 'function' ? (updater as (old: T) => T)(old) : updater

const prompts = (entries: readonly ConsoleEntry[]) =>
  entries
    .filter((entry): entry is InputEntry => entry.kind === 'input')
    .map(entry => entry.prompt)

const ids = (frames: readonly ContextFrame[]) => frames.map(frame => frame.id)

describe('C-26 Context stack', () => {
  it('adds pushContext, popContext and resetContext to the instance and its type', () => {
    const console = createConsole({ commands: [], features })
    expectTypeOf(console).toExtend<ContextAPI>()
    for (const name of ['pushContext', 'popContext', 'resetContext']) {
      expect(typeof (console as unknown as Record<string, unknown>)[name]).toBe(
        'function'
      )
    }
  })

  it('push-context, pop-context and reset-context effects change the stack', async () => {
    const console = createConsole({
      features,
      commands: [
        returning('enter', {
          effects: [
            { type: 'push-context', frame: db },
            { type: 'push-context', frame: users }
          ]
        }),
        returning('end', { effects: [{ type: 'pop-context' }] }),
        returning('up', { effects: [{ type: 'pop-context', count: 2 }] }),
        returning('top', { effects: [{ type: 'reset-context' }] })
      ]
    })
    await console.run('enter')
    expect(console.getState().context).toEqual([db, users])
    await console.run('end')
    expect(console.getState().context).toEqual([db])
    await console.run('enter')
    await console.run('up')
    expect(console.getState().context).toEqual([db])
    await console.run('enter')
    await console.run('top')
    expect(console.getState().context).toEqual([])
  })

  it('the methods of the same names change the stack, one action each', () => {
    const console = createConsole({ commands: [], features })
    const listener = vi.fn()
    console.subscribe(listener)
    console.pushContext(db)
    console.pushContext(users)
    console.pushContext(logs)
    expect(console.getState().context).toEqual([db, users, logs])
    expect(listener).toHaveBeenCalledTimes(3)
    console.popContext()
    expect(console.getState().context).toEqual([db, users])
    console.popContext(5)
    expect(console.getState().context).toEqual([])
    console.pushContext(db)
    console.pushContext(users)
    console.resetContext()
    expect(console.getState().context).toEqual([])
    expect(listener).toHaveBeenCalledTimes(8)
  })

  it('popping at the root, popping nothing and resetting the root do nothing', async () => {
    const onContextChange = vi.fn()
    const console = createConsole({
      features,
      commands: [
        returning('pop', {
          effects: [
            { type: 'pop-context' },
            { type: 'pop-context', count: 3 },
            { type: 'reset-context' }
          ]
        })
      ],
      state: { context: [] },
      onContextChange
    })
    const listener = vi.fn()
    console.subscribe(listener)
    console.popContext()
    console.popContext(4)
    console.resetContext()
    expect(listener).not.toHaveBeenCalled()
    await console.run('pop')
    expect(onContextChange).not.toHaveBeenCalled()
  })

  it('a count below 1 pops nothing', () => {
    const console = createConsole({
      features,
      commands: [],
      initialState: { context: [db] }
    })
    const listener = vi.fn()
    console.subscribe(listener)
    console.popContext(0)
    console.popContext(-1)
    console.popContext(Number.NaN)
    console.popContext(0.5)
    expect(console.getState().context).toEqual([db])
    expect(listener).not.toHaveBeenCalled()
  })

  it('a count is rounded down', () => {
    const console = createConsole({
      features,
      commands: [],
      initialState: { context: [db, users, logs] }
    })
    console.popContext(1.9)
    expect(ids(console.getState().context)).toEqual(['db', 'users'])
    console.popContext(Number.POSITIVE_INFINITY)
    expect(console.getState().context).toEqual([])
  })

  it('a request and RunInfo carry the snapshot taken at the run start', async () => {
    const pending = deferred<string>()
    const requests: CommandRequest[] = []
    const infos: RunInfo[] = []
    const console = createConsole({
      features,
      commands: [
        command('a', request => {
          requests.push(request)
          return pending.promise
        })
      ],
      beforeRun: info => void infos.push(info),
      initialState: { context: [db] }
    })
    const done = console.run('a')
    console.pushContext(users)
    expect(requests[0].context).toEqual([db])
    expect(infos[0].context).toEqual([db])
    pending.resolve('ok')
    await done
    expect(requests[0].context).toEqual([db])
    expect(infos[0].context).toEqual([db])
    expect(console.getState().context).toEqual([db, users])
  })

  it('the snapshot is a copy: changing the stack later does not change it', async () => {
    const seen: ContextFrame[][] = []
    const console = createConsole({
      features,
      commands: [command('a', request => void seen.push(request.context))]
    })
    console.pushContext(db)
    await console.run('a')
    console.pushContext(users)
    await console.run('a')
    expect(seen).toEqual([[db], [db, users]])
    expect(seen[0]).not.toBe(console.getState().context)
  })

  it('effects apply in order before the output', async () => {
    const seen: string[] = []
    const console = createConsole({
      features,
      commands: [
        returning('a', {
          output: 'here',
          effects: [
            { type: 'push-context', frame: db },
            { type: 'pop-context' },
            { type: 'push-context', frame: logs }
          ]
        })
      ]
    })
    console.subscribe(state => seen.push(ids(state.context).join('/')))
    await console.run('a')
    expect(console.getState().context).toEqual([logs])
    expect(outputs(console.getState().entries)[0].blocks).toEqual([
      { type: 'text', text: 'here' }
    ])
    expect(seen.at(-1)).toBe('logs')
  })

  it('a run’s own context effects do not abort it', async () => {
    let signal!: AbortSignal
    const console = createConsole({
      features,
      commands: [
        command('a', (_request, run) => {
          signal = run.signal
          return { effects: [{ type: 'push-context', frame: db }] }
        })
      ]
    })
    await console.run('a')
    expect(signal.aborted).toBe(false)
    expect(console.getState().context).toEqual([db])
  })

  it('a controlled context gets one updater per action that composes the effects', async () => {
    const reports: Updater<ContextFrame[]>[] = []
    const context: ContextFrame[] = deepFreeze([db])
    const console = createConsole({
      features,
      commands: [
        returning('a', {
          effects: [
            { type: 'push-context', frame: users },
            { type: 'push-context', frame: logs },
            { type: 'pop-context' }
          ]
        })
      ],
      state: { context },
      onContextChange: updater => void reports.push(updater)
    })
    await console.run('a')
    expect(reports).toHaveLength(1)
    expect(resolve(reports[0], context)).toEqual([db, users])
    expect(context).toEqual([db])
    console.setOptions(old => ({
      ...old,
      state: { context: resolve(reports[0], context) }
    }))
    expect(console.getPrompt()).toBe('db/users>')
  })

  it('deep-frozen frames work through every method and effect', async () => {
    const frozen = deepFreeze({ id: 'f', prompt: 'f>', data: { a: [1] } })
    const console = createConsole({
      features,
      commands: [
        returning(
          'a',
          deepFreeze({
            effects: [{ type: 'push-context', frame: frozen }]
          }) as CommandResponse
        )
      ],
      initialState: { context: deepFreeze([db]) }
    })
    await console.run('a')
    console.pushContext(frozen)
    console.popContext()
    console.resetContext()
    expect(console.getState().context).toEqual([])
  })

  it('reset() returns to the initial context', () => {
    const console = createConsole({
      features,
      commands: [],
      initialState: { context: [db] }
    })
    console.pushContext(users)
    console.reset()
    expect(console.getState().context).toEqual([db])
    expect(console.getPrompt()).toBe('db>')
  })

  it('methods do nothing after dispose', () => {
    const console = createConsole({ commands: [], features })
    console.dispose()
    expect(() => {
      console.pushContext(db)
      console.popContext()
      console.resetContext()
    }).not.toThrow()
    expect(console.getState().context).toEqual([])
  })

  it('two consoles keep their own stacks', () => {
    const a = createConsole({ commands: [], features })
    const b = createConsole({ commands: [], features })
    a.pushContext(db)
    expect(b.getState().context).toEqual([])
    expect(b.getPrompt()).toBe('>')
    a.dispose()
    b.pushContext(users)
    expect(b.getPrompt()).toBe('db/users>')
  })
})

describe('C-27 Prompt snapshot (with frames)', () => {
  it('the next prompt follows the top frame, else the root prompt', () => {
    const console = createConsole({ commands: [], features, prompt: 'app>' })
    expect(console.getPrompt()).toBe('app>')
    console.pushContext(db)
    expect(console.getPrompt()).toBe('db>')
    console.pushContext(users)
    expect(console.getPrompt()).toBe('db/users>')
    console.popContext()
    expect(console.getPrompt()).toBe('db>')
    console.resetContext()
    expect(console.getPrompt()).toBe('app>')
  })

  it('an input entry keeps the prompt it was ended with', async () => {
    const console = createConsole({
      features,
      commands: [
        returning('db', { effects: [{ type: 'push-context', frame: db }] }),
        returning('end', { effects: [{ type: 'pop-context' }] })
      ]
    })
    await console.run('db')
    console.setInput('')
    console.handleKey(enter)
    console.setInput('nope')
    console.cancel()
    await console.run('end')
    await console.run('db')
    console.pushContext(users)
    console.resetContext()
    expect(prompts(console.getState().entries)).toEqual([
      '>',
      'db>',
      'db>',
      'db>',
      '>'
    ])
    expect(console.getPrompt()).toBe('>')
  })

  it('initialState.context sets the first prompt', () => {
    const console = createConsole({
      commands: [],
      features,
      initialState: { context: [db, users] }
    })
    expect(console.getPrompt()).toBe('db/users>')
  })

  it('a controlled context sets the prompt from options', () => {
    const console = createConsole({
      commands: [],
      features,
      state: { context: [db] }
    })
    expect(console.getPrompt()).toBe('db>')
    console.setOptions(old => ({ ...old, state: { context: [logs] } }))
    expect(console.getPrompt()).toBe('logs>')
  })
})

describe('C-62 External context change', () => {
  const pendingCommand = () => {
    const pending = deferred<CommandResponse>()
    let run!: RunContext
    const definition = command('a', (_request, context) => {
      run = context
      return pending.promise
    })
    return { pending, definition, run: () => run }
  }

  it('a context method during a run aborts it and drops its context effects; its output appears', async () => {
    const { pending, definition, run } = pendingCommand()
    const console = createConsole({ features, commands: [definition] })
    const done = console.run('a')
    expect(run().signal.aborted).toBe(false)
    console.pushContext(db)
    expect(run().signal.aborted).toBe(true)
    run().write('progress')
    pending.resolve({
      output: 'still shown',
      effects: [
        { type: 'reset-context' },
        { type: 'push-context', frame: logs }
      ]
    })
    expect(await done).toBe(true)
    expect(console.getState().context).toEqual([db])
    expect(
      outputs(console.getState().entries).map(entry => entry.blocks)
    ).toEqual([
      [{ type: 'text', text: 'progress' }],
      [{ type: 'text', text: 'still shown' }]
    ])
    expect(console.getState().running).toBeNull()
  })

  it.each([
    ['popContext', (c: ContextAPI) => c.popContext()],
    ['resetContext', (c: ContextAPI) => c.resetContext()]
  ] as const)('%s during a run aborts it too', async (_name, call) => {
    const { pending, definition, run } = pendingCommand()
    const console = createConsole({
      features,
      commands: [definition],
      initialState: { context: [db] }
    })
    const done = console.run('a')
    call(console)
    expect(run().signal.aborted).toBe(true)
    pending.resolve({ effects: [{ type: 'push-context', frame: users }] })
    await done
    expect(console.getState().context).toEqual([])
  })

  it('a context method called from inside the command aborts it', async () => {
    const seen: boolean[] = []
    const console = createConsole({
      features,
      commands: [
        command('a', (_request, run) => {
          console.pushContext(db)
          seen.push(run.signal.aborted)
          return { effects: [{ type: 'push-context', frame: logs }] }
        })
      ]
    })
    await console.run('a')
    expect(seen).toEqual([true])
    expect(console.getState().context).toEqual([db])
  })

  it('a context method that changes nothing does not abort the run', async () => {
    const { pending, definition, run } = pendingCommand()
    const console = createConsole({ features, commands: [definition] })
    const done = console.run('a')
    console.popContext()
    console.resetContext()
    expect(run().signal.aborted).toBe(false)
    pending.resolve({ effects: [{ type: 'push-context', frame: db }] })
    await done
    expect(console.getState().context).toEqual([db])
  })

  it('an external controlled context with other ids aborts the run', async () => {
    const { pending, definition, run } = pendingCommand()
    const console = createConsole({
      features,
      commands: [definition],
      state: { context: [db] },
      onContextChange: () => undefined
    })
    const done = console.run('a')
    console.setOptions(old => ({ ...old, state: { context: [logs] } }))
    expect(run().signal.aborted).toBe(true)
    expect(console.getPrompt()).toBe('logs>')
    pending.resolve({ output: 'shown', effects: [{ type: 'pop-context' }] })
    await done
    expect(console.getState().context).toEqual([logs])
    expect(outputs(console.getState().entries)).toHaveLength(1)
  })

  it('a new array with the same ids is not a change', async () => {
    const { pending, definition, run } = pendingCommand()
    const reports: Updater<ContextFrame[]>[] = []
    const console = createConsole({
      features,
      commands: [definition],
      state: { context: [db] },
      onContextChange: updater => void reports.push(updater)
    })
    const done = console.run('a')
    console.setOptions(old => ({
      ...old,
      state: { context: [{ ...db, data: 'edited' }] }
    }))
    expect(run().signal.aborted).toBe(false)
    pending.resolve({ effects: [{ type: 'push-context', frame: users }] })
    await done
    expect(reports).toHaveLength(1)
    expect(ids(resolve(reports[0], [db]))).toEqual(['db', 'users'])
  })

  it('a context changed and reverted by a consumer that dropped the report still drops the effects', async () => {
    const { pending, definition, run } = pendingCommand()
    const console = createConsole({
      features,
      commands: [definition],
      state: { context: [db] },
      onContextChange: () => undefined
    })
    const done = console.run('a')
    console.pushContext(users)
    expect(run().signal.aborted).toBe(true)
    await flush()
    // The report was dropped: the consumer's value is the base again.
    expect(console.getState().context).toEqual([db])
    pending.resolve({ effects: [{ type: 'reset-context' }] })
    await done
    expect(console.getState().context).toEqual([db])
  })

  it('a change after the run ended does not touch the next run', async () => {
    const console = createConsole({
      features,
      commands: [
        command('a', (_request, run) => ({
          output: String(run.signal.aborted),
          effects: [{ type: 'push-context', frame: logs }]
        }))
      ]
    })
    console.pushContext(db)
    await console.run('a')
    expect(ids(console.getState().context)).toEqual(['db', 'logs'])
    expect(outputs(console.getState().entries)[0].blocks).toEqual([
      { type: 'text', text: 'false' }
    ])
  })

  it('an unchanged setOptions or another controlled slice does not abort the run', async () => {
    const { pending, definition, run } = pendingCommand()
    const context: ContextFrame[] = [db]
    const console = createConsole({
      features,
      commands: [definition],
      state: { context, recall: [] }
    })
    const done = console.run('a')
    console.setOptions(old => ({ ...old }))
    console.setOptions(old => ({
      ...old,
      state: { context, recall: ['x'] }
    }))
    expect(run().signal.aborted).toBe(false)
    pending.resolve({})
    await done
  })
})

describe('C-36 Leak matrix (context paths)', () => {
  // The matrix types its consoles with every feature; this one has context.
  const create = (options: LeakOptions) =>
    createConsole({ ...options, features }) as unknown as LeakConsole

  it.each(contextLeakPaths.map(path => [path.name, path] as const))(
    '%s leaves no trace of the secret',
    async (_name, path) => {
      expect(await runLeakPath(path, create)).toEqual([])
    }
  )
})
