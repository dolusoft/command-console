// The error a command throws to end its run with a code of its own (C-86,
// ADR 0012 addendum).
import type { ErrorCode } from '@dolusoft/command-protocol'

/**
 * The codes a command's `run` may end with through a `CommandError`. The
 * other codes belong to the core (`busy`, `timeout`, `id-conflict`, …); a
 * `CommandError` that carries one gives `failed`.
 */
export type CommandErrorCode = Extract<
  ErrorCode,
  'target-not-found' | 'invalid-args' | 'failed'
>

const commandCodes: readonly unknown[] = [
  'target-not-found',
  'invalid-args',
  'failed'
] satisfies CommandErrorCode[]

/**
 * Thrown (or rejected) by a command's `run` to end the run with `code`: the
 * run fails as with any error (`onError`, the error entry), and the outcome a
 * `request()` resolves is `{ status: 'error', code }`.
 */
export class CommandError extends Error {
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
 * The outcome code of an error a command's `run` threw: a `CommandError`'s
 * code when a command may give it, else `failed` (C-86).
 */
export const commandErrorCode = (error: unknown): CommandErrorCode =>
  error instanceof CommandError && commandCodes.includes(error.code)
    ? error.code
    : 'failed'
