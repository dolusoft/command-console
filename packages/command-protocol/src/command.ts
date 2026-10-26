import type { OutputBlock } from './block'
import type { ContextFrame } from './context'
import type { OutputEntry } from './entry'

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
}

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
