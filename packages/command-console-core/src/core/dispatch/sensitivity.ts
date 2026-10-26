// Sensitivity (README: Sensitive lines, ADR 0006). Computed once when a line
// ends, from the tolerant tokens, before anything else sees the line.
import { tokenize } from '@dolusoft/command-protocol'

import type { CommandDefinition } from './dispatch.types'

/**
 * The first secret argument position of `command`: `0` for
 * `sensitive: true`, `fromArg` for `{ fromArg }`, `null` when not sensitive.
 */
export const sensitiveFrom = (command: CommandDefinition): number | null => {
  const { sensitive } = command
  if (sensitive === true) {
    return 0
  }
  return typeof sensitive === 'object' ? sensitive.fromArg : null
}

/**
 * The names and aliases of the sensitive commands, lowercased: the first
 * token is compared case-insensitively, so `Set Password x` is redacted and
 * then reported as unknown (S-04).
 */
export const sensitiveNames = (
  commands: readonly CommandDefinition[]
): ReadonlySet<string> =>
  new Set(
    commands
      .filter(command => sensitiveFrom(command) !== null)
      .flatMap(command => [command.name, ...(command.aliases ?? [])])
      .map(name => name.toLowerCase())
  )

/** Whether the predicate marks `line`; a throwing predicate marks it. */
export const matchesPredicate = (
  predicate: ((line: string) => boolean) | undefined,
  line: string
): boolean => {
  if (!predicate) {
    return false
  }
  try {
    return predicate(line) === true
  } catch {
    return true
  }
}

/**
 * Whether `line` is sensitive: its first token (quotes removed) names a
 * sensitive command or alias, compared case-insensitively, or the predicate
 * marks it (README: Sensitive lines).
 */
export const isLineSensitive = (
  line: string,
  names: ReadonlySet<string>,
  predicate: ((line: string) => boolean) | undefined
): boolean => {
  const first = tokenize(line).tokens[0]
  if (first && names.has(first.value.toLowerCase())) {
    return true
  }
  return matchesPredicate(predicate, line)
}
