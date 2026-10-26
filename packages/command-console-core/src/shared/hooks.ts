// The hooks features talk through (spec §3.5, ADR 0002). An optional feature
// never imports another feature or a core feature folder at run time: what
// one needs from another is registered here by the feature that has it and
// called by the one that needs it. Every function takes the console instance
// and does nothing once it is disposed.
//
// Hooks run inside the action that calls them; a hook that changes state
// does it through the store of the record (`liveRecord(console).store`),
// so its changes join that action.
import type { ConsoleEffect, ContextFrame } from '@dolusoft/command-protocol'

import type { KeyActionName, KeyInput } from './keys'
import { liveRecord, recordOf } from './registry'
import type {
  ControllableState,
  ControlledSlice,
  FeatureName
} from '../core/console/console.types'
import type { CommandDefinition } from '../core/dispatch/dispatch.types'

/**
 * Who wrote the input: a feature, or `null` for `setInput` (the adapter on a
 * user edit or caret move, or the consumer).
 */
export type InputOrigin = FeatureName | null

/** One change of the live input, as `onInputChange` hooks see it. */
export interface InputChange {
  value: string
  caret: number
  previousValue: string
  previousCaret: number
  origin: InputOrigin
}

/** A controlled slice the consumer replaced through `setOptions`. */
export type ControlledChange = {
  [K in ControlledSlice]: {
    slice: K
    previous: ControllableState[K]
    next: ControllableState[K]
  }
}[ControlledSlice]

/** The context stack as dispatch and completion read it. */
export interface ContextProvider {
  /** The frames now, bottom → top (a copy the caller may keep). */
  snapshot(): ContextFrame[]
  /**
   * A number that changes on every context change (by id sequence, spec
   * §3.4). A run keeps the value it started with.
   */
  revision(): number
}

/** The commands as completion (and recall) see them. */
export interface CommandLookup {
  /** The command a name or alias runs, matched exactly (case-sensitive). */
  find(name: string): CommandDefinition | undefined
  /** The commands that are not `hidden`, in registration order. */
  visible(): CommandDefinition[]
  /**
   * The first argument position that is secret: `0` for `sensitive: true`,
   * `fromArg` for `{ fromArg }`, `null` for a command that is not sensitive.
   */
  sensitiveFrom(command: CommandDefinition): number | null
  /**
   * Whether `options.isSensitive` marks `line` (a throwing predicate counts
   * as a match). A match makes every argument position unsafe.
   */
  matchesPredicate(line: string): boolean
  /** Whether `line` is sensitive (spec §5.3). */
  isSensitive(line: string): boolean
}

/** Writes the live input on behalf of a feature (registered by input). */
export type InputWriter = (
  value: string,
  caret: number,
  origin: InputOrigin
) => void

/** An effect handler; runs inside the action of the run's end. */
export type EffectHandler<T extends ConsoleEffect['type']> = (
  effect: Extract<ConsoleEffect, { type: T }>
) => void

/** The hooks of one console. Read through the functions below. */
export interface Hooks {
  lineSubmitted: ((line: string) => void)[]
  lineCleared: (() => void)[]
  inputChanged: ((change: InputChange) => void)[]
  key: ((input: KeyInput) => void)[]
  controlledChanged: ((change: ControlledChange) => void)[]
  contextChanged: (() => void)[]
  reset: (() => void)[]
  disposers: (() => void)[]
  prompt: (() => string | null) | null
  context: ContextProvider | null
  commandLookup: CommandLookup | null
  inputWriter: InputWriter | null
  effects: { [T in ConsoleEffect['type']]?: EffectHandler<T> }
  keyActions: { [N in KeyActionName]?: () => boolean }
}

const call = <A extends unknown[]>(
  list: ((...args: A) => void)[] | undefined,
  ...args: A
) => {
  for (const hook of list ?? []) {
    hook(...args)
  }
}

const provide = <
  K extends 'prompt' | 'context' | 'commandLookup' | 'inputWriter'
>(
  console: object,
  key: K,
  value: NonNullable<Hooks[K]>
) => {
  const hooks = liveRecord(console).hooks
  if (hooks[key] !== null) {
    throw new Error(`The ${key} hook is already provided.`)
  }
  hooks[key] = value
}

// --- Line ends --------------------------------------------------------------

/**
 * Registered by recall: `line` (trimmed) was submitted and is not sensitive.
 * Called by dispatch after the line-end cleanup and before tokenizing, so
 * unknown commands and lines with an unterminated quote are recorded too.
 * Never called for an empty, cancelled or sensitive line (spec §6.1, §6.3).
 */
export const onLineSubmitted = (
  console: object,
  hook: (line: string) => void
): void => {
  liveRecord(console).hooks.lineSubmitted.push(hook)
}

/** Called by dispatch; see `onLineSubmitted`. */
export const lineSubmitted = (console: object, line: string): void =>
  call(recordOf(console)?.hooks.lineSubmitted, line)

