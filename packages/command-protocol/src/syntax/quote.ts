import { isSeparator } from './tokenize'

/**
 * The shortest form of `value` that `tokenize` reads back as one token with
 * that value: bare when it is non-empty and has no whitespace and no quote,
 * else `'…'` when it has no `'`, else `"…"` with `"` written as `\"` and a
 * `\` written as `\\` where it comes before a `"`, a `\` or the closing quote.
 */
export function quoteArgument(value: string): string {
  if (value === '' || needsQuotes(value)) {
    return value.includes("'") ? doubleQuote(value) : `'${value}'`
  }
  return value
}

function needsQuotes(value: string): boolean {
  for (const char of value) {
    if (char === "'" || char === '"' || isSeparator(char)) {
      return true
    }
  }
  return false
}

function doubleQuote(value: string): string {
  let result = '"'
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char === '"') {
      result += '\\"'
    } else if (char === '\\') {
      const next = value.charAt(i + 1)
      result += next === '' || next === '"' || next === '\\' ? '\\\\' : '\\'
    } else {
      result += char
    }
  }
  return `${result}"`
}
