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
  type CliReply,
  type CliRequest,
  envelopeBytes,
  envelopeMaxBytes,
  formatCommandLine,
  parseCliMessage,
  parseEnvelope,
  parseOptions,
  tokenize,
  validateInput
} from '@dolusoft/command-protocol'

import { commandFailure } from './commandError'
import type {
  ApprovalDetails,
  ApprovalPlan,
  CommandDefinition,
  CommandRequest,
  CommandReturn,
  RemoteBinding,
  RunContext,
  RunInfo
} from './dispatch.types'
import {
  blocksOf,
  isThenable,
  namespaceSpecOf,
  normalizeReturn,
  specOf
} from './dispatch.utils'
import { cutMessage, describeInputErrors, listsFromText } from './inputText'
import {
  checkData,
  cutSummary,
  describedCommand,
  envelopeIds,
  rememberClosed,
  sameJson
} from './operation'
import {
  approvalHoldMs,
  approvalMs,
  capabilitiesOf,
  checkBinding,
  finishedReplies,
  stampRefusal
} from './remote'
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
  onOptionsChange,
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
  /** Set for a request of the bound CLI (ADR 0014). */
  remote: RemoteRun | null
}

/** A binding as the console holds it; `alive` is false once it ended. */
interface Holder {
  binding: RemoteBinding
  alive: boolean
}

/** What a run of a CLI request carries. */
interface RemoteRun {
  requestId: string
  holder: Holder
  /** The command needs the user's approval before it runs (C-99). */
  change: boolean
  /** The command runs as its preview (C-95). */
  preview: boolean
  /** True once the command's `run` was called. */
  started: boolean
  approval: ApprovalPlan | null
}

interface DispatchState {
  run: Run | null
  lookup: { commands: CommandDefinition[]; value: CommandLookup } | null
  /** The gate's unsubscribe, once the console listens (C-78). */
  unsubscribe: (() => void) | null
  /** The newest closed envelope ids, oldest first (C-81). */
  closed: Set<string>
  /** The bound CLI (C-97). */
  remote: Holder | null
  /** The newest CLI request ids seen (C-98). */
  seen: Set<string>
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

const failure = (code: ErrorCode, text?: string): CommandOutcome =>
  text === undefined
    ? { status: 'error', code }
    : { status: 'error', code, message: text }

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
  const record = recordOf(console)
  record?.store.update('running', running =>
    running?.runId === run.id ? null : running
  )
  if (run.remote?.approval) {
    const { requestId } = run.remote
    run.remote.approval = null
    record?.store.update('remote', remote =>
      remote?.approval?.requestId === requestId
        ? { ...remote, approval: null }
        : remote
    )
  }
  run.resolve(true)
  run.onOutcome?.(run.outcome)
}

// --- Replies to the bound CLI (ADR 0014) --------------------------------------

/**
 * Sends `replies` through the binding after the open action's commit, in
 * order; nothing once the binding ended. A `send` that throws or rejects is
 * reported to `onError` and changes nothing else.
 */
