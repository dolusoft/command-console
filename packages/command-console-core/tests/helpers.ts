// Helpers of the core specs: fake commands, key inputs, deferred promises and
// deep freezing. No DOM, no timers (spec §12).
import type {
  CommandDefinition,
  CommandReturn,
  KeyInput
} from '@dolusoft/command-console-core'
import type { ConsoleEntry, OutputEntry } from '@dolusoft/command-protocol'

/** A key press with every modifier off and nothing selected. */
export const key = (name: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: name,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  selection: 'none',
  ...extra
})

export const enter = key('Enter')
export const ctrlC = key('c', { ctrlKey: true })

export interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

/** A promise settled by the test. */
export const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Lets pending promise callbacks run (a few microtask turns, no timer). */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

/** A command that returns `value` (or what `run` returns). */
export const command = (
  name: string,
  run: CommandDefinition['run'] = () => undefined,
  extra: Partial<CommandDefinition> = {}
): CommandDefinition => ({ name, run, ...extra })

/** A command whose run returns `value`. */
export const returning = (name: string, value: CommandReturn) =>
  command(name, () => value)

/** Freezes `value` and everything reachable from it. */
export const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const property of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[property])
    }
  }
  return value
}

/** The entries without their ids, for comparisons. */
export const withoutIds = (
  entries: readonly ConsoleEntry[]
): Record<string, unknown>[] =>
  entries.map(entry =>
    Object.fromEntries(Object.entries(entry).filter(([name]) => name !== 'id'))
  )

/** The output entries of `entries`. */
export const outputs = (entries: readonly ConsoleEntry[]): OutputEntry[] =>
  entries.filter((entry): entry is OutputEntry => entry.kind === 'output')
