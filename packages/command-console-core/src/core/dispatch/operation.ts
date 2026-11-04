// The pure parts of an operation that goes through the gate (ADR 0012): the
// echo comparison, the closed ids, the summary cut and the default envelope id.
import type { CommandDefinition } from './dispatch.types'
import type { AnyConsoleOptions } from '../console/console.types'

/** How many closed envelope ids a console remembers (C-81). */
const closedLimit = 500

/** The longest `summary` an outcome carries, in code points (C-82). */
const summaryLimit = 200

/** Whether two JSON values are equal, objects compared by their keys. */
export const sameJson = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true
  }
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null ||
    Array.isArray(a) !== Array.isArray(b)
  ) {
    return false
  }
  const left = Object.keys(a)
  const right = b as Record<string, unknown>
  return (
    left.length === Object.keys(right).length &&
    left.every(
      key =>
        Object.hasOwn(right, key) &&
        sameJson((a as Record<string, unknown>)[key], right[key])
    )
  )
}

/** Remembers `id` among the newest `closedLimit` closed ids. */
export const rememberClosed = (closed: Set<string>, id: string): void => {
  closed.delete(id)
  closed.add(id)
  if (closed.size > closedLimit) {
    closed.delete(closed.values().next().value!)
  }
}

/** `summary` cut to `summaryLimit` code points; `undefined` unless a string. */
export const cutSummary = (summary: unknown): string | undefined =>
  typeof summary === 'string'
    ? Array.from(summary).slice(0, summaryLimit).join('')
    : undefined

/** The platform's UUID function, when the page has one. */
const randomUUID = (): (() => string) | undefined => {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto
  return typeof crypto?.randomUUID === 'function'
    ? () => crypto.randomUUID!()
    : undefined
}

/**
 * What makes envelope ids: `createEnvelopeId`, else `crypto.randomUUID`.
 * Throws when a gate is given and neither exists (C-78).
 */
export const envelopeIds = (
  options: Pick<AnyConsoleOptions, 'gate' | 'createEnvelopeId'>
): (() => string) | undefined => {
  const create = options.createEnvelopeId ?? randomUUID()
  if (options.gate !== undefined && create === undefined) {
    throw new Error(
      'A console with a gate needs crypto.randomUUID or a createEnvelopeId option.'
    )
  }
  return create
}

/**
 * Whether a command can travel in an envelope: it has `input` and `danger`
 * and no `sensitive` (C-79).
 */
export const describedCommand = (command: CommandDefinition): boolean =>
  command.input !== undefined &&
  command.danger !== undefined &&
  (command.sensitive === undefined || command.sensitive === false)
