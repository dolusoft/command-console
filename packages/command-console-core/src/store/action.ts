// Updaters (core README: Controlled slices). A controlled slice is reported as
// one updater per action that replays every change of the action, in order,
// onto the value it is given.

/** A new value, or a function from the old value to the new one. */
export type Updater<T> = T | ((old: T) => T)

/** A change of one slice: a function from the old value to the new one. */
export type Step<T> = (old: T) => T

/** The value `updater` gives when applied to `old`. */
export const resolveUpdater = <T>(updater: Updater<T>, old: T): T =>
  typeof updater === 'function' ? (updater as Step<T>)(old) : updater

/** One step that applies `steps` in order. */
export const composeSteps =
  <T>(steps: readonly Step<T>[]): Step<T> =>
  old =>
    steps.reduce((value, step) => step(value), old)
