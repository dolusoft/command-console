// The tools an agent in the browser uses (ADR 0012, C-83): plain objects in
// the shape of a WebMCP tool. The consumer registers them; nothing here
// touches the DOM.
import type {
  CommandOutcome,
  CommandSpec,
  JsonValue
} from '@dolusoft/command-protocol'

import type { CoreConsoleAPI } from '../core/console/console.types'
import {
  helpOf,
  helpPageMax,
  helpPageSize,
  namespaceSummaries,
  readHelpInput
} from '../core/dispatch/help'

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
  const help = (input: unknown): JsonValue => {
    const read = readHelpInput(input)
    if (typeof read === 'string') {
      return error('invalid-args', read)
    }
    return helpOf(
      console.getCommands().filter(described),
      namespaceSummaries(console.getNamespaces?.() ?? []),
      read
    )
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
