// The envelope a command travels in between the tabs of one user (ADR 0012).
// It is JSON and knows no transport: the consumer's gate sends and receives
// it.

import type { Actor } from './entry'
import { inputLimits } from './input/schema'
import { codePoints, isPlainObject } from './input/validate'
import { isJsonValue, type JsonValue } from './json'

/**
 * A request to run `command` with `args` in the tab (and view) of `target`.
 * Version 1 has only `kind: 'request'`.
 */
export interface Envelope {
  /** The envelope's version. A receiver does not run a version it does not know. */
  v: 1
  /** The operation's id (a UUID), not the run's id. */
  id: string
  kind: 'request'
  /** Who sent it, as the sender declares; a label for the history, never a permission. */
  actor: Actor
  /** The sending tab. */
  from: { tab: string }
  /** The tab and the view instance that run it; no `view` means the tab. */
  target: { tab: string; view?: string }
  /** The command's canonical name. */
  command: string
  /** The validated, normalized input object. */
  args: Record<string, JsonValue>
}

/** The most bytes an envelope's UTF-8 JSON may take. */
export const envelopeMaxBytes = 16384

/** Why `parseEnvelope` refused a value. */
export type EnvelopeErrorCode = 'unsupported-version' | 'invalid' | 'too-large'

/** An envelope read from the transport, or why it was refused. */
export type EnvelopeResult =
  { ok: true; envelope: Envelope } | { ok: false; code: EnvelopeErrorCode }

const actors: readonly unknown[] = ['user', 'assistant', 'external-agent']

/** The length in bytes of the UTF-8 JSON of `envelope`. */
export function envelopeBytes(envelope: Envelope): number {
  return jsonBytes(envelope)
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * Reads a value that came from the transport. A plain object whose `v` is a
 * number other than 1 is `unsupported-version`; one whose JSON is larger
 * than `envelopeMaxBytes` (unknown fields included) is `too-large`; a missing
 * or mistyped field, another `kind`, or `args` that is not a JSON object
 * within `inputLimits` is `invalid`. Unknown fields at the top and inside
 * `from` and `target` are left out of the new envelope it returns; `raw` is
 * never changed.
 */
export function parseEnvelope(raw: unknown): EnvelopeResult {
  if (!isPlainObject(raw) || typeof raw.v !== 'number') {
    return { ok: false, code: 'invalid' }
  }
  if (raw.v !== 1) {
    return { ok: false, code: 'unsupported-version' }
  }
  let bytes: number
  try {
    bytes = jsonBytes(raw)
  } catch {
    // A cycle or a bigint.
    return { ok: false, code: 'invalid' }
  }
  if (bytes > envelopeMaxBytes) {
    return { ok: false, code: 'too-large' }
  }
  const { id, kind, actor, from, target, command, args } = raw
  if (
    !isName(id) ||
    kind !== 'request' ||
    !actors.includes(actor) ||
    !isPlainObject(from) ||
    !isName(from.tab) ||
    !isPlainObject(target) ||
    !isName(target.tab) ||
    (target.view !== undefined && !isName(target.view)) ||
    !isName(command) ||
    !isPlainObject(args) ||
    !isJsonValue(args) ||
    !withinLimits(args, 1)
  ) {
    return { ok: false, code: 'invalid' }
  }
  return {
    ok: true,
    envelope: {
      v: 1,
      id,
      kind,
      actor: actor as Actor,
      from: { tab: from.tab },
      target:
        target.view === undefined
          ? { tab: target.tab }
          : { tab: target.tab, view: target.view },
      command,
      args: JSON.parse(JSON.stringify(args)) as Record<string, JsonValue>
    }
  }
}

/** Whether a JSON value at `depth` keeps to `inputLimits` (C-72). */
function withinLimits(value: JsonValue, depth: number): boolean {
  if (typeof value === 'string') {
    return codePoints(value) <= inputLimits.maxTextLength
  }
  if (typeof value !== 'object' || value === null) {
    return true
  }
  if (depth > inputLimits.maxDepth) {
    return false
  }
  if (Array.isArray(value)) {
    return (
      value.length <= inputLimits.maxArrayLength &&
      value.every(item => withinLimits(item, depth + 1))
    )
  }
  return Object.values(value).every(item => withinLimits(item, depth + 1))
}
