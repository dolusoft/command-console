import type { JsonPrimitive, JsonValue } from './json'

/** Plain text, rendered preformatted. */
export interface TextBlock {
  type: 'text'
  text: string
}

/** A JSON value, rendered as `JSON.stringify(value, null, 2)`. */
export interface JsonBlock {
  type: 'json'
  value: JsonValue
}

/** One column of a table block: the row key it reads and its header text. */
export interface TableColumn {
  key: string
  label: string
}

/** A table: a header row from `columns`, then one row per `rows` item. */
export interface TableBlock {
  type: 'table'
  columns: TableColumn[]
  rows: Record<string, JsonPrimitive>[]
}

/** A list of text items. */
export interface ListBlock {
  type: 'list'
  items: string[]
}

/**
 * A message the library makes. It carries a code, never text: the Vue package
 * renders it from its labels (P7).
 */
export interface MessageBlock {
  type: 'message'
  code: MessageCode
  params?: Record<string, JsonPrimitive>
}

/** A block the consumer renders itself, told apart by `kind`. */
export interface CustomBlock {
  type: 'custom'
  kind: string
  data?: JsonValue
}

/** One piece of an output entry. Output is never HTML (ADR 0005). */
export type OutputBlock =
  TextBlock | JsonBlock | TableBlock | ListBlock | MessageBlock | CustomBlock

/**
 * The messages the library makes:
 *
 * - `command-not-found`: the first token names no command.
 * - `command-failed`: the command threw or rejected; the error's text is never
 *   shown (S-06).
 * - `unterminated-quote`: the line has a quote that is not closed.
 * - `interrupted`: a running command was cancelled.
 */
export type MessageCode =
  'command-not-found' | 'command-failed' | 'unterminated-quote' | 'interrupted'

/**
 * The parameters of each message code. For a sensitive line `name` and
 * `index` are `null`. A code without parameters has an empty record; its
 * block carries no `params`.
 */
export interface MessageParams {
  'command-not-found': { name: string | null }
  'command-failed': Record<string, never>
  'unterminated-quote': { index: number | null }
  interrupted: Record<string, never>
}
