import type { OutputBlock } from './block'

/** One entry of the scrollback: a line the user ended, or output. */
export type ConsoleEntry = InputEntry | OutputEntry

/** A line the user ended, with the prompt it was ended with. */
export interface InputEntry {
  id: string
  kind: 'input'
  /** The prompt when the line ended. */
  prompt: string
  /** The trimmed line; `null` when the line was sensitive. */
  text: string | null
  /** True when the line was sensitive and its text is not kept. */
  redacted: boolean
  /** `cancelled` when the line was ended with Ctrl+C. */
  status: 'submitted' | 'cancelled'
}

/** What a command or the library wrote. */
export interface OutputEntry {
  id: string
  kind: 'output'
  tone: 'default' | 'error' | 'notice'
  blocks: OutputBlock[]
  /** The input entry this output answers. */
  inputId?: string
  /** Not announced by the live region (long output such as a whole config). */
  quiet?: true
}
