// The answer to a CLI's `help-request` (ADR 0016, C-113): the agent's `help`
// over the commands open to the CLI, as JSON or as lines, with the near
// names of an unknown one. Pure: the caller checks the stamp and sends it.
import {
  envelopeMaxBytes,
  errorClassOf,
  remoteBytes,
  type ErrorCode,
  type HelpRequest,
  type HelpResultReply,
  type JsonValue
} from '@dolusoft/command-protocol'

import type { CommandDefinition, NamespaceDefinition } from './dispatch.types'
import { namespaceSpecOf, specOf } from './dispatch.utils'
import {
  helpOf,
  namespaceSummaries,
  readHelpInput,
  underPrefix,
  type HelpQuery
} from './help'
import {
  helpLines,
  helpTextMaxBytes,
  helpWidthDefault,
  linesBytes
} from './helpText'
import { openToCli } from './remote'
import { findByName, nearNames, unknownCommandMessage } from './suggest'

/** A `help-result` that ends request `id` with an error. */
export const helpError = (
  id: string,
  code: ErrorCode,
  message?: string,
  extra: { suggest?: string[]; help?: string } = {}
): HelpResultReply => ({
  v: 1,
  kind: 'help-result',
  id,
  status: 'error',
  code,
  class: errorClassOf(code),
  ...(message !== undefined && { message }),
  ...extra
})

/** What the argv of a `help-request` asks: a target and the page. */
interface HelpArgs {
  target?: string
  cursor?: string
  limit?: string
}

/**
 * The argv after `help` (C-113): the first item that is not an option is the
 * target; `--cursor <n>` and `--limit <n>` (or `--cursor=<n>`) page. Any
 * other option, a second target or an option without its value is refused
 * with a message that echoes nothing of the argv (P16).
 */
const readArgs = (argv: readonly string[]): HelpArgs | string => {
  const read: HelpArgs = {}
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index]
    if (!item.startsWith('-')) {
      if (read.target !== undefined) {
        return 'help takes one command or namespace name.'
      }
      read.target = item
      continue
    }
    const option = /^--(cursor|limit)(?:=(.*))?$/su.exec(item)
    if (!option) {
      return 'help takes a command or namespace name, --cursor and --limit; no other option.'
    }
    const [, key, inline] = option
    const value = inline ?? argv[++index]
    if (value === undefined) {
      return `--${key} needs a value.`
    }
    if (key === 'cursor') {
      read.cursor = value
    } else {
      read.limit = value
    }
  }
  return read
}

/** The help-request's answer as the CLI asked: JSON or lines. */
const answer = (
  request: HelpRequest,
  result: JsonValue,
  base: HelpQuery,
  page: (limit: number) => JsonValue,
  target: string | undefined,
  limitGiven: boolean
): HelpResultReply => {
  let shown = result
  let lines: string[] | undefined
  if (request.want === 'text') {
    const width = request.width ?? helpWidthDefault
    lines = helpLines(shown, base.prefix, width)
    const listed = (value: JsonValue) =>
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Array.isArray(value.commands)
        ? value.commands.length
        : 0
    // A page whose lines do not fit gets fewer commands and a `next`.
    while (linesBytes(lines) > helpTextMaxBytes && listed(shown) > 1) {
      shown = page(listed(shown) - 1)
      lines = helpLines(shown, base.prefix, width)
    }
    if (linesBytes(lines) > helpTextMaxBytes) {
      const cut = '(cut to fit; --json has the rest)'
      while (
        lines.length > 0 &&
        linesBytes([...lines, cut]) > helpTextMaxBytes
      ) {
        lines.pop()
      }
      lines.push(cut)
    }
  }
  const reply: HelpResultReply = {
    v: 1,
    kind: 'help-result',
    id: request.id,
    status: 'ok',
    ...(lines === undefined ? { result: shown } : { text: lines })
  }
  const cursor =
    typeof shown === 'object' && shown !== null && !Array.isArray(shown)
      ? shown.nextCursor
      : undefined
  if (typeof cursor === 'string' && cursor !== '') {
    reply.next = [
      'help',
      ...(target === undefined ? [] : [target]),
      '--cursor',
      cursor,
      ...(limitGiven ? ['--limit', String(base.limit)] : [])
    ]
  }
  if (remoteBytes(reply) > envelopeMaxBytes) {
    return helpError(
      request.id,
      'too-large',
      'The help does not fit in one reply; ask for one namespace or a smaller --limit.'
    )
  }
  return reply
}

/**
 * The `help-result` of `request` (C-113): `help` of the commands open to the
 * CLI (C-97), with the `cli` filter: neither `hidden`, `sensitive`,
 * `irreversible` nor undescribed. A target that names a command gives its
 * help; one that starts a namespace gives that page; none gives the whole
 * list. An unknown name is `unknown-command` with the nearest name in
 * `suggest`; a sensitive name says nothing more (P16).
 */
export const helpReply = (
  request: HelpRequest,
  commands: readonly CommandDefinition[],
  namespaces: readonly NamespaceDefinition[]
): HelpResultReply => {
  const { id } = request
  const args = readArgs(request.argv)
  if (typeof args === 'string') {
    return helpError(id, 'invalid-args', args)
  }
  const { target } = args
  const named = target === undefined ? undefined : findByName(commands, target)
  if (named?.sensitive !== undefined && named.sensitive !== false) {
    return helpError(id, 'unknown-command')
  }
  const open = commands.filter(openToCli)
  const found = target === undefined ? undefined : findByName(open, target)
  const query = readHelpInput({
    ...(args.cursor !== undefined && { cursor: args.cursor }),
    ...(args.limit !== undefined && {
      limit: /^\d{1,9}$/.test(args.limit) ? Number(args.limit) : Number.NaN
    })
  })
  if (typeof query === 'string') {
    return helpError(
      id,
      'invalid-args',
      query,
      found ? { help: found.name } : {}
    )
  }
  let prefix = ''
  if (found) {
    query.command = found.name
  } else if (target !== undefined) {
    if (!open.some(command => underPrefix(command.name, target))) {
      const near = nearNames(open, target)
      return helpError(
        id,
        'unknown-command',
        unknownCommandMessage(target, near),
        near.length > 0 ? { suggest: [near[0]] } : {}
      )
    }
    prefix = target
  }
  query.prefix = prefix
  const specs = open.map(specOf)
  const summaries = namespaceSummaries(namespaces.map(namespaceSpecOf))
  const page = (limit: number) => helpOf(specs, summaries, { ...query, limit })
  return answer(
    request,
    page(query.limit),
    query,
    page,
    target,
    args.limit !== undefined
  )
}
