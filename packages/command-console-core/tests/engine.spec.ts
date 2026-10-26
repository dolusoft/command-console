// The engine and the shared/ hooks as the optional features use them. A fake
// feature stands in for recall, completion and context: it registers the
// hooks the real one will and records what it is told. These specs are the
// contract the feature implementers build on (ADR 0002).
import { describe, expect, it, vi } from 'vitest'

import {
  createConsole,
  type ConsoleState,
  type OptionalFeatures,
  type RecallFeature
} from '@dolusoft/command-console-core'
import type { ContextFrame } from '@dolusoft/command-protocol'

import { command, deferred, enter, flush, key, returning } from './helpers'
import type {
  AnyConsole,
  ConsoleFeature
} from '../src/core/console/console.types'
import {
  contextChanged,
  handleEffect,
  liveRecord,
  lookupOf,
  onControlledChange,
  onDispose,
  onInputChange,
  onKey,
  onLineCleared,
  onLineSubmitted,
  onReset,
  provideContext,
  providePrompt,
  registerKeyAction,
  writeInput,
  type ControlledChange,
  type InputChange
} from '../src/shared'

const asFeature = (feature: ConsoleFeature) =>
  feature as unknown as RecallFeature

const make = (
  feature: ConsoleFeature,
  slot: keyof OptionalFeatures = 'recallFeature',
  extra: Record<string, unknown> = {}
) =>
  createConsole({
    commands: [
      returning('a', 'x'),
      command('s', undefined, { sensitive: true })
    ],
    features: { [slot]: asFeature(feature) } as unknown as OptionalFeatures,
    ...extra
  }) as unknown as AnyConsole

describe('engine', () => {
  it('constructs features in the fixed order and inits after every method exists', () => {
    const order: string[] = []
    const fake = (
      name: 'recall' | 'completion' | 'context'
    ): ConsoleFeature => ({
      name,
      getDefaultOptions: () => {
        order.push(`defaults:${name}`)
        return {}
      },
      getInitialState: state => {
        order.push(`state:${name}`)
        return state
      },
      constructConsoleAPIs: console => {
        order.push(`apis:${name}`)
        expect(typeof console.submit).toBe('function')
      },
      init: () => {
        order.push(`init:${name}`)
      }
    })
    createConsole({
      commands: [],
      // Given out of order on purpose.
      features: {
        contextFeature: fake('context') as never,
        recallFeature: fake('recall') as never,
        completionFeature: fake('completion') as never
      }
    })
    expect(order).toEqual([
      'defaults:recall',
      'defaults:completion',
      'defaults:context',
      'state:recall',
      'state:completion',
      'state:context',
      'apis:recall',
      'apis:completion',
      'apis:context',
      'init:recall',
      'init:completion',
      'init:context'
    ])
  })

  it('assignMethods refuses an existing name and no-ops after dispose', async () => {
    const { assignMethods } = await import('../src/shared')
    const feature: ConsoleFeature = {
      name: 'recall',
      constructConsoleAPIs: console => {
        expect(() => assignMethods(console, { submit: () => true })).toThrow(
          /already defined/
        )
        assignMethods(
          console,
          { recallPrevious: () => true },
          { recallPrevious: false }
        )
      }
    }
    const console = make(feature) as unknown as {
      recallPrevious(): boolean
      dispose(): void
    }
    expect(console.recallPrevious()).toBe(true)
    console.dispose()
    expect(console.recallPrevious()).toBe(false)
  })

  it('feature defaults sit under the options; getInitialState adjusts the state', () => {
    const feature: ConsoleFeature = {
      name: 'recall',
      getDefaultOptions: () => ({ prompt: 'feature>' }),
      getInitialState: (state: ConsoleState) => ({
        ...state,
        recall: [...state.recall, 'seed']
      })
    }
    expect(make(feature).getPrompt()).toBe('feature>')
    expect(make(feature, 'recallFeature', { prompt: '$' }).getPrompt()).toBe(
      '$'
    )
    expect(
      make(feature, 'recallFeature', {
        initialState: { recall: ['old'] }
      }).getState().recall
    ).toEqual(['old', 'seed'])
  })
})

