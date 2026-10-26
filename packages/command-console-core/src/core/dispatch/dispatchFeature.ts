// The dispatch feature (README: Running a line, Cancelling and errors,
// Sensitive lines): ends lines, looks the command up, runs it and appends what
// it returns. A run is several actions: its start, each asynchronous `write()`,
// and its end. Every end is guarded by the run: a run that is no longer current
// changes nothing and calls nothing (C-17).
import {
  type CommandResponse,
  type ContextFrame,
  type MessageBlock,
  type OutputEntry,
  tokenize
} from '@dolusoft/command-protocol'

import type {
  CommandDefinition,
  CommandRequest,
  CommandReturn,
  RunContext,
  RunInfo
} from './dispatch.types'
import { blocksOf, isThenable, normalizeReturn, specOf } from './dispatch.utils'
import {
  isLineSensitive,
  matchesPredicate,
  sensitiveFrom,
  sensitiveNames
} from './sensitivity'
import {
  applyEffect,
  assignMethods,
  contextEffects,
  contextOf,
  isDisposed,
  lineSubmitted,
  liveRecord,
  onContextChange,
  onDispose,
  onReset,
  provideCommandLookup,
  recordOf,
  registerKeyAction,
  type CommandLookup
} from '../../shared'
import type { AnyConsole, ConsoleFeature } from '../console/console.types'
import { currentPrompt, reportError } from '../console/console.utils'
import { addEntry, newId } from '../entries/entriesFeature'
import { endLine, replaceInput } from '../input/inputFeature'

interface Run {
  readonly id: string
  readonly inputId: string
  readonly info: RunInfo
  readonly request: CommandRequest
  readonly command: CommandDefinition
  readonly controller: AbortController
  /** The context revision when the run started; `null` without context. */
  readonly contextRevision: number | null
  /** False once the run ended or was invalidated. */
  current: boolean
  /** True once the run's cleanup ran (once, C-57). */
  cleaned: boolean
  resolve(result: boolean): void
}

interface DispatchState {
  run: Run | null
  lookup: { commands: CommandDefinition[]; value: CommandLookup } | null
}

const states = new WeakMap<object, DispatchState>()

const stateOf = (console: object): DispatchState => states.get(console)!

/** The lookup of the current commands, rebuilt when `commands` changes. */
const lookupOf = (console: object): CommandLookup => {
  const state = stateOf(console)
  const record = liveRecord(console)
  const { commands } = record.options
  if (state.lookup?.commands !== commands) {
    const byName = new Map<string, CommandDefinition>()
    for (const command of commands) {
      for (const name of [command.name, ...(command.aliases ?? [])]) {
        byName.set(name, command)
      }
    }
    const names = sensitiveNames(commands)
    const value: CommandLookup = {
      find: name => byName.get(name),
      visible: () => commands.filter(command => command.hidden !== true),
      sensitiveFrom,
      matchesPredicate: line =>
        matchesPredicate(liveRecord(console).options.isSensitive, line),
      isSensitive: line =>
        isLineSensitive(line, names, liveRecord(console).options.isSensitive)
    }
    state.lookup = { commands, value }
  }
  return state.lookup.value
}

const message = (
  code: MessageBlock['code'],
  params?: MessageBlock['params']
): MessageBlock =>
  params === undefined
    ? { type: 'message', code }
    : { type: 'message', code, params }

const output = (
  tone: OutputEntry['tone'],
  blocks: OutputEntry['blocks'],
  inputId: string,
  quiet?: boolean
): Omit<OutputEntry, 'id'> =>
  quiet === true
    ? { kind: 'output', tone, blocks, inputId, quiet: true }
    : { kind: 'output', tone, blocks, inputId }

// --- The end of a run ---------------------------------------------------------

/** Clears `running` when it still names `run` and resolves its promise. */
const cleanup = (console: object, run: Run) => {
  if (run.cleaned) {
    return
  }
  run.cleaned = true
  const state = stateOf(console)
  if (state.run === run) {
    state.run = null
  }
  recordOf(console)?.store.update('running', running =>
    running?.runId === run.id ? null : running
  )
  run.resolve(true)
}

/** Effects in order, then the output (README: Running a line, B-29). */
const apply = (
  console: object,
  run: Run,
  response: CommandResponse,
  defaultTone: OutputEntry['tone']
) => {
  const changed =
    run.contextRevision !== (contextOf(console)?.revision() ?? null)
  for (const effect of response.effects ?? []) {
    if (!(changed && contextEffects.has(effect.type))) {
      applyEffect(console, effect)
    }
  }
  const blocks = blocksOf(response.output)
  if (blocks.length > 0) {
    addEntry(
      console,
      output(response.tone ?? defaultTone, blocks, run.inputId, response.quiet)
    )
  }
}

