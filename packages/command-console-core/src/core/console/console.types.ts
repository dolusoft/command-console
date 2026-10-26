import type {
  CommandResponse,
  CommandSpec,
  ConsoleEntry,
  ContextFrame
} from '@dolusoft/command-protocol'

import type { KeyInput } from '../../shared/keys'
import type { Updater } from '../../store/action'
import type {
  BeforeRunResult,
  CommandDefinition,
  RunInfo
} from '../dispatch/dispatch.types'

// ---------------------------------------------------------------------------
// State (spec §5.2)

/** The live input line. */
export interface InputState {
  value: string
  /** UTF-16 offset of the caret in `value`. */
  caret: number
  /**
   * Changes when the input element must be replaced: after a sensitive line
   * ends, on `reset()` and on a programmatic clear of a non-empty input.
   */
  revision: number
}

/** The command that runs now. */
export interface RunningCommand {
  runId: string
  /** The canonical name of the command. */
  command: string
  inputId: string
  /** `authorizing` while `beforeRun` has not answered. */
  phase: 'authorizing' | 'running'
}

/** An open completion (completion feature, spec §6.5). */
export interface CompletionSession {
  status: 'open' | 'none'
  /** Filtered, deduplicated, in the provider's order. */
  candidates: string[]
  final: boolean
  /** The selected candidate; -1 when none is. */
  active: number
  /** The token's raw span in `input.value`, updated after each write. */
  span: { start: number; end: number }
  /** The token's raw text before the session. */
  original: string
}

/** Everything the console holds. */
export interface ConsoleState {
  entries: ConsoleEntry[]
  input: InputState
  running: RunningCommand | null
  /** Oldest → newest (recall feature). */
  recall: string[]
  recallCursor: number | null
  recallDraft: string | null
  completion: CompletionSession | null
  /** Bottom → top; the root is implicit (context feature). */
  context: ContextFrame[]
}

/** The slices a consumer may control (spec §3.4). */
export interface ControllableState {
  entries: ConsoleEntry[]
  recall: string[]
  context: ContextFrame[]
}

/** The name of a controllable slice. */
export type ControlledSlice = keyof ControllableState

// ---------------------------------------------------------------------------
// Optional features (spec §3.2, ADR 0002)

/** The recall feature: ArrowUp / ArrowDown browse the submitted lines. */
export interface RecallFeature {
  readonly name: 'recall'
}

/** The completion feature: Tab completes names and arguments. */
export interface CompletionFeature {
  readonly name: 'completion'
}

/** The context feature: a stack of frames that sets the prompt. */
export interface ContextFeature {
  readonly name: 'context'
}

/**
 * The optional features, by the key `options.features` takes. A console has
 * the methods of the features it was created with, in its type and at run
 * time.
 */
export interface OptionalFeatures {
  recallFeature: RecallFeature
  completionFeature: CompletionFeature
  contextFeature: ContextFeature
}

/** The methods of the recall feature. */
export interface RecallAPI {
  /** Shows the previous (older) line; `false` when nothing changed. */
  recallPrevious(): boolean
  /** Shows the next (newer) line or the draft; `false` when nothing changed. */
  recallNext(): boolean
  /** Empties the recall list and ends browsing. */
  clearRecall(): void
}

/** The methods of the completion feature. */
export interface CompletionAPI {
  /** Completes the token at the caret; `false` when nothing was done. */
  complete(): boolean
  /** Completes, or selects the next candidate of an open session. */
  completeNext(): boolean
  /** Selects the previous candidate of an open session. */
  completePrevious(): boolean
  /** Accepts the selected candidate; `false` when none is selected. */
  acceptCompletion(): boolean
  /** Restores the original token and closes the session. */
  closeCompletion(): boolean
}

/** The methods of the context feature. */
export interface ContextAPI {
  pushContext(frame: ContextFrame): void
  /** Pops `count` frames (default 1); stops at the root. */
  popContext(count?: number): void
  resetContext(): void
}

/** The fixed feature → API map the instance type is computed from. */
/**
 * The methods the optional features in `TFeatures` add; `unknown` (nothing)
 * for a console with the core features only.
 */
export type FeatureAPIsOf<TFeatures> = ('recallFeature' extends keyof TFeatures
  ? RecallAPI
  : unknown) &
  ('completionFeature' extends keyof TFeatures ? CompletionAPI : unknown) &
  ('contextFeature' extends keyof TFeatures ? ContextAPI : unknown)

// ---------------------------------------------------------------------------
// Options (spec §5.1)

