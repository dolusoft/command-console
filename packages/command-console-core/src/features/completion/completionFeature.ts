// The completion feature (spec §6.5, §6.6, ADR 0006): Tab completes the
// token at the caret from the visible command names or the command's
// `complete`. The candidate list is session state, never an entry. Argument
// positions at or after a command's `fromArg` (all of them for
// `sensitive: true` or a predicate match) call no provider and open no
// session (P16, C-35).
import type { Found, Target } from './completion.types'
import {
  commonPrefix,
  encode,
  filterCandidates,
  isLast,
  quoteOf,
  splice,
  targetAt
} from './completion.utils'
import type {
  AnyConsole,
  CompletionFeature,
  CompletionSession,
  ConsoleFeature
} from '../../core/console/console.types'
import type { CompletionResult } from '../../core/dispatch/dispatch.types'
import {
  assignMethods,
  contextOf,
  liveRecord,
  lookupOf,
  onInputChange,
  onKey,
  onLineCleared,
  registerKeyAction,
  writeInput
} from '../../shared'

const none: Found = { candidates: [], final: true }

const read = (console: object) => liveRecord(console).store.read()

const setSession = (console: object, session: CompletionSession | null) =>
  liveRecord(console).store.update('completion', () => session)

const write = (console: object, value: string, caret: number) =>
  writeInput(console, value, caret, 'completion')

/** A provider's result as candidates; anything else gives none. */
const resultOf = (result: CompletionResult, prefix: string): Found => {
  if (Array.isArray(result)) {
    return { candidates: filterCandidates(result, prefix), final: true }
  }
  if (
    typeof result === 'object' &&
    result !== null &&
    Array.isArray(result.candidates)
  ) {
    return {
      candidates: filterCandidates(result.candidates, prefix),
      final: result.final !== false
    }
  }
  return none
}

/**
 * The candidates of `target` (spec §6.5 steps 1–3), or `null` when its
 * position is not safe: then no provider is called and no session opens.
 * A line the predicate marks is unsafe everywhere, its name included; an
 * unknown first token that names a sensitive command case-insensitively is
 * unsafe at every argument position.
 */
const candidatesOf = (
  console: object,
  line: string,
  target: Target
): Found | null => {
  const lookup = lookupOf(console)
  if (lookup.matchesPredicate(line)) {
    return null
  }
  if (target.position === 0) {
    const names = lookup
      .visible()
      .flatMap(command => [command.name, ...(command.aliases ?? [])])
    return { candidates: filterCandidates(names, target.prefix), final: true }
  }
  const command = lookup.find(target.before[0])
  if (!command) {
    return lookup.isSensitive(line) ? null : none
  }
  const index = target.position - 1
  const from = lookup.sensitiveFrom(command)
  if (from !== null && index >= from) {
    return null
  }
  if (typeof command.complete !== 'function') {
    return none
  }
  try {
    return resultOf(
      command.complete({
        command: command.name,
        args: target.before.slice(1),
        prefix: target.prefix,
        index,
        context: contextOf(console)?.snapshot() ?? []
      }),
      target.prefix
    )
  } catch {
    return none
  }
}

/**
 * Writes a completed candidate into `[start, end)` (closed), then the space
 * of step 5 when `space` holds: a whitespace already after the span is
 * stepped over instead of doubled.
 */
const writeCompleted = (
  console: object,
  start: number,
  end: number,
  text: string,
  space: boolean
) => {
  const value = splice(read(console).input.value, start, end, text)
  const after = start + text.length
  if (!space) {
    write(console, value, after)
  } else if (/\s/.test(value.charAt(after))) {
    write(console, value, after + 1)
  } else {
    write(console, splice(value, after, after, ' '), after + 1)
  }
}

/** Tab with no session (spec §6.5 steps 1–7); `false` when nothing was done. */
const complete = (console: object): boolean => {
  const { input, running } = read(console)
  if (running !== null || input.value === '') {
    return false
  }
  setSession(console, null)
  const target = targetAt(input.value, input.caret)
  const found = candidatesOf(console, input.value, target)
  if (found === null) {
    return false
  }
  const { candidates, final } = found
  const { start, end, raw, quote } = target
  if (candidates.length === 0) {
    setSession(console, {
      status: 'none',
      candidates: [],
      final,
      active: -1,
      span: { start, end },
      original: raw
    })
    return true
  }
  if (candidates.length === 1) {
    writeCompleted(
      console,
      start,
      end,
      encode(candidates[0], quote, true),
      final && isLast(input.value, end)
    )
    return true
  }
  let spanEnd = end
  const shared = commonPrefix(candidates)
  if (shared.length > target.prefix.length) {
    const text = encode(shared, quote, false)
    spanEnd = start + text.length
    write(console, splice(input.value, start, end, text), spanEnd)
  }
  setSession(console, {
    status: 'open',
    candidates,
    final,
    active: -1,
    span: { start, end: spanEnd },
    original: raw
  })
  return true
}

