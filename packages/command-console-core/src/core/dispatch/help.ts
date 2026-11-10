// The help of the commands, as the agent's `help` tool and the CLI's
// `help-request` give it (C-92, C-94, C-113): one command's usage and schema,
// or one page of the list. JSON only; `helpText.ts` turns it into lines.
import type {
  CommandOutcome,
  CommandSpec,
  JsonValue
} from '@dolusoft/command-protocol'

/** How many commands one `help` page lists when no `limit` is given (C-92). */
export const helpPageSize = 30

/** The most commands one `help` page lists (C-92). */
export const helpPageMax = 100

/** The most UTF-8 bytes of one `help` page as JSON (C-92). */
const helpPageMaxBytes = 8192

/** The longest summary a `help` page lists, in code points. */
const summaryLimit = 200

/** The longest namespace summary a `help` page lists, in code points (C-94). */
const namespaceSummaryLimit = 160

const cut = (text: string, limit: number): string =>
  Array.from(text).slice(0, limit).join('')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** `value` without its `undefined` fields, as JSON. */
const json = (value: Record<string, unknown>): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue

const bytes = (value: JsonValue): number =>
  new TextEncoder().encode(JSON.stringify(value)).length

const error = (
  code: 'invalid-args' | 'unknown-command',
  message?: string
): CommandOutcome =>
  message === undefined
    ? { status: 'error', code }
    : { status: 'error', code, message }

/** A command's namespace: its name up to the first dot (C-92). */
export const namespaceOf = (name: string): string => name.split('.', 1)[0]

/**
 * Whether `name` is under `prefix`. One trailing dot is dropped; what is left
 * is the name itself or the part before one of its dots, so `dataview` and
 * `dataview.` take `dataview.search` and neither takes `dataviews.x`.
 */
export const underPrefix = (name: string, prefix: string): boolean => {
  const base = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix
  return base === '' || name === base || name.startsWith(`${base}.`)
}

/** The summary of each namespace that has one (C-94). */
export const namespaceSummaries = (
  namespaces: readonly { name: string; summary?: string }[]
): Map<string, string> => {
  const summaries = new Map<string, string>()
  for (const { name, summary } of namespaces) {
    if (typeof summary === 'string' && summary !== '') {
      summaries.set(name, summary)
    }
  }
  return summaries
}

/** What one `help` call asks for. */
export interface HelpQuery {
  command?: string
  prefix: string
  offset: number
  limit: number
}

/** The fields `help` takes; a message when one is refused. */
export const readHelpInput = (input: unknown): HelpQuery | string => {
  if (input !== undefined && input !== null && !isRecord(input)) {
    return 'input: expected object'
  }
  const { command, prefix, cursor, limit } = isRecord(input) ? input : {}
  if (command !== undefined && typeof command !== 'string') {
    return 'command: expected string'
  }
  if (prefix !== undefined && typeof prefix !== 'string') {
    return 'prefix: expected string'
  }
  // The cursor is opaque to the agent; it is the offset of the next page.
  const offset =
    cursor === undefined
      ? 0
      : typeof cursor === 'string' && /^\d{1,9}$/.test(cursor)
        ? Number(cursor)
        : -1
  if (offset < 0) {
    return 'cursor: not a nextCursor that help returned'
  }
  if (
    limit !== undefined &&
    !(typeof limit === 'number' && Number.isInteger(limit) && limit >= 1)
  ) {
    return `limit: expected integer from 1 to ${helpPageMax}`
  }
  return {
    ...(command === undefined ? {} : { command }),
    prefix: prefix ?? '',
    offset,
    limit: Math.min(limit ?? helpPageSize, helpPageMax)
  }
}

/** One command's help: its usage, danger, confirm field and schema. */
const describe = (all: readonly CommandSpec[], name: string): JsonValue => {
  const found = all.find(
    spec => spec.name === name || spec.aliases?.includes(name)
  )
  if (!found) {
    return error('unknown-command')
  }
  return json({
    name: found.name,
    summary: found.summary,
    usage: found.usage,
    danger: found.danger,
    ...(found.confirm !== undefined && { confirm: found.confirm.field }),
    input: found.input
  })
}

/** One page of the list (C-92). */
const list = (
  all: readonly CommandSpec[],
  summaries: ReadonlyMap<string, string>,
  read: HelpQuery
): JsonValue => {
  const counts = new Map<string, number>()
  for (const spec of all) {
    const name = namespaceOf(spec.name)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const namespaces: { name: string; count: number; summary?: string }[] = [
    ...counts
  ].map(([name, count]) => {
    const summary = summaries.get(name)
    return summary === undefined
      ? { name, count }
      : { name, count, summary: cut(summary, namespaceSummaryLimit) }
  })
  const matching = all.filter(spec => underPrefix(spec.name, read.prefix))
  const page = matching.slice(read.offset, read.offset + read.limit).map(spec =>
    json({
      name: spec.name,
      summary:
        spec.summary === undefined
          ? undefined
          : cut(spec.summary, summaryLimit),
      danger: spec.danger
    })
  )
  const result = (count: number): JsonValue => {
    const next = read.offset + count
    return next < matching.length
      ? { namespaces, commands: page.slice(0, count), nextCursor: `${next}` }
      : { namespaces, commands: page.slice(0, count) }
  }
  // Commands leave the end of the page until it fits its bytes; then the
  // namespace summaries, from the last (C-94).
  let count = page.length
  while (count > 1 && bytes(result(count)) > helpPageMaxBytes) {
    count--
  }
  for (
    let index = namespaces.length - 1;
    index >= 0 && bytes(result(count)) > helpPageMaxBytes;
    index--
  ) {
    const { name, count: commandCount } = namespaces[index]
    namespaces[index] = { name, count: commandCount }
  }
  return result(count)
}

/**
 * The `help` result for `query` over `specs` (C-92, C-94): one command when
 * `query.command` is given, else one page of the list. `summaries` maps a
 * namespace to its summary.
 */
export const helpOf = (
  specs: readonly CommandSpec[],
  summaries: ReadonlyMap<string, string>,
  query: HelpQuery
): JsonValue =>
  query.command === undefined
    ? list(specs, summaries, query)
    : describe(specs, query.command)
