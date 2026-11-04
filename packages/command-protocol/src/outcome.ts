import type { JsonValue } from './json'

/**
 * Why an operation ended without running its command, or why it failed:
 *
 * - `invalid-args`: the input does not match the command's schema.
 * - `unknown-command`: no command has that name.
 * - `not-allowed`: the entry it came from may not run the command.
 * - `target-not-found`: the target tab or view does not exist.
 * - `id-conflict`: the echo of the operation differs from its local record.
 * - `unsupported-version`: an envelope version the receiver does not know.
 * - `too-large`: the envelope is larger than `envelopeMaxBytes`, or the
 *   response's `data` is larger than `dataMaxBytes` or is not JSON.
 * - `busy`: the console is already running a command.
 * - `timeout`: the echo did not come in time.
 * - `failed`: the command threw or rejected.
 * - `connection-lost`: the transport failed.
 * - `cancelled`: the run was cancelled.
 */
export type ErrorCode =
  | 'invalid-args'
  | 'unknown-command'
  | 'not-allowed'
  | 'target-not-found'
  | 'id-conflict'
  | 'unsupported-version'
  | 'too-large'
  | 'busy'
  | 'timeout'
  | 'failed'
  | 'connection-lost'
  | 'cancelled'

/** The most bytes the UTF-8 JSON of a response's `data` may take. */
export const dataMaxBytes = 32768

/**
 * How an operation ended, as its caller sees it. `summary` is the command's
 * short result (`CommandResponse.summary`), `data` its JSON result
 * (`CommandResponse.data`). `message` tells the caller what to fix: which
 * field a refused input misses, or what the command said; it is never drawn.
 */
export type CommandOutcome =
  | { status: 'ok'; summary?: string; data?: JsonValue }
  | { status: 'error'; code: ErrorCode; message?: string }
