// The recall feature (README: Recall, Keyboard; core README: Lifecycle):
// C-19..C-23, C-31 and the recall paths of C-36.
import { describe, expect, it, vi } from 'vitest'

import {
  createConsole,
  recallFeature,
  type CommandDefinition,
  type ConsoleOptions,
  type Updater
} from '@dolusoft/command-console-core'

import {
  command,
  ctrlC,
  deepFreeze,
  deferred,
  enter,
  flush,
  key,
  returning
} from './helpers'
import {
  coreLeakPaths,
  runLeakPath,
  type LeakConsole,
  type LeakOptions
} from './support/leak-matrix'
import { recallLeakPaths } from './support/recall-leak-paths'

const up = key('ArrowUp')
const down = key('ArrowDown')

type RecallOptions = ConsoleOptions<{ recallFeature: typeof recallFeature }>

const commands: CommandDefinition[] = [
  returning('echo', 'ok'),
  command('login', () => 'ok', { sensitive: true }),
  command('set', () => 'ok', { sensitive: { fromArg: 1 } }),
  command('fail', () => {
    throw new Error('no')
  })
]

const make = (options: Partial<RecallOptions> = {}) =>
  createConsole({
    features: { recallFeature },
    commands,
    onError: () => undefined,
    ...options
  })

const submitAll = async (console: ReturnType<typeof make>, lines: string[]) => {
  for (const line of lines) {
    await console.run(line)
  }
}

const resolve = <T>(updater: Updater<T>, old: T): T =>
  typeof updater === 'function' ? (updater as (o: T) => T)(old) : updater

describe('C-19 Recall order', () => {
  it('records unique lines oldest → newest, trimmed', async () => {
    const console = make()
    await submitAll(console, ['echo a', '  echo b  ', 'echo c'])
    expect(console.getState().recall).toEqual(['echo a', 'echo b', 'echo c'])
  })

  it('re-recording a line moves it to the newest position', async () => {
    const console = make()
    await submitAll(console, ['echo a', 'echo b', 'echo c', 'echo a'])
    expect(console.getState().recall).toEqual(['echo b', 'echo c', 'echo a'])
  })

  it('re-recording the newest line changes nothing and notifies nothing about recall', async () => {
    const reports: Updater<string[]>[] = []
    const console = make({
      initialState: {},
      state: { recall: ['echo a'] },
      onRecallChange: updater => reports.push(updater)
    })
    await console.run('echo a')
    expect(reports).toEqual([])
  })

  it('starts from initialState.recall and never mutates it', async () => {
    const initial = deepFreeze(['echo a', 'echo b'])
    const console = make({ initialState: { recall: initial } })
    await submitAll(console, ['echo a', 'echo c'])
    expect(console.getState().recall).toEqual(['echo b', 'echo a', 'echo c'])
    expect(initial).toEqual(['echo a', 'echo b'])
  })

  it('reports a controlled recall through one composed updater per action', async () => {
    const reports: Updater<string[]>[] = []
    const controlled = deepFreeze(['echo a', 'echo b'])
    const console = make({
      state: { recall: controlled },
      onRecallChange: updater => reports.push(updater)
    })
    await console.run('echo a')
    expect(reports).toHaveLength(1)
    expect(resolve(reports[0], controlled)).toEqual(['echo b', 'echo a'])
    // Composed onto whatever the consumer holds.
    expect(resolve(reports[0], ['x'])).toEqual(['x', 'echo a'])
    // The console reads the slice from the options: the consumer ignored it.
    expect(console.getState().recall).toBe(controlled)
  })

  it('without the feature nothing is recorded and arrows are not handled', async () => {
    const console = createConsole({ commands })
    await console.run('echo a')
    expect(console.getState().recall).toEqual([])
    expect(console.handleKey(up)).toBe(false)
    expect(console.handleKey(down)).toBe(false)
    expect('recallPrevious' in console).toBe(false)
  })
})

