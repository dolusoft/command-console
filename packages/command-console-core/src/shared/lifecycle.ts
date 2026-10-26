// Methods, reset and dispose (core README: Lifecycle). Every method a feature
// puts on the instance goes through `assignMethods`, which refuses to overwrite
// another feature's method and turns every call after `dispose()` into a no-op.
import { isDisposed, liveRecord, recordOf, takeRecord } from './registry'

type Method = (...args: never[]) => unknown

/**
 * Assigns `methods` onto `console`. A name already present throws (no
 * feature overwrites another's method). After `dispose()` each method returns
 * its entry in `fallbacks` (default `undefined`) without running.
 */
export const assignMethods = <M extends Record<string, Method>>(
  console: object,
  methods: M,
  fallbacks: { [K in keyof M]?: ReturnType<M[K]> } = {}
): void => {
  const target = console as Record<string, unknown>
  for (const [name, method] of Object.entries(methods)) {
    if (name in target) {
      throw new Error(`The console method ${name} is already defined.`)
    }
    target[name] = (...args: never[]) =>
      isDisposed(console) ? fallbacks[name] : method(...args)
  }
}

/**
 * Registered by a feature that keeps private state of its own (context: its
 * revision) or must act first (dispatch: end the run as cancelled, without an
 * `interrupted` entry). Called by `reset()` inside its action, in feature
 * order, before the line-cleared hooks and before every slice returns to its
 * initial value.
 */
export const onReset = (console: object, hook: () => void): void => {
  liveRecord(console).hooks.reset.push(hook)
}

/** Called by `reset()`; see `onReset`. */
export const resetHooks = (console: object): void => {
  for (const hook of recordOf(console)?.hooks.reset ?? []) {
    hook()
  }
}

/**
 * Registers a cleanup that `dispose()` runs once, in feature order (dispatch
 * first ends the run). No action is open when it runs; it must not change
 * state.
 */
export const onDispose = (console: object, cleanup: () => void): void => {
  liveRecord(console).hooks.disposers.push(cleanup)
}

/**
 * Drops the record of `console` and runs every cleanup once; a throwing
 * cleanup does not stop the others (its error goes to `onError`). Returns
 * `false` when the console was already disposed.
 */
export const disposeShared = (
  console: object,
  onError: (error: unknown) => void
): boolean => {
  const record = takeRecord(console)
  if (!record) {
    return false
  }
  for (const cleanup of record.hooks.disposers) {
    try {
      cleanup()
    } catch (error) {
      onError(error)
    }
  }
  return true
}
