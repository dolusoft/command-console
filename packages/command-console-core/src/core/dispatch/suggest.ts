// What the remote entry tells the CLI besides an outcome (ADR 0015): the
// command name rule, the names near an unknown one and the positional fix.
// Suggestions only; nothing runs on its own.
import type { InputSchema } from '@dolusoft/command-protocol'

import type { CommandDefinition } from './dispatch.types'

/** A command name as the CLI writes it (C-112). */
const namePattern = /^[A-Za-z][A-Za-z0-9._-]*$/

/** Whether `name` is written plain: a letter, then letters, digits, `.`, `_`, `-`. */
export const isCommandName = (name: string): boolean => namePattern.test(name)

/**
 * The end of the name in a line: ECMAScript `WhiteSpace` and
 * `LineTerminator`, U+FEFF in, U+0085 out. `\s` is that set.
 */
const nameEnd = /\s/

/**
 * A trimmed line split at the end of its first word (C-112): the raw name,
 * quotes and backslashes kept, and the rest of the line.
 */
export const splitName = (line: string): { name: string; rest: string } => {
  const end = line.search(nameEnd)
  return end === -1
    ? { name: line, rest: '' }
    : { name: line.slice(0, end), rest: line.slice(end) }
}

/** `text` with the ASCII capitals lowered, nothing else. */
export const foldAscii = (text: string): string =>
  text.replace(/[A-Z]/g, letter => letter.toLowerCase())

/**
 * The command named `name` or one of its aliases, the ASCII case ignored
 * (C-112); an exact match wins over a folded one.
 */
export const findByName = (
  commands: readonly CommandDefinition[],
  name: string
): CommandDefinition | undefined => {
  const names = (command: CommandDefinition) => [
    command.name,
    ...(command.aliases ?? [])
  ]
  const exact = commands.find(command => names(command).includes(name))
  if (exact) {
    return exact
  }
  const folded = foldAscii(name)
  return commands.find(command =>
    names(command).some(candidate => foldAscii(candidate) === folded)
  )
}

/** Damerau-Levenshtein distance (optimal string alignment), by code point. */
export const distance = (a: string, b: string): number => {
  const s = Array.from(a)
  const t = Array.from(b)
  const d: number[][] = []
  for (let i = 0; i <= s.length; i++) {
    d.push([i])
    for (let j = 1; j <= t.length; j++) {
      d[i].push(i === 0 ? j : 0)
    }
  }
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      )
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[s.length][t.length]
}

/**
 * Up to three names of `candidates` within distance 2 of `name`, the ASCII
 * case ignored, nearest first, a tie by name (C-111). Aliases count; the
 * suggestion is the command's name.
 */
export const nearNames = (
  candidates: readonly CommandDefinition[],
  name: string
): string[] => {
  const folded = foldAscii(name)
  const best = new Map<string, number>()
  for (const command of candidates) {
    for (const candidate of [command.name, ...(command.aliases ?? [])]) {
      const d = distance(folded, foldAscii(candidate))
      if (d <= 2 && d < (best.get(command.name) ?? Infinity)) {
        best.set(command.name, d)
      }
    }
  }
  return [...best.entries()]
    .sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .slice(0, 3)
    .map(([near]) => near)
}

/**
 * The `unknown-command` message (C-111): the name only when it is written
 * plain (free text is never echoed, P16), then the near names.
 */
export const unknownCommandMessage = (name: string, near: string[]): string => {
  const head = isCommandName(name)
    ? `unknown command: ${name}`
    : 'unknown command'
  return near.length > 0 ? `${head}; did you mean: ${near.join(', ')}` : head
}

/**
 * `nav.find data view` → `['nav.find', '--text', 'data view']` (C-111): when
 * no argument starts with `-`, there is at least one, and the command's only
 * required field is a string, the arguments joined by one space are that
 * field's value. `undefined` otherwise.
 */
export const positionalFix = (
  name: string,
  args: readonly string[],
  schema: InputSchema
): string[] | undefined => {
  if (args.length === 0 || args.some(arg => arg.startsWith('-'))) {
    return undefined
  }
  const required = schema.required ?? []
  if (required.length !== 1) {
    return undefined
  }
  const [field] = required
  if (schema.properties?.[field]?.type !== 'string') {
    return undefined
  }
  return [name, `--${field}`, args.join(' ')]
}