describe('C-20 Recall browsing', () => {
  it('ArrowUp keeps the draft and shows the newest, then goes older and stops at the oldest', async () => {
    const console = make()
    await submitAll(console, ['echo a', 'echo b'])
    console.setInput('ech', 2)
    expect(console.handleKey(up)).toBe(true)
    let state = console.getState()
    expect(state.input.value).toBe('echo b')
    expect(state.input.caret).toBe(6)
    expect(state.recallDraft).toBe('ech')
    expect(state.recallCursor).toBe(1)
    expect(console.handleKey(up)).toBe(true)
    expect(console.getState().input.value).toBe('echo a')
    expect(console.getState().recallCursor).toBe(0)
    // At the oldest: nothing changes and the key is left to the browser.
    expect(console.handleKey(up)).toBe(false)
    state = console.getState()
    expect(state.input.value).toBe('echo a')
    expect(state.recallCursor).toBe(0)
    expect(state.recallDraft).toBe('ech')
  })

  it('ArrowDown goes newer, and past the newest restores the draft and ends browsing', async () => {
    const console = make()
    await submitAll(console, ['echo a', 'echo b'])
    console.setInput('draft')
    console.recallPrevious()
    console.recallPrevious()
    expect(console.handleKey(down)).toBe(true)
    expect(console.getState().input.value).toBe('echo b')
    expect(console.handleKey(down)).toBe(true)
    const state = console.getState()
    expect(state.input.value).toBe('draft')
    expect(state.input.caret).toBe(5)
    expect(state.recallCursor).toBeNull()
    expect(state.recallDraft).toBeNull()
    // Not browsing: ArrowDown is not handled.
    expect(console.handleKey(down)).toBe(false)
    expect(console.recallNext()).toBe(false)
  })

  it('an empty draft is restored as an empty input', async () => {
    const console = make()
    await console.run('echo a')
    console.recallPrevious()
    const revision = console.getState().input.revision
    console.recallNext()
    expect(console.getState().input.value).toBe('')
    // A programmatic clear of a non-empty input replaces the element.
    expect(console.getState().input.revision).toBe(revision + 1)
  })

  it('ArrowUp with an empty list is not handled', () => {
    const console = make()
    console.setInput('x')
    expect(console.handleKey(up)).toBe(false)
    expect(console.getState().recallDraft).toBeNull()
    expect(console.getState().input.value).toBe('x')
  })

  it('a user edit ends browsing and keeps the edited text', async () => {
    const console = make()
    await submitAll(console, ['echo a', 'echo b'])
    console.setInput('draft')
    console.recallPrevious()
    console.editInput('echo bx', 7)
    let state = console.getState()
    expect(state.input.value).toBe('echo bx')
    expect(state.recallCursor).toBeNull()
    expect(state.recallDraft).toBeNull()
    // The next ArrowUp starts again from the newest, with the edit as draft.
    console.recallPrevious()
    state = console.getState()
    expect(state.input.value).toBe('echo b')
    expect(state.recallDraft).toBe('echo bx')
  })

  it('a programmatic setInput ends browsing too', async () => {
    const console = make()
    await console.run('echo a')
    console.recallPrevious()
    console.setInput('other')
    expect(console.getState().recallCursor).toBeNull()
    expect(console.getState().input.value).toBe('other')
  })

  it('a caret move does not end browsing', async () => {
    const console = make()
    await submitAll(console, ['echo a', 'echo b'])
    console.recallPrevious()
    console.editInput('echo b', 0)
    expect(console.getState().recallCursor).toBe(1)
    console.recallPrevious()
    expect(console.getState().input.value).toBe('echo a')
  })

  it('an external change of a controlled recall ends browsing', () => {
    let recall = ['echo a', 'echo b']
    const options: RecallOptions = {
      features: { recallFeature },
      commands,
      state: { recall },
      onRecallChange: updater => {
        recall = resolve(updater, recall)
      }
    }
    const console = createConsole(options)
    console.setInput('draft')
    console.recallPrevious()
    expect(console.getState().recallCursor).toBe(1)
    console.setOptions(old => ({ ...old, state: { recall: ['echo z'] } }))
    const state = console.getState()
    expect(state.recallCursor).toBeNull()
    expect(state.recallDraft).toBeNull()
    expect(state.input.value).toBe('echo b')
    expect(state.recall).toEqual(['echo z'])
  })

  it('setOptions with the same recall array keeps browsing', () => {
    const recall = ['echo a']
    const console = make({ state: { recall } })
    console.recallPrevious()
    console.setOptions(old => ({ ...old, prompt: '$' }))
    expect(console.getState().recallCursor).toBe(0)
  })

  it('every line end drops the cursor and the draft', async () => {
    const console = make()
    await console.run('echo a')
    console.setInput('draft')
    console.recallPrevious()
    console.handleKey(ctrlC)
    expect(console.getState().recallCursor).toBeNull()
    expect(console.getState().recallDraft).toBeNull()
    console.recallPrevious()
    console.handleKey(enter)
    await flush()
    expect(console.getState().recallCursor).toBeNull()
    expect(console.getState().recallDraft).toBeNull()
    console.setInput('draft')
    console.recallPrevious()
    console.reset()
    expect(console.getState().recallCursor).toBeNull()
    expect(console.getState().recallDraft).toBeNull()
  })

  it('submitting a recalled line runs it and moves it to the newest', async () => {
    const run = vi.fn(() => 'ok')
    const console = make({
      commands: [...commands, command('hello', run)]
    })
    await submitAll(console, ['hello there', 'echo b'])
    console.recallPrevious()
    console.recallPrevious()
    console.handleKey(enter)
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
    expect(console.getState().recall).toEqual(['echo b', 'hello there'])
  })

  it('recall keys and methods do nothing while a command runs', async () => {
    const pending = deferred<string>()
    const console = make({
      commands: [...commands, command('slow', () => pending.promise)]
    })
    await console.run('echo a')
    const done = console.run('slow')
    expect(console.handleKey(up)).toBe(false)
    expect(console.recallPrevious()).toBe(false)
    expect(console.getState().input.value).toBe('')
    pending.resolve('done')
    await done
    expect(console.recallPrevious()).toBe(true)
  })

  it('browsing notifies once per key and reports nothing for recall', () => {
    const onRecallChange = vi.fn()
    const console = make({ state: { recall: ['echo a'] }, onRecallChange })
    const listener = vi.fn()
    console.subscribe(listener)
    console.handleKey(up)
    console.handleKey(down)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(onRecallChange).not.toHaveBeenCalled()
  })

  it('after dispose the methods do nothing', async () => {
    const console = make()
    await console.run('echo a')
    console.dispose()
    expect(console.recallPrevious()).toBe(false)
    expect(console.recallNext()).toBe(false)
    expect(() => console.clearRecall()).not.toThrow()
  })
})

