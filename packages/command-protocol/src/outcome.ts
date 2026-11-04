/**
 * Why an operation ended without running its command, or why it failed:
 *
 * - `invalid-args`: the input does not match the command's schema.
 * - `unknown-command`: no command has that name.
 * - `not-allowed`: the entry it came from may not run the command.
 * - `target-not-found`: the target tab or view does not exist.
 * - `id-conflict`: the echo of the operation differs from its local record.
 * - `unsupported-version`: an envelope version the receiver does not know.
 * - `too-large`: the envelope is larger than `envelopeMaxBytes`.
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

/**
 * How an operation ended, as its caller sees it. `summary` is the command's
 * short result (`CommandResponse.summary`).
 */
export type CommandOutcome =
  | { status: 'ok'; summary?: string }
  | { status: 'error'; code: ErrorCode; message?: string }
