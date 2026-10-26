// The public surface of `<CommandConsole>` and `useCommandConsole`: props,
// events, slots, the exposed API and the types they use (P9, P10). CONTRACT.md
// is generated from this file and the component (`pnpm contract:gen`).
import type { MaybeRef, MaybeRefOrGetter, ShallowRef } from 'vue'

import type {
  BeforeRunResult,
  CommandDefinition,
  Console,
  ConsoleOptions,
  ConsoleState,
  ControllableState,
  OptionalFeatures,
  RunInfo,
  RunningCommand
} from '@dolusoft/command-console-core'
import type {
  CommandResponse,
  ConsoleEntry,
  ContextFrame,
  CustomBlock,
  JsonBlock,
  ListBlock,
  MessageBlock,
  MessageCode,
  MessageParams,
  OutputBlock,
  OutputEntry,
  TableBlock,
  TextBlock
} from '@dolusoft/command-protocol'

export type {
  BeforeRunResult,
  CommandDefinition,
  CommandRequest,
  CommandReturn,
  CompletionRequest,
  CompletionResult,
  CompletionSession,
  Console,
  ConsoleOptions,
  ConsoleState,
  ControllableState,
  InputState,
  KeyInput,
  OptionalFeatures,
  RunContext,
  RunInfo,
  RunningCommand,
  Updater
} from '@dolusoft/command-console-core'
export type {
  CommandResponse,
  CommandSpec,
  ConsoleEffect,
  ConsoleEntry,
  ContextFrame,
  CustomBlock,
  InputEntry,
  JsonBlock,
  JsonPrimitive,
  JsonValue,
  ListBlock,
  MessageBlock,
  MessageCode,
  MessageParams,
  OutputBlock,
  OutputEntry,
  TableBlock,
  TableColumn,
  TextBlock
} from '@dolusoft/command-protocol'

// ---------------------------------------------------------------------------
// Labels (README: Labels, P7)

/** The text of one message code: a string, or a function of its parameters. */
export type MessageLabels = {
  [C in MessageCode]: string | ((params: MessageParams[C]) => string)
}

/** Every text the component renders (C-47). */
export interface ConsoleLabels {
  /** The input's accessible name. Default `'Command'`. */
  input: string
  /**
   * The input's description (`aria-description`): how Enter and Tab behave,
   * and that Tab on an empty line leaves the console (C-59).
   */
  inputDescription: string
  /** The log's accessible name. Default `'Console output'`. */
  log: string
  /** Shown instead of a sensitive line. Default `'(input hidden)'`. */
  redacted: string
  /** Shown after a line ended with Ctrl+C. Default `'^C'`. */
  cancelledMarker: string
  /** The completion list's accessible name. Default `'Suggestions'`. */
  completions: string
  /** The status text while a command runs. Default `'Running…'`. */
  busy: string
  /** The text of each library-made message block. */
  messages: MessageLabels
}

/**
 * The `labels` prop: any part of `ConsoleLabels`. `messages` is merged one
 * level deep, so overriding one message keeps the others.
 */
export type ConsoleLabelsInput = Partial<Omit<ConsoleLabels, 'messages'>> & {
  messages?: Partial<MessageLabels>
}

// ---------------------------------------------------------------------------
// The component

/** The props of `<CommandConsole>`. */
export interface ConsoleProps {
  /** The commands; validated on every change (C-56). */
  commands: CommandDefinition[]
  /** The root prompt. Default `'>'`. */
  prompt?: string
  /** The first value of each uncontrolled slice; read once. */
  initialState?: Partial<ControllableState>
  /** Makes entry and run ids. Default: a per-console counter. */
  createId?: () => string
  /** Drops the oldest entries beyond this. Default unbounded. */
  maxEntries?: number
  /** Called when a command is about to run (permission checks, C-14). */
  beforeRun?: (
    info: RunInfo,
    signal: AbortSignal
  ) => BeforeRunResult | Promise<BeforeRunResult>
  /**
   * A command threw (`info` set) or a callback threw (`info` null). Receives
   * the error exactly as it was thrown.
   */
  onError?: (error: unknown, info: RunInfo | null) => void
  /** Turns a command's error into its output. Default `command-failed`. */
  formatError?: (error: unknown, info: RunInfo) => CommandResponse
  /** Marks more lines sensitive, OR-ed with the commands' `sensitive`. */
  isSensitive?: (line: string) => boolean
  /** The most lines recall keeps. Default 100. */
  recallLimit?: number
  /** Whether a submitted line is recorded for recall. Default every line. */
  shouldRecord?: (line: string) => boolean
  /** Texts over the English defaults (C-47). */
  labels?: ConsoleLabelsInput
  /** Focuses the input on mount (C-51). Default `false`. */
  autofocus?: boolean
  /** The entries, for `v-model:entries`; controlled when bound (C-04). */
  entries?: ConsoleEntry[]
  /** The recall list, for `v-model:recall`; controlled when bound. */
  recall?: string[]
  /** The context frames, for `v-model:context`; controlled when bound. */
  context?: ContextFrame[]
}

