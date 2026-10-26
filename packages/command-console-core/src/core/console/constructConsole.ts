// Builds a console from its features (spec §3.2, TanStack v9 shape): the
// options merge the features' defaults, the initial state takes
// `initialState` and each feature's adjustment, then every feature assigns
// its methods and, once all methods exist, registers its hooks.
import type {
  AnyConsole,
  AnyConsoleOptions,
  ConsoleFeature,
  ControlledSlice,
  OptionalFeatures
} from './console.types'
import { reportCallbackError } from './console.utils'
import {
  emptyState,
  mergeOptions,
  rememberConstruction
} from './consoleFeature'
import { createRecord, type SharedRecord } from '../../shared'
import { createStore } from '../../store/createStore'
import { validateCommands } from '../dispatch/dispatch.utils'

/** The keys of `options.features`, in construction order. */
const optionalFeatureKeys: readonly (keyof OptionalFeatures)[] = [
  'recallFeature',
  'completionFeature',
  'contextFeature'
]

const controllable: readonly ControlledSlice[] = [
  'entries',
  'recall',
  'context'
]

const reporters = {
  entries: 'onEntriesChange',
  recall: 'onRecallChange',
  context: 'onContextChange'
} as const

/**
 * Builds a console from `core` (the always-present features, in order) and
 * the optional features in `options.features`. Throws on an unknown feature
 * key or an invalid command set; calls nothing of the consumer's.
 */
export function constructConsole(
  options: AnyConsoleOptions,
  core: readonly ConsoleFeature[]
): AnyConsole {
  const given = (options.features ?? {}) as Record<string, unknown>
  for (const key of Object.keys(given)) {
    if (!(optionalFeatureKeys as readonly string[]).includes(key)) {
      throw new Error(
        `Unknown feature ${key}; the features are ${optionalFeatureKeys.join(', ')}.`
      )
    }
  }
  const features = [
    ...core,
    ...optionalFeatureKeys
      .filter(key => given[key] !== undefined)
      .map(key => given[key] as ConsoleFeature)
  ]

  const defaults: Partial<AnyConsoleOptions> = Object.assign(
    {},
    ...features.map(feature => feature.getDefaultOptions?.() ?? {})
  ) as Partial<AnyConsoleOptions>
  const merged = mergeOptions(defaults, options)
  validateCommands(merged.commands)

  let initial = emptyState()
  for (const slice of controllable) {
    const value = merged.initialState?.[slice]
    if (value !== undefined) {
      initial = { ...initial, [slice]: value }
    }
  }
  for (const feature of features) {
    initial = feature.getInitialState?.(initial) ?? initial
  }

  const console = {} as AnyConsole
  const optionsNow = (): SharedRecord['options'] | undefined => record?.options
  let record: SharedRecord | undefined = undefined
  const store = createStore({
    initial,
    controllable,
    external: slice => optionsNow()?.state?.[slice],
    report: (slice, step) => {
      const callback = optionsNow()?.[reporters[slice]] as
        ((updater: typeof step) => void) | undefined
      callback?.(step)
    },
    onCallbackError: error => reportCallbackError(console, error)
  })
  record = createRecord(console, store, merged)
  rememberConstruction(console, defaults, initial)

  for (const feature of features) {
    feature.constructConsoleAPIs?.(console)
  }
  for (const feature of features) {
    feature.init?.(console)
  }
  return console
}