/** What a console is created with. */
export interface ConsoleOptions<
  // `{}` and not its constraint, so a console created without `features` has
  // no optional method (spec §3.2).
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TFeatures extends Partial<OptionalFeatures> = {}
> {
  /** The optional features; fixed for the life of the console. */
  features?: TFeatures
  commands: CommandDefinition[]
  /** The root prompt; default `'>'`. */
  prompt?: string
  /** The first value of each slice; ignored for a controlled slice. */
  initialState?: Partial<ControllableState>
  /** A slice given here is controlled (spec §3.4). */
  state?: Partial<ControllableState>
  onEntriesChange?: (updater: Updater<ConsoleEntry[]>) => void
  onRecallChange?: (updater: Updater<string[]>) => void
  onContextChange?: (updater: Updater<ContextFrame[]>) => void
  /**
   * Makes the id of an entry or a run. Default: a per-console counter
   * (`c1`, `c2`, …) that skips ids already in `entries`.
   */
  createId?: () => string
  /** Drops the oldest entries beyond this; default unbounded. */
  maxEntries?: number
  /** Called when a command is about to run, with the run's signal. */
  beforeRun?: (
    info: RunInfo,
    signal: AbortSignal
  ) => BeforeRunResult | Promise<BeforeRunResult>
  /**
   * A command threw or rejected (`info` set), or a callback threw (`info`
   * null). Receives the error exactly as it was thrown.
   */
  onError?: (error: unknown, info: RunInfo | null) => void
  /** Turns a command's error into its output; default `command-failed`. */
  formatError?: (error: unknown, info: RunInfo) => CommandResponse
  /** The `close` effect. */
  onClose?: () => void
  /** Marks more lines sensitive; OR-ed with the commands' `sensitive`. */
  isSensitive?: (line: string) => boolean
  /** The most lines recall keeps (recall feature); default 100. */
  recallLimit?: number
  /** Whether a line is recorded (recall feature); default every line. */
  shouldRecord?: (line: string) => boolean
}

// ---------------------------------------------------------------------------
// The instance (spec §5.2)

/** The methods every console has. */
export interface CoreConsoleAPI<
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TFeatures extends Partial<OptionalFeatures> = {}
> {
  /** The committed state; the same object until the next change. */
  getState(): ConsoleState
  /** Calls `listener` once after every action that changed the state. */
  subscribe(listener: (state: ConsoleState) => void): () => void
  /**
   * Replaces the options. The feature set cannot change (a different set
   * throws); the commands are validated again.
   */
  setOptions(updater: Updater<ConsoleOptions<TFeatures>>): void
  /** Ends the run and returns every slice to its initial value. */
  reset(): void
  /** Ends the run, frees the console; every later call does nothing. */
  dispose(): void
  /** Sets the live input (the adapter calls it on every edit). */
  setInput(value: string, caret?: number): void
  /** Appends entries; an id already present throws. */
  appendEntries(entries: ConsoleEntry[]): void
  clearEntries(): void
  /** The prompt of the next input entry. */
  getPrompt(): string
  /** Whether `line` would be redacted (spec §5.3). */
  isSensitive(line: string): boolean
  /** The specs that are not hidden, in registration order. */
  getCommands(): CommandSpec[]
  /**
   * Ends the live input as Enter does. Resolves `true` after the run's end
   * (at once when nothing runs), `false` without doing anything while a
   * run exists.
   */
  submit(): Promise<boolean>
  /** Replaces the live input with `line` and submits it. */
  run(line: string): Promise<boolean>
  /** Interrupts the running command, else cancels the live line. */
  cancel(): void
  /** Applies the key map; `true` when the key was handled. */
  handleKey(input: KeyInput): boolean
}

/** A console with the core features and the optional ones in `TFeatures`. */
export type Console<
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TFeatures extends Partial<OptionalFeatures> = {}
> = CoreConsoleAPI<TFeatures> & FeatureAPIsOf<TFeatures>

// ---------------------------------------------------------------------------
// The internal feature interface (not exported in 1.0, ADR 0002)

/** The name of a feature, in construction order. */
export type FeatureName =
  | 'console'
  | 'entries'
  | 'input'
  | 'dispatch'
  | 'recall'
  | 'completion'
  | 'context'

/** Options as the features read them: any feature set, defaults merged. */
export type AnyConsoleOptions = ConsoleOptions<Partial<OptionalFeatures>>

/**
 * The instance a feature builds on: the console with every method, since a
 * feature runs only when it is present. Methods are assigned with
 * `assignMethods` (shared/).
 */
export type AnyConsole = Console<OptionalFeatures>

/** A feature: a plain object the engine builds the console from. */
export interface ConsoleFeature {
  name: FeatureName
  /** Adjusts the initial state (`initialState` already applied). */
  getInitialState?(state: ConsoleState): ConsoleState
  /** Defaults merged under the consumer's options. */
  getDefaultOptions?(): Partial<AnyConsoleOptions>
  /** Assigns the feature's methods onto the instance. */
  constructConsoleAPIs?(console: AnyConsole): void
  /** Registers the feature's shared/ hooks, effects and key actions. */
  init?(console: AnyConsole): void
}
