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
 *
 * The remote entry (ADR 0014) adds:
 *
 * - `expired`: the request came after its `expiresAt`; it did not run.
 * - `clock-skew`: the request was stamped more than 30 s ahead of the tab's
 *   clock; it did not run.
 * - `not-delivered`: no `received` came before the request expired; it did
 *   not run.
 * - `tab-unreachable`: the bound tab's connection is down; it did not run.
 * - `gone`: the binding ended; it did not run.
 * - `unknown-outcome`: a change was accepted but its end never came.
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
  | 'expired'
  | 'clock-skew'
  | 'not-delivered'
  | 'tab-unreachable'
  | 'gone'
  | 'unknown-outcome'

/** The most bytes the UTF-8 JSON of a response's `data` may take. */
export const dataMaxBytes = 32768

/**
 * How an operation ended, as its caller sees it. `summary` is the command's
 * short result (`CommandResponse.summary`), `data` its JSON result
 * (`CommandResponse.data`). `message` tells the caller what to fix: which
 * field a refused input misses, what the command said, or why the caller may
 * not run it; it is never drawn. `line` comes only with `not-allowed`: the
 * canonical line of a `change` command, which the caller hands to the user to
 * type.
 */
export type CommandOutcome =
  | { status: 'ok'; summary?: string; data?: JsonValue }
  | { status: 'error'; code: ErrorCode; message?: string; line?: string }
