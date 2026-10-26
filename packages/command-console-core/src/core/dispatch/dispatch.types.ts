import type {
  CommandResponse,
  CommandSpec,
  ContextFrame,
  OutputBlock,
  OutputEntry
} from '@dolusoft/command-protocol'

/**
 * What `beforeRun` returns: `undefined` goes on to the command's `run`;
 * `false` ends the run silently; a response ends the run as if the command
 * had returned it (effects, then output).
 */
export type BeforeRunResult = undefined | false | CommandResponse

/**
 * What the console tells its callbacks about a run. It never carries the line
 * or the arguments, for any command (P16).
 */
export interface RunInfo {
  runId: string
  /** The input entry of the line that started the run. */
  inputId: string
  /** The name as typed; `null` when the line is sensitive. */
  name: string | null
  /** The canonical name of the command. */
  command: string
  /** Whether the line was sensitive. */
  sensitive: boolean
  /** The context frames when the run started, bottom → top. */
  context: ContextFrame[]
}

/** What a command's `run` may return. */
export type CommandReturn = void | string | OutputBlock[] | CommandResponse

/** A command: its JSON spec plus the functions that run and complete it. */
export interface CommandDefinition extends CommandSpec {
  /**
   * Runs the command. A promise makes the run asynchronous; the console
   * stays locked until it settles or the run is cancelled.
   */
  run(
    request: CommandRequest,
    run: RunContext
  ): CommandReturn | Promise<CommandReturn>
  /**
   * The candidates for an argument (completion feature). Synchronous in 1.0.
   * Called only for safe positions (README: Completion).
   */
  complete?(request: CompletionRequest): CompletionResult
}

/** The parsed line a command runs with. */
export interface CommandRequest {
  /** The name as typed (an alias stays an alias). */
  name: string
  /** The canonical name. */
  command: string
  /** The tokens after the name, quotes removed. */
  args: string[]
  /** The raw text after the name and the whitespace that follows it. */
  rest: string
  /** The whole line, trimmed. */
  line: string
  /** The context frames when the run started, bottom → top, root excluded. */
  context: ContextFrame[]
}

/** The handle a running command gets. */
export interface RunContext {
  runId: string
  inputId: string
  /**
   * Aborted on cancel, `reset()`, `dispose()` and a context change made by
   * anything other than the run's own effects.
   */
  signal: AbortSignal
  /**
   * Appends an output entry for this run. Joins an open action, else is its
   * own; does nothing once the run has ended.
   */
  write(output: string | OutputBlock[], tone?: OutputEntry['tone']): void
}

/** What a command's `complete` is asked (completion feature). */
export interface CompletionRequest {
  /** `null` while the command name is completed. */
  command: string | null
  /** The complete arguments before the one completed (safe positions only). */
  args: string[]
  /** The typed part of the token at the caret, quotes removed. */
  prefix: string
  /** The argument index completed, 0-based; -1 for the name. */
  index: number
  context: ContextFrame[]
}

/**
 * The candidates of a `complete` call. The library filters them
 * (case-insensitive `startsWith(prefix)`). `final: false` keeps the space out
 * after a single candidate (default true).
 */
export type CompletionResult =
  string[] | { candidates: string[]; final?: boolean }
