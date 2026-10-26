import type {
  CommandResponse,
  CommandSpec,
  OutputBlock
} from '@dolusoft/command-protocol'

import type { CommandDefinition, CommandReturn } from './dispatch.types'

const forbidden = /[\s'"]/

const checkName = (name: unknown, where: string) => {
  if (typeof name !== 'string' || name === '' || forbidden.test(name)) {
    throw new Error(
      `${where}: a command name must be a non-empty string without whitespace or quotes (got ${JSON.stringify(name)}).`
    )
  }
}

/**
 * Validates the commands (core README: Options, C-56): names and aliases are
 * non-empty, without whitespace or quotes, unique across every name and alias;
 * `fromArg` is a non-negative integer; `run` is a function. Throws on the
 * first violation.
 */
export const validateCommands = (commands: unknown): void => {
  if (!Array.isArray(commands)) {
    throw new Error('commands must be an array of command definitions.')
  }
  const seen = new Set<string>()
  for (const command of commands as CommandDefinition[]) {
    const names = [command?.name, ...(command?.aliases ?? [])]
    for (const name of names) {
      checkName(name, `command ${JSON.stringify(command?.name)}`)
      if (seen.has(name)) {
        throw new Error(`The command name ${name} is used twice.`)
      }
      seen.add(name)
    }
    const { sensitive } = command
    if (
      sensitive !== undefined &&
      typeof sensitive !== 'boolean' &&
      !(
        typeof sensitive === 'object' &&
        sensitive !== null &&
        Number.isInteger(sensitive.fromArg) &&
        sensitive.fromArg >= 0
      )
    ) {
      throw new Error(
        `command ${command.name}: sensitive must be a boolean or { fromArg } with a non-negative integer.`
      )
    }
    if (typeof command.run !== 'function') {
      throw new Error(`command ${command.name}: run must be a function.`)
    }
  }
}

/** The JSON spec of a command, without its functions (`getCommands`). */
export const specOf = (command: CommandDefinition): CommandSpec => {
  const spec: CommandSpec = {
    name: command.name,
    aliases: [...(command.aliases ?? [])]
  }
  if (command.summary !== undefined) {
    spec.summary = command.summary
  }
  if (command.usage !== undefined) {
    spec.usage = command.usage
  }
  if (command.sensitive !== undefined) {
    spec.sensitive =
      typeof command.sensitive === 'object'
        ? { fromArg: command.sensitive.fromArg }
        : command.sensitive
  }
  return spec
}

/** A command's return as a response (README: Running a line, End action). */
export const normalizeReturn = (value: CommandReturn): CommandResponse => {
  if (typeof value === 'string' || Array.isArray(value)) {
    return { output: value }
  }
  if (typeof value === 'object' && value !== null) {
    return value
  }
  return {}
}

/** The blocks of a response's output; a string is one text block. */
export const blocksOf = (
  output: string | OutputBlock[] | undefined
): OutputBlock[] => {
  if (typeof output === 'string') {
    return [{ type: 'text', text: output }]
  }
  return output ?? []
}

/** Whether `value` is a promise or another thenable. */
export const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  typeof (value as { then?: unknown }).then === 'function'
