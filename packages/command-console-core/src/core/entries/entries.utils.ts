import type { ConsoleEntry } from '@dolusoft/command-protocol'

import type { ConsoleStore } from '../../shared'

/** Keeps the newest `max` entries (spec §6.9); `undefined` keeps all. */
export const trimEntries = (
  entries: ConsoleEntry[],
  max: number | undefined
): ConsoleEntry[] => {
  if (max === undefined || entries.length <= max) {
    return entries
  }
  return entries.slice(entries.length - Math.max(0, Math.floor(max)))
}

/** The default `createId`: `c1`, `c2`, … skipping ids already in `entries`. */
export const counterIds = (store: ConsoleStore): (() => string) => {
  let next = 0
  return () => {
    const present = new Set(store.read().entries.map(entry => entry.id))
    let id: string
    do {
      next += 1
      id = `c${next}`
    } while (present.has(id))
    return id
  }
}

/** The ids of `entries` that are already in `present` or repeat. */
export const duplicateIds = (
  present: readonly ConsoleEntry[],
  entries: readonly ConsoleEntry[]
): string[] => {
  const seen = new Set(present.map(entry => entry.id))
  const duplicates: string[] = []
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      duplicates.push(entry.id)
    }
    seen.add(entry.id)
  }
  return duplicates
}
