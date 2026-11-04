// The dispatch feature (README: Running a line, Cancelling and errors,
// Sensitive lines; core README: The gate): ends lines, looks the command up,
// runs it and appends what it returns. A run is several actions: its start,
// each asynchronous `write()`, the echo of its envelope, and its end. Every
// end is guarded by the run: a run that is no longer current changes nothing
// and calls nothing (C-17).
import {
  type Actor,
  type CommandOutcome,
  type CommandResponse,
  type ContextFrame,
  type Envelope,
  type ErrorCode,
  type JsonValue,
  type MessageBlock,
  type OutputEntry,
  envelopeBytes,
  envelopeMaxBytes,
  formatCommandLine,
  parseEnvelope,
  parseOptions,
  tokenize,
  validateInput
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
  cutSummary,
  describedCommand,
  envelopeIds,
  rememberClosed,
  sameJson
} from './operation'
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
import type {
  AnyConsole,
  ConsoleFeature,
  RequestInput
} from '../console/console.types'
import {
  currentPrompt,
  reportCallbackError,
  reportError
} from '../console/console.utils'
import { addEntry, newId } from '../entries/entriesFeature'
import { endLine, replaceInput } from '../input/inputFeature'

type Input = Record<string, JsonValue>

/** How a line of a command with `input` goes on (C-77). */
interface Plan {
  /** The validated input, before `normalize`. */
  value: Input
  /** The view the line targets; called when the run starts. */
  view: () => string | undefined
  actor: Actor
}

interface Run {
  readonly id: string
  readonly inputId: string
  readonly info: RunInfo
  /** Completed with the canonical line once the plan is applied (C-77). */
  request: CommandRequest
  readonly command: CommandDefinition
  readonly controller: AbortController
  /** The context revision when the run started; `null` without context. */
  readonly contextRevision: number | null
  /** Whether the run goes through the gate (C-79). */
  readonly gated: boolean
  readonly actor: Actor
  /** False once the run ended or was invalidated. */
  current: boolean
  /** True once the run's cleanup ran (once, C-57). */
  cleaned: boolean
  /** The local record of the operation, once it is sent. */
  envelope: Envelope | null
  /** True while the envelope waits for its echo. */
  waiting: boolean
  cancelTimer: (() => void) | null
  /** How the run ended, for `request()`. */
  outcome: CommandOutcome
  resolve(result: boolean): void
  onOutcome?: (outcome: CommandOutcome) => void
}

interface DispatchState {
  run: Run | null
  lookup: { commands: CommandDefinition[]; value: CommandLookup } | null
  /** The gate's unsubscribe, once the console listens (C-78). */
  unsubscribe: (() => void) | null
  /** The newest closed envelope ids, oldest first (C-81). */
  closed: Set<string>
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

const failure = (code: ErrorCode): CommandOutcome => ({
  status: 'error',
  code
})

// --- The end of a run ---------------------------------------------------------

/**
 * Clears `running` when it still names `run`, cancels the echo timer,
 * records the envelope id as closed and resolves the run's promises.
 */
const cleanup = (console: object, run: Run) => {
  if (run.cleaned) {
    return
  }
  run.cleaned = true
  run.waiting = false
  const state = stateOf(console)
  if (state.run === run) {
    state.run = null
  }
  if (run.envelope) {
    rememberClosed(state.closed, run.envelope.id)
  }
  const cancelTimer = run.cancelTimer
  run.cancelTimer = null
  if (cancelTimer) {
    try {
      cancelTimer()
    } catch (error) {
      reportCallbackError(console, error)
    }
  }
  recordOf(console)?.store.update('running', running =>
    running?.runId === run.id ? null : running
  )
  run.resolve(true)
  run.onOutcome?.(run.outcome)
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
    const response = normalizeReturn(value)
    const summary = cutSummary(response.summary)
    run.outcome =
      summary === undefined ? { status: 'ok' } : { status: 'ok', summary }
    apply(console, run, response, 'default')
  } finally {
    cleanup(console, run)
  }
}

