// The console feature (spec §3.2, §3.3, §6.6, §6.10): state access, options,
// the key map, reset and dispose, and the `close` effect.
import type { ConsoleEntry, ContextFrame } from '@dolusoft/command-protocol'

import type {
  AnyConsole,
  AnyConsoleOptions,
  ConsoleFeature,
  ConsoleState,
  ControlledSlice
} from './console.types'
import { currentPrompt, reportError } from './console.utils'
import {
  actionsFor,
  assignMethods,
  controlledChanged,
  disposeShared,
  handleEffect,
  isDisposed,
  keyPressed,
  lineCleared,
  liveRecord,
  recordOf,
  resetHooks,
  runKeyAction,
  type ControlledChange,
  type KeyInput
} from '../../shared'
import { resolveUpdater, type Updater } from '../../store/action'
import { validateCommands } from '../dispatch/dispatch.utils'

const controllable: readonly ControlledSlice[] = [
  'entries',
  'recall',
  'context'
]

/** The state a console starts from before `initialState` and the features. */
export const emptyState = (): ConsoleState => ({
  entries: [],
  input: { value: '', caret: 0, revision: 0 },
  running: null,
  recall: [],
  recallCursor: null,
  recallDraft: null,
  completion: null,
  context: []
})

/**
 * The options as the features read them: the features' defaults, then every
 * option the consumer gave that is not `undefined`.
 */
export const mergeOptions = (
  defaults: Partial<AnyConsoleOptions>,
  options: AnyConsoleOptions
): AnyConsoleOptions & { prompt: string } => {
  const merged: Record<string, unknown> = { ...defaults }
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) {
      merged[key] = value
    }
  }
  return merged as unknown as AnyConsoleOptions & { prompt: string }
}

const sameFeatures = (a: object | undefined, b: object | undefined) => {
  const left = Object.entries(a ?? {})
  const right = b ?? {}
  return (
    left.length === Object.keys(right).length &&
    left.every(
      ([key, value]) => (right as Record<string, unknown>)[key] === value
    )
  )
}

/** The initial values `reset()` returns the controllable slices to. */
const initialSlices = new WeakMap<
  object,
  { entries: ConsoleEntry[]; recall: string[]; context: ContextFrame[] }
>()
const featureDefaults = new WeakMap<object, Partial<AnyConsoleOptions>>()

/** Remembers what `setOptions` and `reset()` need from construction. */
export const rememberConstruction = (
  console: object,
  defaults: Partial<AnyConsoleOptions>,
  initial: ConsoleState
): void => {
  featureDefaults.set(console, defaults)
  initialSlices.set(console, {
    entries: initial.entries,
    recall: initial.recall,
    context: initial.context
  })
}

export const consoleFeature: ConsoleFeature = {
  name: 'console',

  getDefaultOptions: () => ({ prompt: '>' }),

  constructConsoleAPIs(console: AnyConsole) {
    const { store } = liveRecord(console)
    assignMethods(
      console,
      {
        subscribe: (listener: (state: ConsoleState) => void) =>
          store.subscribe(listener),

        setOptions(updater: Updater<AnyConsoleOptions>) {
          const record = liveRecord(console)
          const previous = record.options
          const given = resolveUpdater(updater, previous)
          if (!sameFeatures(previous.features, given.features)) {
            throw new Error('setOptions cannot change the feature set.')
          }
          validateCommands(given.commands)
          store.action(() => {
            const before = { ...store.read() }
            record.options = mergeOptions(featureDefaults.get(console)!, given)
            store.deliver(
              controllable.filter(
                slice =>
                  record.options.state?.[slice] !== undefined ||
                  previous.state?.[slice] !== undefined
              )
            )
            const after = store.read()
            for (const slice of controllable) {
              if (before[slice] !== after[slice]) {
                controlledChanged(console, {
                  slice,
                  previous: before[slice],
                  next: after[slice]
                } as ControlledChange)
              }
            }
          })
        },

        reset() {
          store.action(() => {
            resetHooks(console)
            // The input is empty when the line-cleared hooks run.
            store.update('input', input =>
              input.value === ''
                ? { ...input, caret: 0 }
                : { value: '', caret: 0, revision: input.revision + 1 }
            )
            lineCleared(console)
            const initial = initialSlices.get(console)!
            const empty = emptyState()
            store.update('entries', () => [...initial.entries])
            store.update('recall', () => [...initial.recall])
            store.update('context', () => [...initial.context])
            store.update('recallCursor', () => empty.recallCursor)
            store.update('recallDraft', () => empty.recallDraft)
            store.update('completion', () => empty.completion)
            store.update('running', () => empty.running)
          })
        },

        dispose() {
          const record = recordOf(console)
          if (!record) {
            return
          }
          const { onError } = record.options
          disposeShared(console, error => reportError(onError, error, null))
          record.store.clear(emptyState())
        },

        getPrompt: () => currentPrompt(console),

        handleKey(input: KeyInput) {
          if (input.isComposing) {
            return false
          }
          return store.action(() => {
            keyPressed(console, input)
            const actions = actionsFor(input)
            if (actions[0] === 'cancel' && input.selection !== 'none') {
              return false
            }
            if (store.read().running !== null && actions[0] !== 'cancel') {
              return false
            }
            return actions.some(name => runKeyAction(console, name))
          })
        }
      },
      { handleKey: false, getPrompt: '', subscribe: () => () => {} }
    )
    // Readable after dispose: the cleared state.
    ;(console as { getState?: () => ConsoleState }).getState = () =>
      store.getState()
  },

  init(console: AnyConsole) {
    handleEffect(console, 'close', () => {
      liveRecord(console).store.afterCommit(() => {
        if (!isDisposed(console)) {
          recordOf(console)?.options.onClose?.()
        }
      })
    })
  }
}