/** What the `submit` event carries: never the line (C-64). */
export interface ConsoleSubmit {
  /** The id of the input entry the line ended as. */
  inputId: string
  /** Whether the line was sensitive and its entry redacted. */
  sensitive: boolean
}

/** The events of `<CommandConsole>`. */
export interface ConsoleEmits {
  /**
   * The new entries of a bound `v-model:entries`, resolved against the last
   * emitted value (C-61).
   */
  'update:entries': [entries: ConsoleEntry[]]
  /** The new recall list of a bound `v-model:recall`. */
  'update:recall': [recall: string[]]
  /** The new context frames of a bound `v-model:context`. */
  'update:context': [context: ContextFrame[]]
  /** A command returned the `close` effect (C-25). */
  close: []
  /** A line was submitted with Enter or the exposed `run` (C-64). */
  submit: [submit: ConsoleSubmit]
}

/** What a `block-<type>` slot receives. */
export interface BlockSlotProps<B extends OutputBlock = OutputBlock> {
  block: B
  entry: OutputEntry
}

/** What the `completion` slot receives. */
export interface CompletionSlotProps {
  candidate: string
  index: number
  /** Whether this candidate is the selected one. */
  active: boolean
}

/** The slots of `<CommandConsole>` (C-67). */
export interface ConsoleSlots {
  /** Replaces the rendering of a text block. */
  'block-text'?(props: BlockSlotProps<TextBlock>): unknown
  /** Replaces the rendering of a JSON block (for example to highlight it). */
  'block-json'?(props: BlockSlotProps<JsonBlock>): unknown
  /** Replaces the rendering of a table block. */
  'block-table'?(props: BlockSlotProps<TableBlock>): unknown
  /** Replaces the rendering of a list block. */
  'block-list'?(props: BlockSlotProps<ListBlock>): unknown
  /** Replaces the rendering of a message block. */
  'block-message'?(props: BlockSlotProps<MessageBlock>): unknown
  /** Renders a custom block; without it the block shows as JSON. */
  'block-custom'?(props: BlockSlotProps<CustomBlock>): unknown
  /** Inside each `span.cc-prompt`. */
  prompt?(props: { prompt: string }): unknown
  /** Inside `.cc-status` while a command runs. */
  busy?(props: { running: RunningCommand }): unknown
  /** Inside each `li.cc-completion`. */
  completion?(props: CompletionSlotProps): unknown
}

/** What a template ref to `<CommandConsole>` reaches. */
export interface ConsoleExpose {
  /** Focuses the input. */
  focus(): void
  /**
   * Replaces the input with `line` and submits it, as the user would
   * (C-63); keeps the log at the bottom.
   */
  run(line: string): Promise<boolean>
  /** Interrupts the running command, else cancels the line. */
  cancel(): void
  /** Ends the run and returns every slice to its initial value. */
  reset(): void
  /** Removes every entry. */
  clear(): void
  /** The console, with every optional feature. */
  console: Console<OptionalFeatures>
  /**
   * The console's state (for example `running`, to key an overlay on). A
   * template ref unwraps it: reading it in a computed or a template tracks
   * it.
   */
  state: ConsoleState
}

// ---------------------------------------------------------------------------
// The composable

/** The value options of `useCommandConsole`: a value, a ref or a getter. */
type ValueOptions<T extends Partial<OptionalFeatures>> = {
  [K in 'prompt' | 'state' | 'maxEntries' | 'recallLimit']?: MaybeRefOrGetter<
    ConsoleOptions<T>[K]
  >
}

/** The function options of `useCommandConsole`: a function or a ref to one. */
type FunctionOptions<T extends Partial<OptionalFeatures>> = {
  [
    K in
      | 'onEntriesChange'
      | 'onRecallChange'
      | 'onContextChange'
      | 'createId'
      | 'beforeRun'
      | 'onError'
      | 'formatError'
      | 'onClose'
      | 'isSensitive'
      | 'shouldRecord'
  ]?: MaybeRef<ConsoleOptions<T>[K]>
}

/** The options of `useCommandConsole`: the core options, reactive. */
export type UseCommandConsoleOptions<
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  T extends Partial<OptionalFeatures> = {}
> = ValueOptions<T> &
  FunctionOptions<T> & {
    /** The optional features; fixed for the life of the console. */
    features?: T
    commands: MaybeRefOrGetter<CommandDefinition[]>
    /** Read once, when the console is created. */
    initialState?: MaybeRefOrGetter<Partial<ControllableState> | undefined>
  }

/** What `useCommandConsole` returns. */
export interface UseCommandConsoleReturn<
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  T extends Partial<OptionalFeatures> = {}
> {
  /** The console; disposed with the effect scope. */
  console: Console<T>
  /** The state after every action (C-68). */
  state: Readonly<ShallowRef<ConsoleState>>
}