const fail = (console: object, run: Run, error: unknown) => {
  run.current = false
  run.outcome = failure('failed')
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
const stop = (console: object, run: Run, abort: boolean, code: ErrorCode) => {
  run.current = false
  run.outcome = failure(code)
  if (abort) {
    run.controller.abort()
  }
  cleanup(console, run)
}

/**
 * Ends an operation that did not run its command with an `operation-failed`
 * entry (C-79, C-80); `error` goes to `onError` with the run's info.
 */
const close = (console: object, run: Run, code: ErrorCode, error?: Error) => {
  run.current = false
  run.outcome = failure(code)
  run.controller.abort()
  try {
    if (error) {
      liveRecord(console).store.afterCommit(() =>
        reportError(recordOf(console)?.options.onError, error, run.info)
      )
    }
    addEntry(
      console,
      output('error', [message('operation-failed', { code })], run.inputId)
    )
  } finally {
    cleanup(console, run)
  }
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

const toRunning = (console: object, run: Run) =>
  liveRecord(console).store.update('running', running =>
    running?.runId === run.id ? { ...running, phase: 'running' } : running
  )

/** Calls the command's `run`. */
const go = (console: object, run: Run) => {
  toRunning(console, run)
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

/** What the gate delivered: the echo of the pending envelope, or nothing. */
const receive = (console: object, raw: unknown) => {
  const record = recordOf(console)
  const gate = record?.options.gate
  if (!record || !gate) {
    return
  }
  const parsed = parseEnvelope(raw)
  if (!parsed.ok) {
    return
  }
  const echo = parsed.envelope
  const state = stateOf(console)
  const run = state.run
  if (
    echo.target.tab !== gate.tab ||
    echo.from.tab !== echo.target.tab ||
    state.closed.has(echo.id) ||
    !run?.waiting ||
    run.envelope?.id !== echo.id
  ) {
    return
  }
  settle(console, run, () => {
    if (!run.waiting) {
      return
    }
    const local = run.envelope!
    run.waiting = false
    if (
      echo.command === local.command &&
      sameJson(echo.args, local.args) &&
      sameJson(echo.target, local.target)
    ) {
      go(console, run)
    } else {
      close(
        console,
        run,
        'id-conflict',
        new Error(`The echo of operation ${local.id} differs from its record.`)
      )
    }
  })
}

/**
 * Sends the run's envelope and waits for its echo (C-79): the timer and the
 * send are the gate's calls, made after the action's commit.
 */
const send = (console: object, run: Run) => {
  const { store, options } = liveRecord(console)
  const gate = options.gate!
  toRunning(console, run)
  let envelope: Envelope
  try {
    const id = envelopeIds(options)!()
    if (
      typeof id !== 'string' ||
      id === '' ||
      stateOf(console).closed.has(id)
    ) {
      throw new Error(`createEnvelopeId returned ${id}, an id already used.`)
    }
    const { view } = run.request
    envelope = {
      v: 1,
      id,
      kind: 'request',
      actor: run.actor,
      from: { tab: gate.tab },
      target: view === undefined ? { tab: gate.tab } : { tab: gate.tab, view },
      command: run.command.name,
      args: run.request.input!
    }
  } catch (error) {
    fail(console, run, error)
    return
  }
  if (envelopeBytes(envelope) > envelopeMaxBytes) {
    close(console, run, 'too-large')
    return
  }
  run.envelope = envelope
  run.waiting = true
  const ended = (code: ErrorCode) => () =>
    settle(console, run, () => {
      if (run.waiting) {
        close(console, run, code)
      }
    })
  store.afterCommit(() => {
    const state = stateOf(console)
    if (!run.waiting) {
      return
    }
    // Any of the gate's calls may throw; each ends the run in its own action.
    try {
      if (state.unsubscribe === null) {
        state.unsubscribe = gate.subscribe(raw => receive(console, raw))
      }
      run.cancelTimer = gate.schedule(
        options.echoTimeoutMs ?? 5000,
        ended('timeout')
      )
      // The transport gets a copy, so nothing it does reaches the record.
      const copy = JSON.parse(JSON.stringify(envelope)) as Envelope
      Promise.resolve(gate.send(copy)).then(
        undefined,
        ended('connection-lost')
      )
    } catch {
      ended('connection-lost')()
    }
  })
}

/** After `beforeRun` lets the run go: the gate, or the command at once. */
const proceed = (console: object, run: Run) => {
  if (run.gated) {
    send(console, run)
  } else {
    go(console, run)
  }
}

/**
 * Applies the plan of a command with `input` (C-77): normalizes and checks
 * the value, and completes the request from its canonical line. Throws on a
 * `normalize` or `activeView` that throws, or a value the schema refuses.
 */
const prepare = (run: Run, plan: Plan) => {
  const { command } = run
  const schema = command.input!
  const view = plan.view()
  const mapped = command.normalize ? command.normalize(plan.value) : plan.value
  const checked = validateInput(schema, mapped)
  if (!checked.ok) {
    throw new TypeError(
      `command ${command.name}: normalize returned an input the schema refuses.`
    )
  }
  const line = formatCommandLine(command.name, checked.value, schema)
  const tokens = tokenize(line).tokens
  run.request = {
    ...run.request,
    args: tokens.slice(1).map(token => token.value),
    rest: tokens.length > 1 ? line.slice(tokens[1].start) : '',
    line,
    input: checked.value
  }
  // An empty or `null` view is no view.
  if (typeof view === 'string' && view !== '') {
    run.request.view = view
  }
}

const start = (
  console: object,
  command: CommandDefinition,
  request: Omit<CommandRequest, 'context'>,
  inputId: string,
  sensitive: boolean,
  plan: Plan | null,
  onOutcome?: (outcome: CommandOutcome) => void
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
    gated:
      plan !== null &&
      options.gate !== undefined &&
      !sensitive &&
      describedCommand(command),
    actor: plan?.actor ?? 'user',
    current: true,
    cleaned: false,
    envelope: null,
    waiting: false,
    cancelTimer: null,
    outcome: failure('cancelled'),
    resolve,
    onOutcome
  }
  stateOf(console).run = run
  const { beforeRun } = options
  store.update('running', () => ({
    runId: id,
    command: command.name,
    inputId,
    phase: beforeRun ? 'authorizing' : 'running'
  }))
  if (plan) {
    try {
      prepare(run, plan)
    } catch (error) {
      fail(console, run, error)
      return done
    }
  }
  if (!beforeRun) {
    proceed(console, run)
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
      proceed(console, run)
    } else if (value === false) {
      stop(console, run, false, 'not-allowed')
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
  const args = parsed.tokens.slice(1).map(token => token.value)
  let plan: Plan | null = null
  if (command.input) {
    const read = parseOptions(args, command.input)
    if (!read.ok) {
      const [error] = read.errors
      addEntry(
        console,
        output(
          'error',
          [
            message('invalid-args', {
              path: sensitive ? null : error.path,
              reason: error.code
            })
          ],
          inputId
        )
      )
      return Promise.resolve(true)
    }
    if (command.danger === 'irreversible') {
      addEntry(
        console,
        output(
          'error',
          [message('operation-failed', { code: 'not-allowed' })],
          inputId
        )
      )
      return Promise.resolve(true)
    }
    plan = {
      value: read.value,
      view: () => liveRecord(console).options.activeView?.(),
      actor: 'user'
    }
  }
  return start(
    console,
    command,
    {
      name: first.value,
      command: command.name,
      args,
      rest: second ? trimmed.slice(second.start) : '',
      line: trimmed
    },
    inputId,
    sensitive,
    plan
  )
}

/**
 * `request()` in the open action (C-82): every refusal before the line is
 * accepted leaves no entry.
 */
const requestLine = (
  console: object,
  input: RequestInput
): Promise<CommandOutcome> => {
  const refuse = (code: ErrorCode) => Promise.resolve(failure(code))
  const { store } = liveRecord(console)
  if (store.read().running !== null) {
    return refuse('busy')
  }
  const lookup = lookupOf(console)
  let command: CommandDefinition | undefined
  let tokens: string[] | null = null
  let view: () => string | undefined
  if ('line' in input) {
    const parsed = tokenize(String(input.line).trim())
    if (!parsed.ok || parsed.tokens.length === 0) {
      return refuse('invalid-args')
    }
    command = lookup.find(parsed.tokens[0].value)
    tokens = parsed.tokens.slice(1).map(token => token.value)
    view = () => liveRecord(console).options.activeView?.()
  } else {
    command =
      typeof input.command === 'string' ? lookup.find(input.command) : undefined
    const given = typeof input.view === 'string' ? input.view : undefined
    view = () => given
  }
  if (!command) {
    return refuse('unknown-command')
  }
  if (
    !describedCommand(command) ||
    command.danger !== 'read' ||
    input.actor !== 'external-agent'
  ) {
    return refuse('not-allowed')
  }
  const schema = command.input!
  const read =
    tokens === null
      ? validateInput(schema, (input as { args: unknown }).args)
      : parseOptions(tokens, schema)
  if (!read.ok) {
    return refuse('invalid-args')
  }
  const line = formatCommandLine(command.name, read.value, schema)
  if (lookup.isSensitive(line)) {
    return refuse('not-allowed')
  }
  const inputId = addEntry(console, {
    kind: 'input',
    prompt: currentPrompt(console),
    text: line,
    redacted: false,
    status: 'submitted',
    actor: input.actor
  })
  return new Promise<CommandOutcome>(resolve => {
    void start(
      console,
      command,
      { name: command.name, command: command.name, args: [], rest: '', line },
      inputId,
      false,
      { value: read.value, view, actor: input.actor },
      resolve
    )
  })
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
  run.outcome = failure('cancelled')
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
    states.set(console, {
      run: null,
      lookup: null,
      unsubscribe: null,
      closed: new Set()
    })
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
        request(input: RequestInput): Promise<CommandOutcome> {
          try {
            return liveRecord(console).store.action(() =>
              requestLine(console, input)
            )
          } catch (error) {
            reportCallbackError(console, error)
            return Promise.resolve(failure('failed'))
          }
        },
        isSensitive: (line: string) => lookupOf(console).isSensitive(line),
        getCommands: () => lookupOf(console).visible().map(specOf)
      },
      {
        submit: Promise.resolve(false),
        run: Promise.resolve(false),
        request: Promise.resolve(failure('cancelled')),
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
      if (run?.current && run.waiting) {
        interrupt(console, run)
      } else if (run?.current && !run.controller.signal.aborted) {
        run.controller.abort()
      }
    })
    onReset(console, () => {
      const run = stateOf(console).run
      if (run) {
        stop(console, run, true, 'cancelled')
      }
    })
    onDispose(console, () => {
      const state = stateOf(console)
      const run = state.run
      const unsubscribe = state.unsubscribe
      state.run = null
      state.unsubscribe = null
      if (run) {
        stop(console, run, true, 'cancelled')
      }
      unsubscribe?.()
    })
  }
}