const openSession = (console: object): CompletionSession | null => {
  const session = read(console).completion
  return session?.status === 'open' ? session : null
}

/** Selects the next (`1`) or previous (`-1`) candidate, with wrap (step 8). */
const select = (console: object, step: 1 | -1): boolean => {
  const session = openSession(console)
  if (!session) {
    return false
  }
  const count = session.candidates.length
  const active =
    session.active === -1
      ? step === 1
        ? 0
        : count - 1
      : (session.active + step + count) % count
  const text = encode(
    session.candidates[active],
    quoteOf(session.original),
    true
  )
  const { start, end } = session.span
  write(
    console,
    splice(read(console).input.value, start, end, text),
    start + text.length
  )
  setSession(console, {
    ...session,
    active,
    span: { start, end: start + text.length }
  })
  return true
}

/** Enter on a selected candidate: the space of step 5, session closed. */
const accept = (console: object): boolean => {
  const session = openSession(console)
  if (!session || session.active === -1) {
    return false
  }
  const value = read(console).input.value
  const { start, end } = session.span
  setSession(console, null)
  writeCompleted(
    console,
    start,
    end,
    value.slice(start, end),
    session.final && isLast(value, end)
  )
  return true
}

/** Escape: the original token back, session closed. */
const close = (console: object): boolean => {
  const session = read(console).completion
  if (!session) {
    return false
  }
  setSession(console, null)
  if (session.status === 'open') {
    const { start, end } = session.span
    write(
      console,
      splice(read(console).input.value, start, end, session.original),
      start + session.original.length
    )
  }
  return true
}

const feature = {
  name: 'completion',

  constructConsoleAPIs(console: AnyConsole) {
    const action = (fn: () => boolean) => () =>
      liveRecord(console).store.action(() =>
        read(console).running === null ? fn() : false
      )
    assignMethods(
      console,
      {
        complete: action(() => complete(console)),
        completeNext: action(() => select(console, 1) || complete(console)),
        completePrevious: action(() => select(console, -1)),
        acceptCompletion: action(() => accept(console)),
        closeCompletion: action(() => close(console))
      },
      {
        complete: false,
        completeNext: false,
        completePrevious: false,
        acceptCompletion: false,
        closeCompletion: false
      }
    )
  },

  init(console: AnyConsole) {
    registerKeyAction(console, 'completeNext', () => {
      if (select(console, 1)) {
        return true
      }
      // Tab on a non-empty input is always taken, even when nothing can be
      // completed; on an empty input it moves focus (spec §6.6, C-59).
      complete(console)
      return read(console).input.value !== ''
    })
    registerKeyAction(console, 'completePrevious', () => select(console, -1))
    registerKeyAction(console, 'selectNext', () => select(console, 1))
    registerKeyAction(console, 'selectPrevious', () => select(console, -1))
    registerKeyAction(console, 'acceptCompletion', () => accept(console))
    registerKeyAction(console, 'closeCompletion', () =>
      openSession(console) ? close(console) : false
    )
    // A session with no candidates closes on the next key (step 4).
    onKey(console, () => {
      if (read(console).completion?.status === 'none') {
        setSession(console, null)
      }
    })
    // Any edit or caret move the session did not make closes it (step 8).
    onInputChange(console, change => {
      if (change.origin !== 'completion' && read(console).completion) {
        setSession(console, null)
      }
    })
    onLineCleared(console, () => setSession(console, null))
  }
} satisfies ConsoleFeature & CompletionFeature

/**
 * The completion feature: Tab completes command names and, through a
 * command's `complete`, its safe arguments (spec §6.5).
 *
 * @example
 * ```ts
 * const console = createConsole({ commands, features: { completionFeature } })
 * ```
 */
export const completionFeature: CompletionFeature = feature