describe('shared/ hooks', () => {
  it('onLineSubmitted: trimmed, non-sensitive lines only, after the cleanup and before tokenizing', async () => {
    const seen: [string, string][] = []
    const feature: ConsoleFeature = {
      name: 'recall',
      init: console =>
        onLineSubmitted(console, line =>
          seen.push([line, liveRecord(console).store.read().input.value])
        )
    }
    const console = make(feature)
    await console.run('  a  ')
    await console.run('unknown x')
    await console.run('a "open')
    await console.run('s secret')
    await console.run('   ')
    console.setInput('cancelled')
    console.cancel()
    expect(seen).toEqual([
      ['a', ''],
      ['unknown x', ''],
      ['a "open', '']
    ])
  })

  it('onLineCleared: on every line end and on reset, with the input empty', async () => {
    const seen: string[] = []
    const feature: ConsoleFeature = {
      name: 'completion',
      init: console =>
        onLineCleared(console, () =>
          seen.push(liveRecord(console).store.read().input.value)
        )
    }
    const console = make(feature, 'completionFeature')
    await console.run('a')
    await console.run('')
    console.setInput('x')
    console.cancel()
    await console.run('s secret')
    console.setInput('y')
    console.reset()
    expect(seen).toEqual(['', '', '', '', ''])
  })

  it('onInputChange and writeInput: origin tells a feature its own writes', () => {
    const changes: InputChange[] = []
    let target!: AnyConsole
    const feature: ConsoleFeature = {
      name: 'recall',
      init: console => {
        target = console
        onInputChange(console, change => changes.push(change))
      }
    }
    const console = make(feature)
    console.setInput('ab')
    console.setInput('ab', 1)
    console.setInput('ab', 1)
    writeInput(target, 'line', 99, 'recall')
    expect(changes).toEqual([
      {
        value: 'ab',
        caret: 2,
        previousValue: '',
        previousCaret: 0,
        origin: null
      },
      {
        value: 'ab',
        caret: 1,
        previousValue: 'ab',
        previousCaret: 2,
        origin: null
      },
      {
        value: 'line',
        caret: 4,
        previousValue: 'ab',
        previousCaret: 1,
        origin: 'recall'
      }
    ])
  })

  it('writeInput does nothing while a command runs', async () => {
    const pending = deferred<string>()
    let target!: AnyConsole
    const feature: ConsoleFeature = {
      name: 'recall',
      init: console => void (target = console)
    }
    const console = createConsole({
      commands: [command('wait', () => pending.promise)],
      features: { recallFeature: asFeature(feature) }
    })
    const done = console.run('wait')
    writeInput(target, 'x', 1, 'recall')
    expect(console.getState().input.value).toBe('')
    pending.resolve('ok')
    await done
  })

  it('key actions run in the chord order; the first that acts wins', () => {
    const calls: string[] = []
    let selectActs = false
    const feature: ConsoleFeature = {
      name: 'completion',
      init: console => {
        registerKeyAction(console, 'selectPrevious', () => {
          calls.push('selectPrevious')
          return selectActs
        })
        registerKeyAction(console, 'recallPrevious', () => {
          calls.push('recallPrevious')
          return true
        })
        registerKeyAction(console, 'acceptCompletion', () => {
          calls.push('acceptCompletion')
          return false
        })
        expect(() => registerKeyAction(console, 'submit', () => true)).toThrow(
          /already registered/
        )
      }
    }
    const console = make(feature, 'completionFeature')
    expect(console.handleKey(key('ArrowUp'))).toBe(true)
    selectActs = true
    expect(console.handleKey(key('ArrowUp'))).toBe(true)
    console.setInput('a')
    expect(console.handleKey(enter)).toBe(true)
    expect(calls).toEqual([
      'selectPrevious',
      'recallPrevious',
      'selectPrevious',
      'acceptCompletion'
    ])
    // acceptCompletion did not act, so submit ran: input and output entries.
    expect(console.getState().entries.map(e => e.kind)).toEqual([
      'input',
      'output'
    ])
  })

  it('onKey sees every key before the key map, not composing keys', () => {
    const keys: string[] = []
    const feature: ConsoleFeature = {
      name: 'completion',
      init: console => onKey(console, input => keys.push(input.key))
    }
    const console = make(feature, 'completionFeature')
    console.handleKey(key('x'))
    console.handleKey(key('Tab'))
    console.handleKey(key('a', { isComposing: true }))
    expect(keys).toEqual(['x', 'Tab'])
  })

  it('onControlledChange: a slice the consumer replaced through setOptions', () => {
    const changes: ControlledChange[] = []
    const feature: ConsoleFeature = {
      name: 'recall',
      init: console =>
        onControlledChange(console, change => changes.push(change))
    }
    const recall = ['a']
    const console = make(feature, 'recallFeature', { state: { recall } })
    console.setOptions(old => ({ ...old }))
    expect(changes).toEqual([])
    const next = ['a', 'b']
    console.setOptions(old => ({ ...old, state: { recall: next } }))
    expect(changes).toEqual([{ slice: 'recall', previous: recall, next }])
  })

  it('prompt and context providers feed the input entry, RunInfo and the request', async () => {
    let frames: ContextFrame[] = [{ id: 'db', prompt: 'db>' }]
    let revision = 0
    let target!: AnyConsole
    const seen: unknown[] = []
    const feature: ConsoleFeature = {
      name: 'context',
      init: console => {
        target = console
        providePrompt(console, () => frames.at(-1)?.prompt ?? null)
        provideContext(console, {
          snapshot: () => [...frames],
          revision: () => revision
        })
        expect(() => providePrompt(console, () => null)).toThrow(
          /already provided/
        )
      }
    }
    const console = createConsole({
      commands: [command('a', request => void seen.push(request.context))],
      features: { contextFeature: feature as never },
      beforeRun: info => {
        seen.push(info.context)
        return undefined
      }
    })
    expect(console.getPrompt()).toBe('db>')
    await console.run('a')
    expect(console.getState().entries[0]).toMatchObject({ prompt: 'db>' })
    expect(seen).toEqual([frames, frames])
    frames = []
    revision++
    contextChanged(target)
    expect(console.getPrompt()).toBe('>')
  })

  it('a context change during a run aborts its signal and drops its context effects', async () => {
    let revision = 0
    let target!: AnyConsole
    const applied: string[] = []
    const pending = deferred<object>()
    let signal!: AbortSignal
    const feature: ConsoleFeature = {
      name: 'context',
      init: console => {
        target = console
        provideContext(console, {
          snapshot: () => [],
          revision: () => revision
        })
        handleEffect(console, 'push-context', () => void applied.push('push'))
        handleEffect(
          console,
          'clear-recall' as never,
          () => void applied.push('x')
        )
      }
    }
    const console = createConsole({
      commands: [
        command('a', (_request, run) => {
          signal = run.signal
          return pending.promise
        })
      ],
      features: { contextFeature: feature as never }
    })
    const done = console.run('a')
    revision++
    liveRecord(target).store.action(() => contextChanged(target))
    expect(signal.aborted).toBe(true)
    pending.resolve({
      output: 'still shown',
      effects: [{ type: 'push-context', frame: { id: 'f', prompt: 'f>' } }]
    })
    await done
    expect(applied).toEqual([])
    expect(console.getState().entries.at(-1)).toMatchObject({
      blocks: [{ type: 'text', text: 'still shown' }]
    })
  })

  it('lookupOf answers names, visibility and sensitivity', () => {
    let target!: AnyConsole
    const feature: ConsoleFeature = {
      name: 'completion',
      init: console => void (target = console)
    }
    createConsole({
      commands: [
        command('show', undefined, { aliases: ['s'] }),
        command('hide', undefined, { hidden: true }),
        command('set', undefined, { sensitive: { fromArg: 1 } }),
        command('login', undefined, { sensitive: true })
      ],
      isSensitive: line => line.includes('token'),
      features: { completionFeature: feature as never }
    })
    const lookup = lookupOf(target)
    expect(lookup.find('s')?.name).toBe('show')
    expect(lookup.find('S')).toBeUndefined()
    expect(lookup.visible().map(c => c.name)).toEqual(['show', 'set', 'login'])
    expect(lookup.sensitiveFrom(lookup.find('set')!)).toBe(1)
    expect(lookup.sensitiveFrom(lookup.find('login')!)).toBe(0)
    expect(lookup.sensitiveFrom(lookup.find('show')!)).toBeNull()
    expect(lookup.matchesPredicate('show token')).toBe(true)
    expect(lookup.isSensitive('SET a b')).toBe(true)
    expect(lookup.isSensitive('show a')).toBe(false)
  })

  it('onReset runs inside the reset action, before the slices return', () => {
    const seen: number[] = []
    const feature: ConsoleFeature = {
      name: 'context',
      init: console =>
        onReset(console, () => {
          expect(liveRecord(console).store.inAction()).toBe(true)
          seen.push(liveRecord(console).store.read().entries.length)
        })
    }
    const console = make(feature, 'contextFeature', {
      initialState: { entries: [] }
    })
    console.appendEntries([
      { id: 'x', kind: 'output', tone: 'default', blocks: [] }
    ])
    console.reset()
    expect(seen).toEqual([1])
  })

  it('disposers run once; a throwing one does not stop the others', async () => {
    const calls: string[] = []
    const onError = vi.fn()
    const feature: ConsoleFeature = {
      name: 'recall',
      init: console => {
        onDispose(console, () => {
          calls.push('first')
          throw new Error('disposer')
        })
        onDispose(console, () => calls.push('second'))
      }
    }
    const console = make(feature, 'recallFeature', { onError })
    console.dispose()
    console.dispose()
    await flush()
    expect(calls).toEqual(['first', 'second'])
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][1]).toBeNull()
  })
})