/**
 * Registered by recall (drop the cursor and the draft) and completion (drop
 * the session). Called on every end of a line (submit, cancel, `run(line)`)
 * after the input was cleared, and by `reset()`. The input is empty when it
 * runs; a hook must not write it.
 */
export const onLineCleared = (console: object, hook: () => void): void => {
  liveRecord(console).hooks.lineCleared.push(hook)
}

/** Called by dispatch and `reset()`; see `onLineCleared`. */
export const lineCleared = (console: object): void =>
  call(recordOf(console)?.hooks.lineCleared)

// --- The live input ---------------------------------------------------------

/**
 * Registered by recall (an edit ends browsing) and completion (an edit or a
 * caret move the session did not make closes it). Called after every change
 * of the input's value or caret, with the writer's `origin`: `setInput` has
 * origin `null`, `writeInput` the feature that wrote. Not called by the
 * line-end cleanup (that is `onLineCleared`) or by `reset()`.
 */
export const onInputChange = (
  console: object,
  hook: (change: InputChange) => void
): void => {
  liveRecord(console).hooks.inputChanged.push(hook)
}

/** Called by the input feature; see `onInputChange`. */
export const inputChanged = (console: object, change: InputChange): void =>
  call(recordOf(console)?.hooks.inputChanged, change)

/** Registered by the input feature. */
export const provideInputWriter = (console: object, writer: InputWriter) =>
  provide(console, 'inputWriter', writer)

/**
 * Writes the live input for a feature (recall shows a line, completion
 * writes a candidate). The caret is clamped to the value. `onInputChange`
 * hooks see the change with `origin`, so a feature can tell its own writes
 * from the user's. Does nothing while a command runs (the input is
 * read-only).
 */
export const writeInput = (
  console: object,
  value: string,
  caret: number,
  origin: FeatureName
): void => recordOf(console)?.hooks.inputWriter?.(value, caret, origin)

// --- Keys -------------------------------------------------------------------

/**
 * Registered by a feature that must see every key `handleKey` receives
 * before the key map runs (completion: a session with no candidates closes
 * on the next key). Not called for a key with `isComposing`.
 */
export const onKey = (console: object, hook: (input: KeyInput) => void) => {
  liveRecord(console).hooks.key.push(hook)
}

/** Called by `handleKey`; see `onKey`. */
export const keyPressed = (console: object, input: KeyInput): void =>
  call(recordOf(console)?.hooks.key, input)

// --- Controlled slices ------------------------------------------------------

/**
 * Registered by recall (an external `recall` ends browsing) and context (an
 * external `context` with another id sequence is a context change, spec
 * §3.4, §6.7). Called by `setOptions`, inside its action, for each
 * controlled slice whose value the consumer replaced (a different array).
 */
export const onControlledChange = (
  console: object,
  hook: (change: ControlledChange) => void
): void => {
  liveRecord(console).hooks.controlledChanged.push(hook)
}

/** Called by `setOptions`; see `onControlledChange`. */
export const controlledChanged = (
  console: object,
  change: ControlledChange
): void => call(recordOf(console)?.hooks.controlledChanged, change)

// --- Context ----------------------------------------------------------------

/**
 * Registered by context: the prompt of the next input entry, or `null` at
 * the root (dispatch then uses `options.prompt`). Read by dispatch when an
 * input entry is appended and by `getPrompt()`.
 */
export const providePrompt = (
  console: object,
  prompt: () => string | null
): void => provide(console, 'prompt', prompt)

/** The prompt of the context feature; `null` at the root or without it. */
export const promptOf = (console: object): string | null =>
  recordOf(console)?.hooks.prompt?.() ?? null

/**
 * Registered by context: the frames and the revision. Read by dispatch (the
 * snapshot for `CommandRequest` and `RunInfo`, the revision a run starts
 * with) and completion (`CompletionRequest.context`).
 */
export const provideContext = (
  console: object,
  provider: ContextProvider
): void => provide(console, 'context', provider)

/** The context provider; `null` without the context feature. */
export const contextOf = (console: object): ContextProvider | null =>
  recordOf(console)?.hooks.context ?? null

/**
 * Registered by dispatch: the context changed by any means other than a
 * run's own effects (a context method, an external `context`). Called by
 * context inside the action that changed it; dispatch aborts the current
 * run's signal (the run goes on, and its context effects are dropped when it
 * ends, spec §6.7).
 */
export const onContextChange = (console: object, hook: () => void): void => {
  liveRecord(console).hooks.contextChanged.push(hook)
}

/** Called by context; see `onContextChange`. */
export const contextChanged = (console: object): void =>
  call(recordOf(console)?.hooks.contextChanged)

// --- Commands ---------------------------------------------------------------

/** Registered by dispatch. */
export const provideCommandLookup = (
  console: object,
  lookup: CommandLookup
): void => provide(console, 'commandLookup', lookup)

/**
 * The commands of the console (completion: names, `complete`, safe
 * positions; recall: whether the live input is sensitive). Always present
 * while the console lives.
 */
export const lookupOf = (console: object): CommandLookup =>
  liveRecord(console).hooks.commandLookup!
