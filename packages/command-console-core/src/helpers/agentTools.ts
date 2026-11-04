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

const error = (code: 'invalid-args' | 'unknown-command'): CommandOutcome => ({
  status: 'error',
  code
})

const failed: CommandOutcome = { status: 'error', code: 'failed' }

/**
 * The `context`, `help` and `run` tools of `console` (C-83). `run` calls
 * `console.request` as `external-agent`, so only `read` commands run.
 */
export function agentTools(
  console: Pick<CoreConsoleAPI, 'getCommands' | 'request'>,
  options: AgentToolsOptions
): [AgentTool, AgentTool, AgentTool] {
  const commands = () => console.getCommands().filter(described)
  const help = (input: unknown): JsonValue => {
    const name = isRecord(input) ? input.command : undefined
    if (name === undefined) {
      return commands().map(spec =>
        json({ name: spec.name, summary: spec.summary, danger: spec.danger })
      )
    }
    const found = commands().find(
      spec => spec.name === name || spec.aliases?.includes(name as string)
    )
    if (!found) {
      return error('unknown-command')
    }
    return json({
      name: found.name,
      summary: found.summary,
      usage: found.usage,
      danger: found.danger,
      input: found.input
    })
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
      description:
        'Without input: the commands you can run (name, summary, danger). With a command name: its usage and input schema. Call it before run.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'A command name.' }
        }
      },
      annotations: { readOnlyHint: true },
      execute: input => Promise.resolve(help(input))
    },
    {
      name: 'run',
      description:
        'Runs a command: { line } as typed (name --field value), or { command, args, view? } with args matching its input schema. Returns { status, summary?, data? } or { status: "error", code }; data is the JSON result. Call help first.',
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
          return console.request({
            line: input.line,
            actor: 'external-agent'
          })
        }
        if (
          isRecord(input) &&
          typeof input.command === 'string' &&
          isRecord(input.args) &&
          (input.view === undefined || typeof input.view === 'string')
        ) {
          return console.request({
            command: input.command,
            args: input.args,
            ...(input.view === undefined ? {} : { view: input.view }),
            actor: 'external-agent'
          })
        }
        return error('invalid-args')
      }
    }
  ]
}
