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

interface Crypto {
  randomUUID?: () => string
  getRandomValues?: (bytes: Uint8Array) => Uint8Array
}

/** An RFC 4122 version 4 UUID from 16 random bytes. */
const uuidV4 = (bytes: Uint8Array): string => {
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10, 16)
  ]
    .map(part => part.join(''))
    .join('-')
}

/**
 * The page's UUID function: `crypto.randomUUID`, else a v4 UUID from
 * `crypto.getRandomValues` (a page on an insecure origin has only the
 * latter), else none.
 */
const randomUUID = (): (() => string) | undefined => {
  const crypto = (globalThis as { crypto?: Crypto }).crypto
  if (typeof crypto?.randomUUID === 'function') {
    return () => crypto.randomUUID!()
  }
  if (typeof crypto?.getRandomValues === 'function') {
    return () => uuidV4(crypto.getRandomValues!(new Uint8Array(16)))
  }
  return undefined
}

/**
 * What makes envelope ids: `createEnvelopeId`, else the page's UUID function.
 * Throws when a gate is given and neither exists (C-78).
 */
export const envelopeIds = (
  options: Pick<AnyConsoleOptions, 'gate' | 'createEnvelopeId'>
): (() => string) | undefined => {
  const create = options.createEnvelopeId ?? randomUUID()
  if (options.gate !== undefined && create === undefined) {
    throw new Error(
      'A console with a gate needs crypto.randomUUID, crypto.getRandomValues or a createEnvelopeId option.'
    )
  }
  return create
}

/**
 * Checks the gate options at creation and on every `setOptions` (C-78):
 * envelope ids can be made, and `echoTimeoutMs` is a finite number above 0.
 */
export const checkGateOptions = (
  options: Pick<
    AnyConsoleOptions,
    'gate' | 'createEnvelopeId' | 'echoTimeoutMs'
  >
): void => {
  envelopeIds(options)
  const ms: unknown = options.echoTimeoutMs
  if (
    ms !== undefined &&
    !(typeof ms === 'number' && Number.isFinite(ms) && ms > 0)
  ) {
    throw new TypeError(
      `echoTimeoutMs must be a finite number above 0 (got ${typeof ms === 'number' ? ms : typeof ms}).`
    )
  }
}

/**
 * Whether a command can travel in an envelope: it has `input` and `danger`
 * and no `sensitive` (C-79).
 */
export const describedCommand = (command: CommandDefinition): boolean =>
  command.input !== undefined &&
  command.danger !== undefined &&
  (command.sensitive === undefined || command.sensitive === false)
