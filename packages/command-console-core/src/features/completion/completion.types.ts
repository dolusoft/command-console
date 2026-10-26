// Internal types of the completion feature. The session itself is public
// state (`CompletionSession`, console.types.ts).

/** A quote character of the line syntax. */
export type Quote = "'" | '"'

/** The token Tab completes (README: Completion). */
export interface Target {
  /** 0 for the command name, `i + 1` for argument `i`. */
  position: number
  /** The token's raw span in the input. */
  start: number
  end: number
  /** The token's raw text (empty for an empty token at the caret). */
  raw: string
  /** The token's text, quotes removed: what candidates must start with. */
  prefix: string
  /** The token's opening quote, kept for what is written into it. */
  quote: Quote | null
  /** The values of the tokens before it, the name first. */
  before: string[]
}

/** What a completion found: `null` when the position is not safe. */
export interface Found {
  candidates: string[]
  final: boolean
}