describe('C-21 Recall filter', () => {
  it('records unknown commands, unparsable lines and failures', async () => {
    const console = make()
    await submitAll(console, ['nope 1', 'echo "open', 'fail now'])
    expect(console.getState().recall).toEqual([
      'nope 1',
      'echo "open',
      'fail now'
    ])
  })

  it('does not record empty or cancelled lines', async () => {
    const console = make()
    await submitAll(console, ['', '   '])
    console.setInput('echo cancelled')
    console.cancel()
    expect(console.getState().recall).toEqual([])
  })

  it('shouldRecord runs before insertion with the trimmed line', async () => {
    const shouldRecord = vi.fn((line: string) => !line.startsWith('echo s'))
    const console = make({ shouldRecord })
    await submitAll(console, ['echo a', ' echo skip ', 'echo b'])
    expect(shouldRecord.mock.calls.map(([line]) => line)).toEqual([
      'echo a',
      'echo skip',
      'echo b'
    ])
    expect(console.getState().recall).toEqual(['echo a', 'echo b'])
  })

  it('a throwing shouldRecord records nothing and reports through onError', async () => {
    const error = new Error('shouldRecord')
    const onError = vi.fn()
    const console = make({
      shouldRecord: () => {
        throw error
      },
      onError
    })
    expect(await console.run('echo a')).toBe(true)
    expect(console.getState().recall).toEqual([])
    expect(onError).toHaveBeenCalledWith(error, null)
    // The command ran anyway.
    expect(console.getState().entries.at(-1)).toMatchObject({
      kind: 'output',
      blocks: [{ type: 'text', text: 'ok' }]
    })
  })

  it('sensitivity runs before insertion: shouldRecord never sees a sensitive line', async () => {
    const shouldRecord = vi.fn(() => true)
    const console = make({
      shouldRecord,
      isSensitive: line => line.includes('--token')
    })
    await submitAll(console, ['login x', 'set a b', 'echo x --token'])
    expect(shouldRecord).not.toHaveBeenCalled()
    expect(console.getState().recall).toEqual([])
  })
})

