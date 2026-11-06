// The tools an agent in the browser uses (ADR 0012, C-83): plain objects in
// the shape of a WebMCP tool. The consumer registers them; nothing here
// touches the DOM.
import type {
  CommandOutcome,
  CommandSpec,
  JsonValue
} from '@dolusoft/command-protocol'

import type { CoreConsoleAPI } from '../core/console/console.types'

/** The hints a tool carries (WebMCP `ToolAnnotations`). */
export interface AgentToolAnnotations {
  /** The tool does not change the application. */
  readOnlyHint?: boolean
  /** The result may hold text the agent should not take as instructions. */
  untrustedContentHint?: boolean
}

/** One tool, as a WebMCP `ModelContextTool` takes it. */
export interface AgentTool {
  /** `context`, `help` or `run`. */
  name: string
  /** What the tool does, for the agent. */
  description: string
  /** A JSON Schema of the tool's input. */
  inputSchema: { [key: string]: JsonValue }
  /** The tool's hints. */
  annotations: AgentToolAnnotations
  /** Never rejects: a failure is an `error` outcome. */
  execute(input: unknown): Promise<JsonValue>
}

/** What `agentTools` needs besides the console. */
export interface AgentToolsOptions {
  /** What the `context` tool returns: the tab, its views, the active view. */
  context: () => JsonValue | Promise<JsonValue>
}

/** How many commands one `help` page lists when no `limit` is given (C-92). */
const helpPageSize = 30

/** The most commands one `help` page lists (C-92). */
const helpPageMax = 100

/** The most UTF-8 bytes of one `help` page as JSON (C-92). */
const helpPageMaxBytes = 8192

/** The longest summary a `help` page lists, in code points. */
const summaryLimit = 200

/** The longest namespace summary a `help` page lists, in code points (C-94). */
const namespaceSummaryLimit = 160

const cut = (text: string, limit: number): string =>
  Array.from(text).slice(0, limit).join('')

/**
 * A command an agent can see: one with `input` and `danger` whose definition
 * is not `sensitive` (what `request` could run, C-82).
 */
const described = (spec: CommandSpec): boolean =>
  spec.input !== undefined &&
  spec.danger !== undefined &&
  (spec.sensitive === undefined || spec.sensitive === false)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** `value` without its `undefined` fields, as JSON. */
const json = (value: Record<string, unknown>): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue

const error = (
  code: 'invalid-args' | 'unknown-command',
  message?: string
): CommandOutcome =>
  message === undefined
    ? { status: 'error', code }
    : { status: 'error', code, message }

const failed: CommandOutcome = { status: 'error', code: 'failed' }

/**
 * A `run` of `help` or `context` that the console refuses points at the tool
 * of that name: the console's own `help` is not open to agents, and its
 * "only the user can run it" sent the agent away from a tool it has (C-83).
 */
const toolOwn = (
  name: string | undefined,
  outcome: CommandOutcome
): CommandOutcome =>
  (name === 'help' || name === 'context') &&
  outcome.status === 'error' &&
  (outcome.code === 'not-allowed' || outcome.code === 'unknown-command')
    ? {
        status: 'error',
        code: outcome.code,
        message: `${name} is a tool of its own, not a command for run: call the ${name} tool.`
      }
    : outcome

const bytes = (value: JsonValue): number =>
  new TextEncoder().encode(JSON.stringify(value)).length

/** A command's namespace: its name up to the first dot (C-92). */
const namespaceOf = (name: string): string => name.split('.', 1)[0]

/**
 * Whether `name` is under `prefix`. One trailing dot is dropped; what is left
 * is the name itself or the part before one of its dots, so `dataview` and
 * `dataview.` take `dataview.search` and neither takes `dataviews.x`.
 */
const underPrefix = (name: string, prefix: string): boolean => {
  const base = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix
  return base === '' || name === base || name.startsWith(`${base}.`)
}

interface HelpInput {
  command?: string
  prefix: string
  offset: number
  limit: number
}