const fulfil = (console: object, run: Run, value: CommandReturn) => {
  run.current = false
  try {
    apply(console, run, normalizeReturn(value), 'default')
  } finally {
    cleanup(console, run)
  }
}

const fail = (console: object, run: Run, error: unknown) => {
  run.current = false
  try {
    const { store, options } = liveRecord(console)
    store.afterCommit(() =>
      reportError(recordOf(console)?.options.onError, error, run.info)
    )
    let response: CommandResponse | undefined
    if (options.formatError) {
      try {
        response = normalizeReturn(options.formatError(error, run.info))
      } catch {
        response = undefined
      }
    }
    if (response) {
      apply(console, run, response, 'error')
    } else {
      addEntry(
        console,
        output('error', [message('command-failed')], run.inputId)
      )
    }
  } finally {
    cleanup(console, run)
  }
}

/** Ends `run` without output and without an entry (`false`, reset, dispose). */
const stop = (console: object, run: Run, abort: boolean) => {
  run.current = false
  if (abort) {
    run.controller.abort()
  }
  cleanup(console, run)
}

/** Runs `fn` as its own action if `run` is still current (a settle). */
const settle = (console: object, run: Run, fn: () => void) => {
  if (!run.current || isDisposed(console)) {
    return
  }
  const { store } = liveRecord(console)
  store.action(() => {
    if (run.current) {
      fn()
    }
  })
}

/** Handles a return that may be a promise: now, or in its own action. */
const whenSettled = <T>(
  console: object,
  run: Run,
  value: T | PromiseLike<T>,
  onValue: (value: T) => void
) => {
  if (isThenable(value)) {
    Promise.resolve(value).then(
      result => settle(console, run, () => onValue(result)),
      (error: unknown) => settle(console, run, () => fail(console, run, error))
    )
  } else {
    onValue(value)
  }
}

// --- The start of a run -------------------------------------------------------

const go = (console: object, run: Run) => {
  liveRecord(console).store.update('running', running =>
    running?.runId === run.id ? { ...running, phase: 'running' } : running
  )
  const context: RunContext = {
    runId: run.id,
    inputId: run.inputId,
    signal: run.controller.signal,
    write: (out, tone) => write(console, run, out, tone)
  }
  let result: CommandReturn | Promise<CommandReturn>
  try {
    result = run.command.run(run.request, context)
  } catch (error) {
    fail(console, run, error)
    return
  }
  whenSettled(console, run, result, value => fulfil(console, run, value))
}

const write = (
  console: object,
  run: Run,
  out: Parameters<RunContext['write']>[0],
  tone: OutputEntry['tone'] | undefined
) => {
  settle(console, run, () => {
    const blocks = blocksOf(out)
    if (blocks.length > 0) {
      addEntry(console, output(tone ?? 'default', blocks, run.inputId))
    }
  })
}

const start = (
  console: object,
  command: CommandDefinition,
  request: Omit<CommandRequest, 'context'>,
  inputId: string,
  sensitive: boolean
): Promise<boolean> => {
  const { store, options } = liveRecord(console)
  const provider = contextOf(console)
  const frames: ContextFrame[] = provider?.snapshot() ?? []
  const id = newId(console)
  let resolve!: (result: boolean) => void
  const done = new Promise<boolean>(r => {
    resolve = r
  })
  const run: Run = {
    id,
    inputId,
    info: {
      runId: id,
      inputId,
      name: sensitive ? null : request.name,
      command: command.name,
      sensitive,
      context: [...frames]
    },
    request: { ...request, context: [...frames] },
    command,
    controller: new AbortController(),
    contextRevision: provider?.revision() ?? null,
    current: true,
    cleaned: false,
    resolve
  }
  stateOf(console).run = run
  const { beforeRun } = options
  store.update('running', () => ({
    runId: id,
    command: command.name,
    inputId,
    phase: beforeRun ? 'authorizing' : 'running'
  }))
  if (!beforeRun) {
    go(console, run)
    return done
  }
  let answer: ReturnType<typeof beforeRun>
  try {
    answer = beforeRun(run.info, run.controller.signal)
  } catch (error) {
    fail(console, run, error)
    return done
  }
  whenSettled(console, run, answer, value => {
    if (value === undefined) {
      go(console, run)
    } else if (value === false) {
      stop(console, run, false)
    } else {
      fulfil(console, run, value)
    }
  })
  return done
}

// --- Ending a line ------------------------------------------------------------

/**
 * Ends the live input as Enter does (README: Running a line, start action).
 * Runs in the open action; resolves after the run's end, or at once when
 * nothing runs.
 */