const reply = (console: object, holder: Holder, ...replies: CliReply[]) => {
  const record = recordOf(console)
  if (!record || !holder.alive) {
    return
  }
  const deliver = () => {
    for (const item of replies) {
      if (!holder.alive) {
        return
      }
      try {
        Promise.resolve(holder.binding.send(item)).then(undefined, error =>
          reportCallbackError(console, error)
        )
      } catch (error) {
        reportCallbackError(console, error)
      }
    }
  }
  if (record.store.inAction()) {
    record.store.afterCommit(deliver)
  } else {
    deliver()
  }
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

/**
 * Ends `run` with what it returned. An `error` tone is `failed` (C-87);
 * `data` that is not JSON or is over `dataMaxBytes` is `too-large` (C-88). A
 * typed line has no caller, so its `data` is not read. The command's value
 * is read only inside `checkData`, and the outcome's `data` is parsed from
 * the text it returns.
 */
const fulfil = (console: object, run: Run, value: CommandReturn) => {
  run.current = false
  try {
    const response = normalizeReturn(value)
    const text =
      run.onOutcome && response.data !== undefined
        ? checkData(response.data)
        : ''
    const summary = cutSummary(response.summary)
    run.outcome =
      response.tone === 'error'
        ? failure('failed')
        : text === undefined
          ? failure('too-large')
          : {
              status: 'ok',
              ...(summary !== undefined && { summary }),
              ...(text && { data: JSON.parse(text) as JsonValue })
            }
    apply(console, run, response, 'default')
  } finally {
    cleanup(console, run)
  }
}

/**
 * Ends `run` as failed (C-18); `outcome` is `failed` unless the command's own
 * `run` threw a `CommandError` (C-86, C-89).
 */
const fail = (
  console: object,
  run: Run,
  error: unknown,
  outcome: CommandOutcome = failure('failed')
) => {
  run.current = false
  run.outcome = outcome
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
const close = (
  console: object,
  run: Run,
  code: ErrorCode,
  error?: Error,
  text?: string
) => {
  run.current = false
  run.outcome = failure(code, text)
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

/**
 * Handles a return that may be a promise: now, or in its own action. A
 * rejection fails the run with the outcome `outcomeOf` gives it.
 */
const whenSettled = <T>(
  console: object,
  run: Run,
  value: T | PromiseLike<T>,
  onValue: (value: T) => void,
  outcomeOf: (error: unknown) => CommandOutcome = () => failure('failed')
) => {
  if (isThenable(value)) {
    Promise.resolve(value).then(
      result => settle(console, run, () => onValue(result)),
      (error: unknown) =>
        settle(console, run, () => fail(console, run, error, outcomeOf(error)))
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
  if (run.remote) {
    run.remote.started = true
  }
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
    fail(console, run, error, commandFailure(error))
    return
  }
  whenSettled(
    console,
    run,
    result,
    value => fulfil(console, run, value),
    commandFailure
  )
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
  const kind = (raw as { kind?: unknown } | null)?.kind
  if (
    typeof raw === 'object' &&
    (kind === 'cli-request' || kind === 'cancel')
  ) {
    receiveRemote(console, raw)
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
      Promise.resolve(gate.send(copy)).then(undefined, ended('connection-lost'))
    } catch {
      ended('connection-lost')()
    }
  })
}

/**
 * A change from the CLI waits for the user (C-99): the command's `plan`
 * gives the targets and the preview, the window opens for `approvalMs`, and
 * only `approve()` runs the command, with the input the plan shows.
 */
const askApproval = (console: object, run: Run, remote: RemoteRun) => {
  liveRecord(console).store.update('running', running =>
    running?.runId === run.id ? { ...running, phase: 'approving' } : running
  )
  let details: ApprovalDetails | Promise<ApprovalDetails> | undefined
  try {
    details = run.command.plan?.(
      structuredCopy(run.request.input!),
      run.controller.signal
    )
  } catch (error) {
    fail(console, run, error)
    return
  }
  whenSettled(console, run, details, given => {
    const { store, options } = liveRecord(console)
    const now = options.now!()
    const targets = Array.isArray(given?.targets)
      ? given.targets.filter(
          (target): target is string => typeof target === 'string'
        )
      : []
    const preview =
      typeof given?.preview === 'string' ? given.preview : undefined
    const approval: ApprovalPlan = {
      requestId: remote.requestId,
      command: run.command.name,
      line: run.request.line,
      input: structuredCopy(run.request.input!),
      targets,
      ...(preview !== undefined && { preview }),
      ...(run.request.view !== undefined && { view: run.request.view }),
      openedAt: now,
      acceptsAt: now + approvalHoldMs,
      expiresAt: now + approvalMs
    }
    remote.approval = approval
    store.update('remote', state => state && { ...state, approval })
    reply(console, remote.holder, {
      v: 1,
      kind: 'awaiting-approval',
      id: remote.requestId,
      expiresAt: approval.expiresAt
    })
    store.afterCommit(() => {
      if (!remote.approval || !run.current) {
        return
      }
      try {
        run.cancelTimer = options.gate!.schedule(approvalMs, () =>
          settle(console, run, () => {
            if (remote.approval) {
              close(
                console,
                run,
                'not-allowed',
                undefined,
                'The approval expired; nothing changed.'
              )
            }
          })
        )
      } catch {
        settle(console, run, () => {
          close(console, run, 'connection-lost')
        })
      }
    })
  })
}

const structuredCopy = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T

/** After `beforeRun` lets the run go: the gate, or the command at once. */
const proceed = (console: object, run: Run) => {
  if (run.remote?.change) {
    askApproval(console, run, run.remote)
  } else if (run.gated) {
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
  onOutcome?: (outcome: CommandOutcome) => void,
  remote: RemoteRun | null = null
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
    // A CLI request has no echo: the hub sent it to this tab only.
    gated:
      remote === null &&
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
    onOutcome,
    remote
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
  // An irreversible command never runs from the console, with or without
  // input, before its options are read (C-77).
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
  const refuse = (code: ErrorCode, text?: string) =>
    Promise.resolve(failure(code, text))
  const { store } = liveRecord(console)
  if (store.read().running !== null) {
    return refuse('busy')
  }
  const lookup = lookupOf(console)
  let command: CommandDefinition | undefined
  let tokens: string[] | null = null
  let text = ''
  let view: () => string | undefined
  if ('line' in input) {
    text = String(input.line).trim()
    const parsed = tokenize(text)
    if (!parsed.ok) {
      return refuse('invalid-args', 'unterminated quote')
    }
    if (parsed.tokens.length === 0) {
      return refuse('invalid-args', 'empty line')
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
  // A hidden command is unknown to a caller, even one that knows its name.
  if (!command || command.hidden === true) {
    return refuse('unknown-command')
  }
  // Every `not-allowed` says why; a `change` command's also gives the line
  // the user may type (C-93).
  const { name } = command
  if (input.actor !== 'external-agent') {
    return refuse(
      'not-allowed',
      'request runs commands for external-agent only.'
    )
  }
  if (!describedCommand(command)) {
    return refuse(
      'not-allowed',
      `${name} is not open to agents; only the user can run it in the terminal.`
    )
  }
  if (command.danger === 'irreversible') {
    return refuse(
      'not-allowed',
      `${name} cannot be undone, so it never runs from the console, not even when the user types it.`
    )
  }
  // A command with `confirm` is a preview until its field is `true` (C-95).
  let change = command.danger === 'change' && command.confirm === undefined
  const userOnly = `${name} changes data; only the user can run it by typing it in the terminal.`
  const schema = command.input!
  // No args is `{}`; a string for an array of strings is a list of one (C-91).
  const args = (input as { args?: unknown }).args
  const read =
    tokens === null
      ? validateInput(
          schema,
          listsFromText(schema, args === undefined ? {} : args)
        )
      : parseOptions(tokens, schema)
  // A line the console would redact says nothing back (P16, C-89).
  const typedSensitive = tokens !== null && lookup.isSensitive(text)
  if (!read.ok) {
    const errors = typedSensitive
      ? undefined
      : describeInputErrors(schema, read.errors)
    return change
      ? refuse(
          'not-allowed',
          cutMessage(
            errors === undefined
              ? userOnly
              : `${userOnly} Its args do not match its input: ${errors}.`
          )
        )
      : refuse('invalid-args', errors)
  }
  change = command.danger === 'change' && !isPreview(command, read.value)
  const line = formatCommandLine(command.name, read.value, schema)
  const sensitive = lookup.isSensitive(line)
  if (change) {
    // A line the console would redact is never handed back (P16).
    return Promise.resolve(
      sensitive || typedSensitive
        ? failure('not-allowed', userOnly)
        : {
            status: 'error',
            code: 'not-allowed',
            message: `${userOnly} Suggest this line to the user instead of retrying.`,
            line
          }
    )
  }
  if (sensitive) {
    return refuse(
      'not-allowed',
      'The line is sensitive; only the user can type it in the terminal.'
    )
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

/** Whether `value` asks a command with `confirm` for its preview (C-95). */
const isPreview = (command: CommandDefinition, value: Input): boolean =>
  command.confirm !== undefined && value[command.confirm.field] !== true

// --- The remote entry (ADR 0014) ----------------------------------------------

/**
 * A message the gate delivered with a CLI `kind` (C-98): read with
 * `parseCliMessage`; one it refuses, one without a live binding, and one
 * whose `origin` is not the binding's is ignored.
 */
const receiveRemote = (console: object, raw: unknown) => {
  const parsed = parseCliMessage(raw)
  const state = stateOf(console)
  const holder = state.remote
  if (!parsed.ok || !holder?.alive || isDisposed(console)) {
    return
  }
  const { message: received } = parsed
  const { binding } = holder
  if (
    received.origin.bindingId !== binding.bindingId ||
    received.origin.grantId !== binding.grantId
  ) {
    return
  }
  liveRecord(console).store.action(() => {
    if (!holder.alive) {
      return
    }
    if (received.kind === 'cancel') {
      cancelRemote(console, received.id)
    } else {
      acceptRemote(console, holder, received)
    }
  })
}

/** Ends CLI request `id` before it is accepted: only `finished`. */
const refuseRemote = (
  console: object,
  holder: Holder,
  id: string,
  code: ErrorCode,
  text?: string
) => {
  reply(console, holder, {
    v: 1,
    kind: 'finished',
    id,
    outcome:
      text === undefined
        ? { status: 'error', code }
        : { status: 'error', code, message: cutMessage(text) },
    chunks: 0,
    bytes: 0
  })
}

/**
 * A stamped request (C-98): its id seen once, its stamp checked with `now`,
 * then the path of an agent's line with `actor: 'cli'`: no queue (`busy`), a
 * sensitive, `irreversible` or undescribed command refused, the options
 * read; a preview runs as `read`, a change waits for approval (C-99).
 */
const acceptRemote = (console: object, holder: Holder, request: CliRequest) => {
  const state = stateOf(console)
  const { id } = request
  if (state.seen.has(id) || state.closed.has(id)) {
    return
  }
  rememberClosed(state.seen, id)
  const { store, options } = liveRecord(console)
  const refuse = (code: ErrorCode, text?: string) =>
    refuseRemote(console, holder, id, code, text)
  const stamp = stampRefusal(request, options.now!())
  if (stamp) {
    refuse(stamp.code, stamp.message)
    return
  }
  if (store.read().running !== null) {
    refuse(
      'busy',
      'The terminal is running another command; nothing was queued.'
    )
    return
  }
  const lookup = lookupOf(console)
  const text = request.line.trim()
  const parsed = tokenize(text)
  if (!parsed.ok) {
    refuse('invalid-args', 'unterminated quote')
    return
  }
  if (parsed.tokens.length === 0) {
    refuse('invalid-args', 'empty line')
    return
  }
  const command = lookup.find(parsed.tokens[0].value)
  if (!command || command.hidden === true) {
    refuse('unknown-command')
    return
  }
  const { name } = command
  // A sensitive command or line never runs from the CLI and says nothing
  // back of its line (P16).
  if (
    (command.sensitive !== undefined && command.sensitive !== false) ||
    lookup.isSensitive(text)
  ) {
    refuse(
      'not-allowed',
      'The line is sensitive; it never runs from the CLI. Type it in the browser.'
    )
    return
  }
  if (command.danger === 'irreversible') {
    refuse(
      'not-allowed',
      `${name} cannot be undone, so it never runs from the console.`
    )
    return
  }
  if (!describedCommand(command)) {
    refuse(
      'not-allowed',
      `${name} is not open to the CLI; only the user can run it in the browser.`
    )
    return
  }
  const schema = command.input!
  const read = parseOptions(
    parsed.tokens.slice(1).map(token => token.value),
    schema
  )
  if (!read.ok) {
    refuse('invalid-args', describeInputErrors(schema, read.errors))
    return
  }
  const line = formatCommandLine(command.name, read.value, schema)
  if (lookup.isSensitive(line)) {
    refuse(
      'not-allowed',
      'The line is sensitive; it never runs from the CLI. Type it in the browser.'
    )
    return
  }
  const preview = isPreview(command, read.value)
  const remote: RemoteRun = {
    requestId: id,
    holder,
    change: command.danger === 'change' && !preview,
    preview: command.confirm !== undefined && preview,
    started: false,
    approval: null
  }
  let status: { hidden: boolean; dataAgeMs?: number | null } | undefined
  try {
    status = holder.binding.status?.()
  } catch (error) {
    reportCallbackError(console, error)
  }
  const age = status?.dataAgeMs
  reply(console, holder, {
    v: 1,
    kind: 'received',
    id,
    hidden: status?.hidden === true,
    dataAgeMs:
      typeof age === 'number' && Number.isFinite(age) && age >= 0 ? age : null
  })
  const inputId = addEntry(console, {
    kind: 'input',
    prompt: currentPrompt(console),
    text: line,
    redacted: false,
    status: 'submitted',
    actor: 'cli'
  })
  // The view is fixed on accept: the request's, else the active one.
  let view: string | undefined
  try {
    view = request.view ?? options.activeView?.()
  } catch (error) {
    reportCallbackError(console, error)
  }
  const shown = typeof view === 'string' && view !== '' ? view : undefined
  void start(
    console,
    command,
    { name: command.name, command: command.name, args: [], rest: '', line },
    inputId,
    false,
    { value: read.value, view: () => shown, actor: 'cli' },
    outcome =>
      reply(
        console,
        holder,
        ...finishedReplies(id, outcome, shown, holder.binding, remote.preview)
      ),
    remote
  )
}

/**
 * A `cancel` of the bound CLI (C-101): the run of request `id`, if it is the
 * current one, is interrupted, and the CLI hears whether its command had
 * started. Another id is ignored.
 */
const cancelRemote = (console: object, id: string) => {
  const run = stateOf(console).run
  const remote = run?.remote
  if (!run || !remote || remote.requestId !== id || !run.current) {
    return
  }
  reply(console, remote.holder, {
    v: 1,
    kind: remote.started ? 'cancel-requested' : 'cancelled-before-start',
    id
  })
  interrupt(console, run)
}

/**
 * Drops the waiting approval of the current run (detach, suspend; C-99): the
 * run ends `not-allowed` with `text`, nothing changed.
 */
const dropApproval = (console: object, text: string) => {
  const run = stateOf(console).run
  if (run?.current && run.remote?.approval) {
    close(console, run, 'not-allowed', undefined, text)
  }
}

/** Ends the binding (C-97): nothing more is sent through it. */
const detach = (console: object) => {
  const state = stateOf(console)
  const holder = state.remote
  if (!holder) {
    return
  }
  dropApproval(console, 'The CLI was disconnected; nothing changed.')
  holder.alive = false
  state.remote = null
  liveRecord(console).store.update('remote', () => null)
}

const attach = (console: object, given: RemoteBinding) => {
  const binding = checkBinding(given)
  const record = liveRecord(console)
  const { gate, now } = record.options
  if (!gate || typeof now !== 'function') {
    throw new TypeError('attachRemote needs the gate and now options.')
  }
  const state = stateOf(console)
  // Subscribed now, not on the first envelope (C-78, C-97): a bound tab
  // that never sent anything still hears its CLI.
  if (state.unsubscribe === null) {
    state.unsubscribe = gate.subscribe(raw => receive(console, raw))
  }
  record.store.action(() => {
    detach(console)
    const holder: Holder = { binding, alive: true }
    state.remote = holder
    record.store.update('remote', () => ({
      bindingId: binding.bindingId,
      approvedAt: binding.approvedAt,
      approval: null
    }))
    reply(
      console,
      holder,
      capabilitiesOf(binding.bindingId, record.options.commands)
    )
  })
}

/** `approve()` (C-99): the plan runs once, after its first second. */
const approve = (console: object, requestId: string): boolean => {
  const run = stateOf(console).run
  const approval = run?.remote?.approval
  if (!run?.current || approval?.requestId !== requestId) {
    return false
  }
  const now = liveRecord(console).options.now!()
  if (now < approval.acceptsAt) {
    return false
  }
  if (now > approval.expiresAt) {
    close(
      console,
      run,
      'not-allowed',
      undefined,
      'The approval expired; nothing changed.'
    )
    return false
  }
  run.remote!.approval = null
  liveRecord(console).store.update(
    'remote',
    state => state && { ...state, approval: null }
  )
  const cancelTimer = run.cancelTimer
  run.cancelTimer = null
  try {
    cancelTimer?.()
  } catch (error) {
    reportCallbackError(console, error)
  }
  go(console, run)
  return true
}

/** `reject()` (C-99): the run ends `not-allowed`, nothing changed. */
const reject = (console: object, requestId: string): boolean => {
  const run = stateOf(console).run
  if (!run?.current || run.remote?.approval?.requestId !== requestId) {
    return false
  }
  close(
    console,
    run,
    'not-allowed',
    undefined,
    'The user rejected the change in the browser; nothing changed.'
  )
  return true
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
      closed: new Set(),
      remote: null,
      seen: new Set()
    })
    const inAction = <T>(fn: () => T): T => liveRecord(console).store.action(fn)
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
        getCommands: () => lookupOf(console).visible().map(specOf),
        getNamespaces: () =>
          (liveRecord(console).options.namespaces ?? []).map(namespaceSpecOf),
        attachRemote(binding: RemoteBinding) {
          attach(console, binding)
        },
        detachRemote() {
          inAction(() => detach(console))
        },
        suspendRemote() {
          inAction(() =>
            dropApproval(
              console,
              'The tab lost its connection; the approval was dropped and nothing changed.'
            )
          )
        },
        approve: (requestId: string) =>
          inAction(() => approve(console, requestId)),
        reject: (requestId: string) =>
          inAction(() => reject(console, requestId))
      },
      {
        submit: Promise.resolve(false),
        run: Promise.resolve(false),
        request: Promise.resolve(failure('cancelled')),
        isSensitive: false,
        getCommands: [],
        getNamespaces: [],
        approve: false,
        reject: false
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
    // C-97: new commands, new capabilities for the bound CLI.
    onOptionsChange(console, () => {
      const holder = stateOf(console).remote
      if (holder?.alive) {
        reply(
          console,
          holder,
          capabilitiesOf(
            holder.binding.bindingId,
            liveRecord(console).options.commands
          )
        )
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
      if (state.remote) {
        state.remote.alive = false
        state.remote = null
      }
      state.run = null
      state.unsubscribe = null
      if (run) {
        stop(console, run, true, 'cancelled')
      }
      unsubscribe?.()
    })
  }
}
