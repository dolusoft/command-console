import type { AnyConsoleOptions } from './console.types'
import { liveRecord, promptOf, recordOf } from '../../shared'
import type { RunInfo } from '../dispatch/dispatch.types'

/** The prompt of the next input entry: the top frame's, else the root's. */
export const currentPrompt = (console: object): string =>
  promptOf(console) ?? liveRecord(console).options.prompt

/** Rethrows `error` outside the action, as an unhandled rejection. */
const rethrowAsync = (error: unknown): void => {
  void Promise.resolve().then(() => {
    throw error
  })
}

/**
 * Reports an error through `onError` (core README: Actions and
 * notification): a command's error with its `RunInfo`, a callback's error
 * with `null`. An error `onError` itself throws
 * is rethrown asynchronously; so is a callback's error without `onError`.
 */
export const reportError = (
  onError: AnyConsoleOptions['onError'],
  error: unknown,
  info: RunInfo | null
): void => {
  if (!onError) {
    if (info === null) {
      rethrowAsync(error)
    }
    return
  }
  try {
    onError(error, info)
  } catch (thrown) {
    rethrowAsync(thrown)
  }
}

/** The callback-error reporter of the store. */
export const reportCallbackError = (console: object, error: unknown): void =>
  reportError(recordOf(console)?.options.onError, error, null)