const submitLine = (console: object): Promise<boolean> => {
  const { store } = liveRecord(console)
  const line = store.read().input.value
  const trimmed = line.trim()
  const prompt = currentPrompt(console)
  if (trimmed === '') {
    addEntry(console, {
      kind: 'input',
      prompt,
      text: '',
      redacted: false,
      status: 'submitted'
    })
    endLine(console, false)
    return Promise.resolve(true)
  }
  const lookup = lookupOf(console)
  const sensitive = lookup.isSensitive(line)
  const inputId = addEntry(console, {
    kind: 'input',
    prompt,
    text: sensitive ? null : trimmed,
    redacted: sensitive,
    status: 'submitted'
  })
  endLine(console, sensitive)
  if (!sensitive) {
    lineSubmitted(console, trimmed)
  }
  const parsed = tokenize(trimmed)
  if (!parsed.ok) {
    const index = sensitive ? null : parsed.error.index
    addEntry(
      console,
      output('error', [message('unterminated-quote', { index })], inputId)
    )
    return Promise.resolve(true)
  }
  const [first, second] = parsed.tokens
  const command = lookup.find(first.value)
  if (!command) {
    const name = sensitive ? null : first.value
    addEntry(
      console,
      output('error', [message('command-not-found', { name })], inputId)
    )
    return Promise.resolve(true)
  }
  return start(
    console,
    command,
    {
      name: first.value,
      command: command.name,
      args: parsed.tokens.slice(1).map(token => token.value),
      rest: second ? trimmed.slice(second.start) : '',
      line: trimmed
    },
    inputId,
    sensitive
  )
}

/**
 * Ctrl+C without a run: the line ends as cancelled (README: Cancelling and
 * errors, B-10).
 */
const cancelLine = (console: object) => {
  const { store } = liveRecord(console)
  const trimmed = store.read().input.value.trim()
  const sensitive = trimmed !== '' && lookupOf(console).isSensitive(trimmed)
  addEntry(console, {
    kind: 'input',
    prompt: currentPrompt(console),
    text: sensitive ? null : trimmed,
    redacted: sensitive,
    status: 'cancelled'
  })
  endLine(console, sensitive)
}

/** Ctrl+C or `cancel()` during a run: invalidate, abort, `interrupted`. */
const interrupt = (console: object, run: Run) => {
  run.current = false
  run.controller.abort()
  addEntry(console, output('notice', [message('interrupted')], run.inputId))
  cleanup(console, run)
}

const cancel = (console: object) => {
  const run = stateOf(console).run
  if (run) {
    interrupt(console, run)
  } else {
    cancelLine(console)
  }
}

export const dispatchFeature: ConsoleFeature = {
  name: 'dispatch',

  constructConsoleAPIs(console: AnyConsole) {
    states.set(console, { run: null, lookup: null })
    const locked = <T>(fn: () => Promise<T>, otherwise: T): Promise<T> => {
      const { store } = liveRecord(console)
      return store.action(() =>
        store.read().running === null ? fn() : Promise.resolve(otherwise)
      )
    }
    assignMethods(
      console,
      {
        submit: () => locked(() => submitLine(console), false),
        run: (line: string) =>
          locked(() => {
            replaceInput(console, line)
            return submitLine(console)
          }, false),
        cancel() {
          liveRecord(console).store.action(() => cancel(console))
        },
        isSensitive: (line: string) => lookupOf(console).isSensitive(line),
        getCommands: () => lookupOf(console).visible().map(specOf)
      },
      {
        submit: Promise.resolve(false),
        run: Promise.resolve(false),
        isSensitive: false,
        getCommands: []
      }
    )
  },

  init(console: AnyConsole) {
    provideCommandLookup(console, {
      find: name => lookupOf(console).find(name),
      visible: () => lookupOf(console).visible(),
      sensitiveFrom,
      matchesPredicate: line => lookupOf(console).matchesPredicate(line),
      isSensitive: line => lookupOf(console).isSensitive(line)
    })
    registerKeyAction(console, 'submit', () => {
      void submitLine(console)
      return true
    })
    registerKeyAction(console, 'cancel', () => {
      cancel(console)
      return true
    })
    onContextChange(console, () => {
      const run = stateOf(console).run
      if (run?.current && !run.controller.signal.aborted) {
        run.controller.abort()
      }
    })
    onReset(console, () => {
      const run = stateOf(console).run
      if (run) {
        stop(console, run, true)
      }
    })
    onDispose(console, () => {
      const state = stateOf(console)
      const run = state.run
      state.run = null
      if (run) {
        stop(console, run, true)
      }
    })
  }
}
