// useCommandConsole (README: The composable): a console without markup. It
// creates the console once, passes reactive option changes to `setOptions`,
// mirrors every notification into a `shallowRef` and disposes the console with
// its effect scope. Given a console created elsewhere (C-84), it only mirrors
// it: the options and the console's life are its creator's. It does no DOM
// work, so a consumer can draw a template of its own. The Vue package keeps no
// console state of its own (P15).
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
  type Console,
  type ConsoleOptions,
  type ConsoleState,
  type OptionalFeatures
} from '@dolusoft/command-console-core'

import type {
  UseCommandConsoleOptions,
  UseCommandConsoleReturn,
  UseExternalConsoleOptions
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
 * Mirrors `console`'s state into a `shallowRef` until the effect scope ends.
 * With `stopOptions` the composable created the console: it stops passing
 * options on and disposes it. Without, it only unsubscribes: the console is
 * its creator's (C-84).
 */
const mirror = <T extends Partial<OptionalFeatures>>(
  console: Console<T>,
  stopOptions: (() => void) | null
): UseCommandConsoleReturn<T> => {
  const state = shallowRef<ConsoleState>(console.getState())
  const unsubscribe = console.subscribe(next => {
    state.value = next
  })
  onScopeDispose(() => {
    unsubscribe()
    if (stopOptions) {
      stopOptions()
      console.dispose()
      // The snapshot goes with the console: what it held (the live input
      // among it) is not kept.
      state.value = console.getState()
    }
  })
  return {
    console: console,
    state: shallowReadonly(state)
  }
}

/** Creates a console from `options` and disposes it with the scope. */
const ownConsole = <T extends Partial<OptionalFeatures>>(
  options: UseCommandConsoleOptions<T>
): UseCommandConsoleReturn<T> => {
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

  return mirror(console, stop)
}

/**
 * Creates a console from `options` and keeps it in step with them; or, given
 * `{ console }` alone, mirrors a console created elsewhere and leaves its
 * options and its life to its creator (C-84).
 *
 * A value option (`commands`, `prompt`, `state`, `maxEntries`,
 * `recallLimit`) may be a plain value, a ref or a getter. A function option
 * (`beforeRun`, `onError`, …) may be the function or a ref that holds it: a
 * bare function is the option itself, never a getter. `features` and
 * `initialState` are read once. `console` with any other option throws a
 * `TypeError`.
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
  // `{}` and not its constraint, as `createConsole` (ADR 0002).
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  T extends Partial<OptionalFeatures> = {}
>(
  options: UseCommandConsoleOptions<T> | UseExternalConsoleOptions<T>
): UseCommandConsoleReturn<T> {
  if (options.console !== undefined) {
    const others = Object.keys(options).filter(
      key =>
        key !== 'console' &&
        (options as Record<string, unknown>)[key] !== undefined
    )
    if (others.length > 0) {
      throw new TypeError(
        `useCommandConsole: ${others.join(', ')} cannot be given with console; the options belong to whoever created it.`
      )
    }
    return mirror(options.console, null)
  }
  return ownConsole(options as UseCommandConsoleOptions<T>)
}
