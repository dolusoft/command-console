// The error a command throws to end its run with a code of its own (C-86,
// ADR 0012 addendum).
import type { CommandOutcome, ErrorCode } from '@dolusoft/command-protocol'

import { cutMessage } from './inputText'

/**
 * The codes a command's `run` may end with through a `CommandError`. The
 * other codes belong to the core (`busy`, `timeout`, `id-conflict`, …); a
 * `CommandError` that carries one gives `failed`.
 */
export type CommandErrorCode = Extract<
  ErrorCode,
  'target-not-found' | 'invalid-args' | 'not-allowed' | 'failed'
>

/**
 * Thrown (or rejected) by a command's `run` to end the run with `code`: the
 * run fails as with any error (`onError`, the error entry), and the outcome a
 * `request()` resolves is `{ status: 'error', code }`.
 */
export class CommandError extends Error {
  /** The code the run's outcome carries. */
  readonly code: CommandErrorCode

  constructor(
    code: CommandErrorCode,
    message?: string,
    options?: ErrorOptions
  ) {
    super(message ?? code, options)
    this.name = 'CommandError'
    this.code = code
  }
}

/**
 * The outcome of an error a command's `run` threw (C-86, C-89): its code, and
 * the message of a `CommandError` cut to `messageLimit` code points. Any
 * other error gives `failed` without a message, so nothing internal leaks; a
 * `CommandError` made without a message (its message is its code) gives none.
 */
export const commandFailure = (error: unknown): CommandOutcome => {
  if (!(error instanceof Error) || error.name !== 'CommandError') {
    return { status: 'error', code: 'failed' }
  }
  const raw = (error as Error & { code?: unknown }).code
  // Recognize a CommandError from another copy of the core by its name;
  // its code still has to be one a command may give (C-86).
  const code =
    raw === 'target-not-found' ||
    raw === 'invalid-args' ||
    raw === 'not-allowed'
      ? raw
      : 'failed'
  return {
    status: 'error',
    code,
    ...(typeof error.message === 'string' && error.message !== raw
      ? { message: cutMessage(error.message) }
      : {})
  }
}
