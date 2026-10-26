// The entries feature (C-55): the scrollback, its ids, `maxEntries` and
// the `clear` effect.
import type { ConsoleEntry } from '@dolusoft/command-protocol'

import { counterIds, duplicateIds, trimEntries } from './entries.utils'
import {
  assignMethods,
  handleEffect,
  liveRecord,
  type ConsoleStore
} from '../../shared'
import type { AnyConsole, ConsoleFeature } from '../console/console.types'

const defaultIds = new WeakMap<object, () => string>()

/**
 * A new id: from `options.createId`, else the console's counter. An id that
 * is already in `entries` throws (a `createId` that repeats itself).
 */
export const newId = (console: object): string => {
  const record = liveRecord(console)
  const create = record.options.createId ?? defaultIds.get(console)!
  const id = create()
  if (record.store.read().entries.some(entry => entry.id === id)) {
    throw new Error(`createId returned ${id}, an id already in entries.`)
  }
  return id
}

/** Appends `entries` in the open action and applies `maxEntries`. */
const append = (
  store: ConsoleStore,
  entries: readonly ConsoleEntry[],
  max: number | undefined
) => store.update('entries', old => trimEntries([...old, ...entries], max))

/**
 * Appends one entry made by the console, with a new id, in the open action.
 * Returns the id.
 */
export const addEntry = (
  console: object,
  entry: ConsoleEntry extends infer E
    ? E extends ConsoleEntry
      ? Omit<E, 'id'>
      : never
    : never
): string => {
  const record = liveRecord(console)
  const id = newId(console)
  append(record.store, [{ id, ...entry }], record.options.maxEntries)
  return id
}

const clear = (store: ConsoleStore) =>
  store.update('entries', old => (old.length === 0 ? old : []))

export const entriesFeature: ConsoleFeature = {
  name: 'entries',

  constructConsoleAPIs(console: AnyConsole) {
    defaultIds.set(console, counterIds(liveRecord(console).store))
    assignMethods(console, {
      appendEntries(entries: ConsoleEntry[]) {
        const { store, options } = liveRecord(console)
        store.action(() => {
          const duplicates = duplicateIds(store.read().entries, entries)
          if (duplicates.length > 0) {
            throw new Error(
              `appendEntries: ids already present: ${duplicates.join(', ')}.`
            )
          }
          append(store, entries, options.maxEntries)
        })
      },
      clearEntries() {
        const { store } = liveRecord(console)
        store.action(() => clear(store))
      }
    })
  },

  init(console: AnyConsole) {
    handleEffect(console, 'clear', () => clear(liveRecord(console).store))
  }
}
