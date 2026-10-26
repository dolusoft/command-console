// The line syntax (ADR 0007): shell-like quoting, `\` literal outside double
// quotes, no continuation. The tokenizer never drops a character: every
// non-whitespace character of the line is inside exactly one token's span.

/** One token of a line. */
export interface Token {
  /** The token's text with grouping quotes and escapes removed. */
  value: string
  /** UTF-16 offset of the token's first raw character in the line. */
  start: number
  /** UTF-16 offset after the token's last raw character (exclusive). */
  end: number
  /** True when any part of the token is quoted (`'…'` or `"…"`). */
  quoted: boolean
  /**
   * True when the token ends in a quote that is not closed; it then runs to
   * the end of the line. Only the last token can be open.
   */
  open: boolean
}

/** The error of a line whose quote is not closed. */
export interface TokenizeError {
  code: 'unterminated-quote'
  /** UTF-16 offset of the opening quote that is not closed. */
  index: number
}

/**
 * The tokens of a line. With `ok: false` the tokens are still returned
 * (tolerant): the last one has `open: true`. Dispatch refuses such a line;
 * completion works on its tokens.
 */
export type TokenizeResult =
  | { ok: true; tokens: Token[] }
  | { ok: false; tokens: Token[]; error: TokenizeError }

const whitespace = /\s/

/** Whether `char` separates tokens (`\s`, so tabs and line breaks too). */
export function isSeparator(char: string): boolean {
  return whitespace.test(char)
}

/**
 * Splits a line into tokens. Runs of whitespace separate. `'…'` groups
 * literally. `"…"` groups, and inside it `\"` and `\\` are the only escapes;
 * any other `\` is kept. Outside quotes `\` is an ordinary character. Adjacent
 * parts join one token (`a"b c"d` is `ab cd`); `''` and `""` give an empty
 * token. `start`/`end` cover the raw text of each token, quotes included.
 */
export function tokenize(line: string): TokenizeResult {
  const tokens: Token[] = []
  let error: TokenizeError | null = null
  let i = 0
  const length = line.length

  while (i < length) {
    if (isSeparator(line[i])) {
      i++
      continue
    }
    const start = i
    let value = ''
    let quoted = false
    let open = false

    while (i < length && !isSeparator(line[i])) {
      const char = line[i]
      if (char === "'") {
        quoted = true
        const close = line.indexOf("'", i + 1)
        if (close === -1) {
          value += line.slice(i + 1)
          open = true
          error = { code: 'unterminated-quote', index: i }
          i = length
          break
        }
        value += line.slice(i + 1, close)
        i = close + 1
      } else if (char === '"') {
        quoted = true
        const opening = i
        i++
        let closed = false
        while (i < length) {
          const inner = line[i]
          if (inner === '"') {
            closed = true
            i++
            break
          }
          const next = line.charAt(i + 1)
          if (inner === '\\' && (next === '"' || next === '\\')) {
            value += next
            i += 2
          } else {
            value += inner
            i++
          }
        }
        if (!closed) {
          open = true
          error = { code: 'unterminated-quote', index: opening }
          break
        }
      } else {
        value += char
        i++
      }
    }

    tokens.push({ value, start, end: i, quoted, open })
  }

  return error === null ? { ok: true, tokens } : { ok: false, tokens, error }
}