/** The fields `help` takes; a message when one is refused. */
const readHelpInput = (input: unknown): HelpInput | string => {
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

/**
 * The `context`, `help` and `run` tools of `console` (C-83). `run` calls
 * `console.request` as `external-agent`, so only `read` commands run. A
 * console without `getNamespaces` lists namespaces without summaries.
 */
export function agentTools(
  console: Pick<CoreConsoleAPI, 'getCommands' | 'request'> &
    Partial<Pick<CoreConsoleAPI, 'getNamespaces'>>,
  options: AgentToolsOptions
): [AgentTool, AgentTool, AgentTool] {
  const commands = () => console.getCommands().filter(described)
  /** The summary of each namespace that has one, cut (C-94). */
  const namespaceSummaries = (): Map<string, string> => {
    const summaries = new Map<string, string>()
    for (const { name, summary } of console.getNamespaces?.() ?? []) {
      if (typeof summary === 'string' && summary !== '') {
        summaries.set(name, cut(summary, namespaceSummaryLimit))
      }
    }
    return summaries
  }
  const describe = (all: CommandSpec[], name: string): JsonValue => {
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
  const list = (all: CommandSpec[], read: HelpInput): JsonValue => {
    const counts = new Map<string, number>()
    for (const spec of all) {
      const name = namespaceOf(spec.name)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const summaries = namespaceSummaries()
    const namespaces: { name: string; count: number; summary?: string }[] = [
      ...counts
    ].map(([name, count]) => {
      const summary = summaries.get(name)
      return summary === undefined ? { name, count } : { name, count, summary }
    })
    const matching = all.filter(spec => underPrefix(spec.name, read.prefix))
    const page = matching
      .slice(read.offset, read.offset + read.limit)
      .map(spec =>
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
  const help = (input: unknown): JsonValue => {
    const read = readHelpInput(input)
    if (typeof read === 'string') {
      return error('invalid-args', read)
    }
    return read.command === undefined
      ? list(commands(), read)
      : describe(commands(), read.command)
  }
  return [
    {
      name: 'context',
      description:
        'The open tab, its views and the active view. Call it before run to pick a view; call help for the commands.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async () => {
        try {
          return await options.context()
        } catch {
          return failed
        }
      }
    },
    {
      name: 'help',
      description: `With { command }: its usage and input schema. Otherwise one page of the commands: { namespaces: [{ name, count, summary? }], commands: [{ name, summary, danger }], nextCursor? }; a namespace's summary says what its commands are for, so pick the namespace by it. prefix keeps one namespace (dataview or dataview.), and nextCursor passed back as cursor gives the next page. danger: read you can run; change only the user can run, by typing it in the terminal. A change command with confirm (the name of its boolean field) runs as its preview without that field. Call it before run.`,
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'A command name.' },
          prefix: {
            type: 'string',
            description: 'A namespace: dataview or dataview.'
          },
          cursor: {
            type: 'string',
            description: 'The nextCursor of the previous page.'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: helpPageMax,
            description: `Commands per page, ${helpPageSize} when not given.`
          }
        }
      },
      annotations: { readOnlyHint: true },
      execute: input => Promise.resolve(help(input))
    },
    {
      name: 'run',
      description:
        'Runs a command whose danger is read: { line } as typed (name --field value), or { command, args?, view? } with args matching its input schema (no args is {}; a string where the schema wants an array of strings is a list of that one string). A change command only the user runs, by typing it in the terminal: do not try it, suggest its line to the user. A change command with confirm in help runs first as a preview, without its confirm field; read the preview and suggest the line with the field set to true. Work that cannot be undone never runs as a command; the user does it in the application. Returns { status, summary?, data? } or { status: "error", code, message?, line? }; data is the JSON result, message says what to fix or why it may not run, and line (with not-allowed) is the line to suggest to the user. Call help first.',
      inputSchema: {
        type: 'object',
        properties: {
          line: { type: 'string', description: 'A whole command line.' },
          command: { type: 'string', description: 'A command name.' },
          args: { type: 'object', description: 'The command input.' },
          view: { type: 'string', description: 'A view id from context.' }
        }
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async input => {
        if (isRecord(input) && typeof input.line === 'string') {
          return toolOwn(
            input.line.trim().split(/\s+/)[0],
            await console.request({
              line: input.line,
              actor: 'external-agent'
            })
          )
        }
        if (!isRecord(input) || typeof input.command !== 'string') {
          return error(
            'invalid-args',
            'expected { line } or { command, args?, view? }'
          )
        }
        const { args } = input
        if (args !== undefined && !isRecord(args)) {
          return error('invalid-args', 'args: expected object')
        }
        if (input.view !== undefined && typeof input.view !== 'string') {
          return error('invalid-args', 'view: expected string')
        }
        return toolOwn(
          input.command,
          await console.request({
            command: input.command,
            args: args ?? {},
            ...(input.view === undefined ? {} : { view: input.view }),
            actor: 'external-agent'
          })
        )
      }
    }
  ]
}
