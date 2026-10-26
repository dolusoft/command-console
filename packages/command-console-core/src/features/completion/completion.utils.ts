// Pure helpers of the completion feature (spec §6.5): the token at the caret,
// the filter, the longest common prefix and the quoting of written text.
import { quoteArgument, tokenize, type Token } from '@dolusoft/command-protocol'

import type { Quote, Target } from './completion.types'

/** The opening quote of a token's raw text; `null` for a bare token. */
export const quoteOf = (raw: string): Quote | null => {
  const token = tokenize(raw).tokens[0] as Token | undefined
  if (!token || !(token.quoted || token.open)) {
    return null
  }
  return /['"]/.exec(raw)![0] as Quote
}

/**
 * The token completion works on (spec §6.5 step 1): the tolerant token whose
 * raw span contains the caret (its end included), else an empty token at the
 * caret.
 */
export const targetAt = (line: string, caret: number): Target => {
  const { tokens } = tokenize(line)
  const at = tokens.findIndex(
    token => token.start <= caret && caret <= token.end
  )
  if (at !== -1) {
    const token = tokens[at]
    const raw = line.slice(token.start, token.end)
    return {
      position: at,
      start: token.start,
      end: token.end,
      raw,
      prefix: token.value,
      quote: quoteOf(raw),
      before: tokens.slice(0, at).map(t => t.value)
    }
  }
  const before = tokens.filter(token => token.end <= caret).map(t => t.value)
  return {
    position: before.length,
    start: caret,
    end: caret,
    raw: '',
    prefix: '',
    quote: null,
    before
  }
}

/** Whether only whitespace follows `end` in `line`. */
export const isLast = (line: string, end: number): boolean =>
  line.slice(end).trim() === ''

/**
 * Keeps the candidates whose lowercase starts with the lowercase `prefix`,
 * in their order, without duplicates and without empty strings or
 * non-strings (spec §6.5 step 3). Returns a new array.
 */
export const filterCandidates = (
  candidates: readonly unknown[],
  prefix: string
): string[] => {
  const lower = prefix.toLowerCase()
  const kept = new Set<string>()
  for (const candidate of candidates) {
    if (
      typeof candidate === 'string' &&
      candidate !== '' &&
      candidate.toLowerCase().startsWith(lower)
    ) {
      kept.add(candidate)
    }
  }
  return [...kept]
}

/**
 * The longest prefix every candidate shares, compared case-insensitively,
 * in the case of the first candidate.
 */
export const commonPrefix = (candidates: readonly string[]): string => {
  const [first, ...others] = candidates
  let length = first.length
  for (const other of others) {
    let i = 0
    while (
      i < length &&
      i < other.length &&
      first[i].toLowerCase() === other[i].toLowerCase()
    ) {
      i++
    }
    length = i
  }
  return first.slice(0, length)
}

/**
 * `text` as it is written into a token's span (spec §6.5 step 7). A quoted
 * or open token keeps its quote character, escaped for it (a `'` token whose
 * text holds a `'` switches to `"`, the only quote that can carry it). A bare
 * token opens a quote only when the text needs one: `'`, or `"` when the
 * text holds a `'`. `close` writes the closing quote.
 */
export const encode = (
  text: string,
  quote: Quote | null,
  close: boolean
): string => {
  let q = quote
  if (q === null) {
    if (quoteArgument(text) === text) {
      return text
    }
    q = text.includes("'") ? '"' : "'"
  }
  if (q === "'" && text.includes("'")) {
    q = '"'
  }
  const body = q === '"' ? text.replace(/[\\"]/g, char => `\\${char}`) : text
  return `${q}${body}${close ? q : ''}`
}

/** `line` with `[start, end)` replaced by `text`. */
export const splice = (
  line: string,
  start: number,
  end: number,
  text: string
): string => line.slice(0, start) + text + line.slice(end)
