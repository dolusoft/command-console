import type { OutputBlock } from './block'
import type { ContextFrame } from './context'
import type { OutputEntry } from './entry'
import type { InputSchema } from './input/schema'
import type { JsonValue } from './json'

/**
 * The JSON part of a command: its names and how it is listed and redacted.
 * The core adds the functions (`run`, `complete`) to it.
 */
export interface CommandSpec {
  /** Non-empty, no whitespace, no quote characters; unique with the aliases. */
  name: string
  /** Other names that run the same command; the same rules as `name`. */
  aliases?: string[]
  /** One line on what the command does, for the consumer's help. */
  summary?: string
  /** How the command is called, for the consumer's help. */
  usage?: string
  /** Not listed by `getCommands` and not completed by name. */
  hidden?: boolean
  /**
   * Arguments at and after `fromArg` are secret, so the line is redacted and
   * those positions are never completed. `true` is `{ fromArg: 0 }`.
   */
  sensitive?: boolean | { fromArg: number }
  /**
   * The schema of the command's input (`checkInputSchema`). A command with a
   * schema is called as `name --field value …` (`parseOptions`).
   */
  input?: InputSchema
  /** What running the command does to the application. */
  danger?: Danger
  /**
   * The boolean field of `input` that turns the command's preview into the
   * change (ADR 0014). Only for `danger: 'change'`: a call whose field is not
   * `true` runs as `read` (the preview) for an agent and a CLI; one whose
   * field is `true` is the change.
   */
  confirm?: { field: string }
  /**
   * What a `change` command changes (C-115): `screen` only the user's own tab
   * (a page, a view it opens, a download), `server` a job or a record on the
   * server. Only for `danger: 'change'`; a `change` command without it is
   * `server`. The remote entry runs a `screen` change without asking.
   */
  effect?: Effect
}

/**
 * What running a command does: `read` only reads, `change` changes the
 * application or sends data out, `irreversible` cannot be undone.
 */
export type Danger = 'read' | 'change' | 'irreversible'

/**
 * Where a `change` command makes its change (C-115): `screen` the user's own
 * tab, `server` the server.
 */
export type Effect = 'screen' | 'server'

/** What a command returns, as JSON. */
export interface CommandResponse {
  /** A string is one text block. */
  output?: string | OutputBlock[]
  /** Default `'default'`. */
  tone?: OutputEntry['tone']
  /** Copied to the output entry. */
  quiet?: true
  /** Applied in order, before the output is appended. */
  effects?: ConsoleEffect[]
  /**
   * A short result for the caller of an operation (`CommandOutcome`), such
   * as "342 rows"; at most 200 characters.
   */
  summary?: string
  /**
   * A JSON result for the caller of an operation (`CommandOutcome.data`);
   * never drawn. At most `dataMaxBytes` UTF-8 bytes as JSON.
   */
  data?: JsonValue
}

/**
 * A change a command asks the console to make:
 *
 * - `clear`: empty the entries.
 * - `close`: ask the consumer to close the console.
 * - `push-context`: push a frame on the context stack.
 * - `pop-context`: pop `count` frames (default 1); stops at the root.
 * - `reset-context`: return to the root.
 * - `clear-recall`: empty the recall list.
 */
export type ConsoleEffect =
  | { type: 'clear' }
  | { type: 'close' }
  | { type: 'push-context'; frame: ContextFrame }
  | { type: 'pop-context'; count?: number }
  | { type: 'reset-context' }
  | { type: 'clear-recall' }
