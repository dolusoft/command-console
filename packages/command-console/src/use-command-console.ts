// useCommandConsole (spec §7.1): a console without markup. It creates the
// console once, passes reactive option changes to `setOptions`, mirrors every
// notification into a `shallowRef` and disposes the console with its effect
// scope. It does no DOM work, so a consumer can draw a template of its own.
// The Vue package keeps no console state of its own (P15).
import {
  onScopeDispose,
  shallowReadonly,
  shallowRef,
  toValue,
  unref,
  watch
} from 'vue'

import {
  createConsole,
  type ConsoleOptions,
  type ConsoleState,
  type OptionalFeatures
} from '@dolusoft/command-console-core'

import type {
  UseCommandConsoleOptions,
  UseCommandConsoleReturn
} from './contract'

/** The options that are functions: a ref may hold one, a getter may not. */
const functionKeys = [
  'onEntriesChange',
  'onRecallChange',
  'onContextChange',
  'createId',
  'beforeRun',
  'onError',
  'formatError',
  'onClose',
  'isSensitive',
  'shouldRecord'
] as const

/** The options that are values: a ref or a getter may give them. */
const valueKeys = [
  'commands',
  'prompt',
  'state',
  'maxEntries',
  'recallLimit'
] as const

/**
 * Creates a console from `options` and keeps it in step with them.
 *
 * A value option (`commands`, `prompt`, `state`, `maxEntries`,
 * `recallLimit`) may be a plain value, a ref or a getter. A function option
 * (`beforeRun`, `onError`, …) may be the function or a ref that holds it: a
 * bare function is the option itself, never a getter. `features` and
 * `initialState` are read once.
 *
 * @example
 * ```ts
 * const { console, state } = useCommandConsole({
 *   features: consoleFeatures({ recallFeature }),
 *   commands: () => commands.value
 * })
 * ```
 */
export function useCommandConsole<
  // `{}` and not its constraint, as `createConsole` (spec §3.2).
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  T extends Partial<OptionalFeatures> = {}
>(options: UseCommandConsoleOptions<T>): UseCommandConsoleReturn<T> {
  const resolve = (): ConsoleOptions<T> => {
    const resolved: Record<string, unknown> = {}
    for (const key of valueKeys) {
      resolved[key] = toValue(options[key])
    }
    for (const key of functionKeys) {
      resolved[key] = unref(options[key])
    }
    return resolved as unknown as ConsoleOptions<T>
  }

  const console = createConsole<T>({
    ...resolve(),
    features: options.features,
    initialState: toValue(options.initialState)
  })

  const state = shallowRef<ConsoleState>(console.getState())
  const unsubscribe = console.subscribe(next => {
    state.value = next
  })

  // Every reactive read of `resolve` is a dependency: a change of any option
  // hands the whole set to the console. The features stay those it was
  // created with.
  const stop = watch(resolve, next => {
    console.setOptions(old => ({
      ...next,
      features: old.features,
      initialState: old.initialState
    }))
  })

  onScopeDispose(() => {
    stop()
    unsubscribe()
    console.dispose()
    // The snapshot goes with the console: what it held (the live input
    // among it) is not kept.
    state.value = console.getState()
  })

  return {
    console: console,
    state: shallowReadonly(state)
  }
}