describe('C-22 Recall limit', () => {
  it('drops the oldest beyond recallLimit', async () => {
    const console = make({ recallLimit: 2 })
    await submitAll(console, ['echo a', 'echo b', 'echo c'])
    expect(console.getState().recall).toEqual(['echo b', 'echo c'])
  })

  it('defaults to 100', async () => {
    const console = make()
    await submitAll(
      console,
      Array.from({ length: 101 }, (_, i) => `echo ${i}`)
    )
    const { recall } = console.getState()
    expect(recall).toHaveLength(100)
    expect(recall[0]).toBe('echo 1')
  })

  it('applies to a re-recorded newest line over a longer seeded list', async () => {
    const console = make({
      recallLimit: 1,
      initialState: { recall: ['echo a', 'echo b'] }
    })
    await console.run('echo b')
    expect(console.getState().recall).toEqual(['echo b'])
  })

  it('a limit of 0 records nothing; an invalid limit falls back to the default', async () => {
    const none = make({ recallLimit: 0 })
    await none.run('echo a')
    expect(none.getState().recall).toEqual([])
    const invalid = make({ recallLimit: Number.NaN })
    await invalid.run('echo a')
    expect(invalid.getState().recall).toEqual(['echo a'])
  })

  it('follows setOptions', async () => {
    const console = make()
    await submitAll(console, ['echo a', 'echo b'])
    console.setOptions(old => ({ ...old, recallLimit: 1 }))
    await console.run('echo c')
    expect(console.getState().recall).toEqual(['echo c'])
  })
})

describe('C-23 Clear recall', () => {
  it('clearRecall() empties the list and ends browsing in one action', async () => {
    const console = make()
    await submitAll(console, ['echo a', 'echo b'])
    console.setInput('draft')
    console.recallPrevious()
    const listener = vi.fn()
    console.subscribe(listener)
    console.clearRecall()
    expect(listener).toHaveBeenCalledTimes(1)
    const state = console.getState()
    expect(state.recall).toEqual([])
    expect(state.recallCursor).toBeNull()
    expect(state.recallDraft).toBeNull()
    expect(state.input.value).toBe('echo b')
  })

  it('the clear-recall effect empties the list before the output', async () => {
    const reports: Updater<string[]>[] = []
    const console = make({
      commands: [
        ...commands,
        command('forget', () => ({
          output: 'forgotten',
          effects: [{ type: 'clear-recall' }]
        }))
      ],
      state: { recall: ['echo a'] },
      onRecallChange: updater => reports.push(updater)
    })
    await console.run('forget')
    // One report: recording `forget`, then clearing, composed.
    expect(reports).toHaveLength(1)
    expect(resolve(reports[0], ['echo a'])).toEqual([])
  })

  it('the clear-recall effect empties an internal list', async () => {
    const console = make({
      commands: [
        ...commands,
        command('forget', () => ({ effects: [{ type: 'clear-recall' }] }))
      ],
      initialState: { recall: ['echo a'] }
    })
    await console.run('forget')
    expect(console.getState().recall).toEqual([])
  })

  it('clearing an empty list changes nothing', () => {
    const console = make()
    const listener = vi.fn()
    console.subscribe(listener)
    console.clearRecall()
    expect(listener).not.toHaveBeenCalled()
  })

  it('without the feature the clear-recall effect is ignored', async () => {
    const console = createConsole({
      commands: [
        command('forget', () => ({
          output: 'x',
          effects: [{ type: 'clear-recall' }]
        }))
      ]
    })
    expect(await console.run('forget')).toBe(true)
    expect(console.getState().entries.at(-1)).toMatchObject({ kind: 'output' })
  })
})

