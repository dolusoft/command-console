// The per-console record of shared/ (spec §3.5, ADR 0002): everything the
// features have in common. It is keyed by the console instance in a WeakMap
// and dropped on dispose, so it never keeps a disposed console alive and a
// late call (a settling promise, an event after unmount) finds nothing.
import type { Hooks } from './hooks'
import type {
  AnyConsoleOptions,
  ConsoleState,
  ControlledSlice
} from '../core/console/console.types'
import type { Store } from '../store/createStore'

/** The store of a console. */
export type ConsoleStore = Store<ConsoleState, ControlledSlice>

/** What every feature of one console shares. */
export interface SharedRecord {
  store: ConsoleStore
  /** The options with the features' defaults merged; replaced by `setOptions`. */
  options: AnyConsoleOptions & { prompt: string }
  hooks: Hooks
}

const createHooks = (): Hooks => ({
  lineSubmitted: [],
  lineCleared: [],
  inputChanged: [],
  key: [],
  controlledChanged: [],
  contextChanged: [],
  reset: [],
  disposers: [],
  prompt: null,
  context: null,
  commandLookup: null,
  inputWriter: null,
  effects: {},
  keyActions: {}
})

const records = new WeakMap<object, SharedRecord>()
const disposed = new WeakSet<object>()

/** Creates the record of `console` (the engine, on construction). */
export const createRecord = (
  console: object,
  store: ConsoleStore,
  options: SharedRecord['options']
): SharedRecord => {
  const record: SharedRecord = { store, options, hooks: createHooks() }
  records.set(console, record)
  return record
}

/** The record of `console`; `null` once it is disposed. */
export const recordOf = (console: object): SharedRecord | null =>
  records.get(console) ?? null

/**
 * The record of a live console. For code that only runs while the console
 * lives (a method behind `assignMethods`, a registered hook).
 */
export const liveRecord = (console: object): SharedRecord => {
  const record = records.get(console)
  if (!record) {
    throw new Error('The console is disposed.')
  }
  return record
}

/** Drops the record of `console` for good and returns it, once. */
export const takeRecord = (console: object): SharedRecord | null => {
  const record = records.get(console) ?? null
  records.delete(console)
  disposed.add(console)
  return record
}

/** Whether `dispose()` ran for `console`. */
export const isDisposed = (console: object): boolean => disposed.has(console)
