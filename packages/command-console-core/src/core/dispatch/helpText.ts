// The help as lines for the CLI's terminal (C-113): the JSON of `help.ts`
// laid out in plain English, wrapped to a width, with no colour, no escape
// sequence and no CLI name in front of a usage. The CLI prints the lines as
// they are.
import type { JsonValue } from '@dolusoft/command-protocol'

/** The width of the lines when the CLI gives none. */
export const helpWidthDefault = 80

/** The most UTF-8 bytes of the JSON of the lines (C-113). */
export const helpTextMaxBytes = 12_288

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Text with control characters (escape sequences too) made spaces. */
const plain = (text: string): string =>
  // eslint-disable-next-line no-control-regex
  text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')

const width = (text: string): number => Array.from(text).length

/**
 * `text` as lines of at most `max` code points with `indent` in front, split
 * at spaces; a word longer than a line is cut.
 */
const wrap = (text: string, max: number, indent = ''): string[] => {
  const room = Math.max(1, max - width(indent))
  const lines: string[] = []
  let current = ''
  for (let word of plain(text).split(/\s+/).filter(Boolean)) {
    while (width(word) > room) {
      if (current !== '') {
        lines.push(current)
        current = ''
      }
      const points = Array.from(word)
      lines.push(points.slice(0, room).join(''))
      word = points.slice(room).join('')
    }
    if (word === '') {
      continue
    }
    if (current !== '' && width(current) + 1 + width(word) > room) {
      lines.push(current)
      current = word
    } else {
      current = current === '' ? word : `${current} ${word}`
    }
  }
  if (current !== '') {
    lines.push(current)
  }
  return lines.map(line => `${indent}${line}`)
}

const text = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : value === undefined
      ? ''
      : JSON.stringify(value)

/** A field's type as `<string>`, `<a|b>`, `<string>...` for a list. */
const typeOf = (field: Record<string, unknown>): string => {
  const items = isRecord(field.items) ? field.items : undefined
  const list = field.type === 'array'
  const raw = list ? items?.type : field.type
  const type = Array.isArray(raw)
    ? raw.map(text).join('|')
    : typeof raw === 'string'
      ? raw
      : list
        ? 'string'
        : 'any'
  return `<${type}>${list ? '...' : ''}`
}

/** One option per field: `--name <type> · required`, then its description. */
const fieldLines = (schema: unknown, max: number): string[] => {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return ['  (no fields)']
  }
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.map(text) : []
  )
  const lines: string[] = []
  for (const [name, value] of Object.entries(schema.properties)) {
    const field = isRecord(value) ? value : {}
    const parts = [
      `--${name} ${typeOf(field)}`,
      required.has(name) ? 'required' : 'optional'
    ]
    const items = isRecord(field.items) ? field.items : undefined
    const values = Array.isArray(field.enum)
      ? field.enum
      : Array.isArray(items?.enum)
        ? items.enum
        : undefined
    if (values) {
      parts.push(`one of ${values.map(text).join('|')}`)
    }
    for (const key of ['minimum', 'maximum', 'minItems', 'maxItems']) {
      if (field[key] !== undefined) {
        parts.push(`${key} ${text(field[key])}`)
      }
    }
    lines.push(...wrap(parts.join(' · '), max, '  '))
    if (typeof field.description === 'string') {
      lines.push(...wrap(field.description, max, '      '))
    }
  }
  return lines.length > 0 ? lines : ['  (no fields)']
}

/** The usage of a command without one: its name and its required fields. */
const usageOf = (name: string, schema: unknown): string => {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return name
  }
  const { properties } = schema
  const required = Array.isArray(schema.required)
    ? schema.required.map(text)
    : []
  const fields = required.map(field => {
    const value = properties[field]
    return `--${field} ${typeOf(isRecord(value) ? value : {})}`
  })
  const optional = Object.keys(properties).length > required.length
  return [name, ...fields, ...(optional ? ['[options]'] : [])].join(' ')
}

/** One command: summary, usage, the preview note, the fields. */
const commandLines = (help: Record<string, unknown>, max: number): string[] => {
  const name = text(help.name)
  const lines = wrap(`${name} · ${text(help.danger)}`, max)
  if (typeof help.summary === 'string') {
    lines.push(...wrap(help.summary, max))
  }
  const usage =
    typeof help.usage === 'string' && help.usage !== ''
      ? help.usage
      : usageOf(name, help.input)
  lines.push('Usage:', ...wrap(usage, max, '  '))
  if (typeof help.confirm === 'string') {
    lines.push(
      ...wrap(
        `Runs as a preview without --${help.confirm}; with --${help.confirm} it makes the change.`,
        max
      )
    )
  }
  lines.push('Fields:', ...fieldLines(help.input, max))
  return lines
}

/** One page of the list: the namespaces at the top level, then the commands. */
const listLines = (
  help: Record<string, unknown>,
  prefix: string,
  max: number
): string[] => {
  const lines: string[] = []
  const namespaces = Array.isArray(help.namespaces) ? help.namespaces : []
  if (prefix === '' && namespaces.length > 0) {
    lines.push('Namespaces:')
    for (const namespace of namespaces.filter(isRecord)) {
      const count = Number(namespace.count)
      const head = `${text(namespace.name)} (${count} ${count === 1 ? 'command' : 'commands'})`
      lines.push(...wrap(head, max, '  '))
      if (typeof namespace.summary === 'string') {
        lines.push(...wrap(namespace.summary, max, '      '))
      }
    }
  }
  const commands = Array.isArray(help.commands)
    ? help.commands.filter(isRecord)
    : []
  lines.push(
    ...wrap(prefix === '' ? 'Commands:' : `Commands in ${prefix}:`, max)
  )
  if (commands.length === 0) {
    lines.push('  (none)')
  }
  for (const command of commands) {
    lines.push(
      ...wrap(`${text(command.name)} · ${text(command.danger)}`, max, '  ')
    )
    if (typeof command.summary === 'string') {
      lines.push(...wrap(command.summary, max, '      '))
    }
  }
  return lines
}

/**
 * The lines of a `help` result (C-113): one command when it has a `name`,
 * else one page of the list under `prefix` (`''` for all).
 */
export const helpLines = (
  help: JsonValue,
  prefix: string,
  max: number
): string[] => {
  if (!isRecord(help)) {
    return []
  }
  return typeof help.name === 'string'
    ? commandLines(help, max)
    : listLines(help, prefix, max)
}

/** The UTF-8 bytes of the JSON of `lines`. */
export const linesBytes = (lines: readonly string[]): number =>
  new TextEncoder().encode(JSON.stringify(lines)).length