describe('C-31 Redacted recall', () => {
  it('a sensitive line is never recorded, in any outcome', async () => {
    const pending = deferred<string>()
    const console = make({
      commands: [
        ...commands,
        command('slow', () => pending.promise, { sensitive: true })
      ],
      beforeRun: info => (info.command === 'set' ? false : undefined),
      isSensitive: line => line.includes('--token')
    })
    await submitAll(console, [
      'login a b',
      'LOGIN a',
      'login "open',
      'set password x',
      'nope --token'
    ])
    const running = console.run('slow x')
    console.cancel()
    await running
    expect(console.getState().recall).toEqual([])
  })

  it('ArrowUp on a sensitive input keeps an empty draft and replaces the input element', async () => {
    const console = make()
    await console.run('echo a')
    console.setInput('login admin hunter2')
    const revision = console.getState().input.revision
    console.handleKey(up)
    let state = console.getState()
    expect(state.recallDraft).toBe('')
    expect(state.input.value).toBe('echo a')
    expect(state.input.revision).toBe(revision + 1)
    console.handleKey(down)
    state = console.getState()
    expect(state.input.value).toBe('')
    expect(JSON.stringify(state)).not.toContain('hunter2')
  })

  it('the secret argument of a fromArg command never becomes the draft', async () => {
    const console = make()
    await console.run('echo a')
    console.setInput('set password hunter2')
    console.recallPrevious()
    expect(console.getState().recallDraft).toBe('')
  })

  it('a non-sensitive draft is kept as typed', async () => {
    const console = make()
    await console.run('echo a')
    console.setInput('set ')
    console.recallPrevious()
    // `set` alone is sensitive (fromArg without the argument, C-30).
    expect(console.getState().recallDraft).toBe('')
    console.setInput('echo b ')
    console.recallPrevious()
    expect(console.getState().recallDraft).toBe('echo b ')
  })
})

describe('C-36 Leak matrix (recall paths)', () => {
  const create = (options: LeakOptions) =>
    createConsole({
      ...options,
      features: { recallFeature }
    }) as unknown as LeakConsole

  it.each(
    [...coreLeakPaths, ...recallLeakPaths].map(
      path => [path.name, path] as const
    )
  )('%s leaves no trace of the secret with recall', async (_name, path) => {
    expect(await runLeakPath(path, create)).toEqual([])
  })

  it('a planted secret in the recall draft is found', async () => {
    const findings = await runLeakPath(
      {
        name: 'leaky draft',
        options: () => ({ initialState: { recall: ['echo one'] } }),
        drive: ({ console, probe, secret }) => {
          console.setInput(`echo ${secret}`)
          ;(console as ReturnType<typeof make>).recallPrevious()
          probe.check(console, 'leaky draft')
        }
      },
      create
    )
    expect(findings.some(f => f.where.includes('recallDraft'))).toBe(true)
  })
})
