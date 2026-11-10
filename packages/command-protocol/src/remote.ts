// The envelopes of the remote entry (ADR 0014): a command that comes from a
// desktop CLI through the hub to the one tab it is bound to, and the replies
// the tab sends back. The hub stamps every message from the CLI (`origin`,
// `stampedAt`, `expiresAt`); the tab checks the stamp. The list of what the
// tab runs is not an envelope: the tab publishes it to the hub in parts
// (`capabilitiesParts`). JSON only, no transport. `docs/remote-contract.md`
// is the normative description; `fixtures/remote/` holds its examples.

import type { Danger } from './command'
import type { EnvelopeErrorCode } from './envelope'
import { envelopeMaxBytes } from './envelope'
import { codePoints, isPlainObject } from './input/validate'
import type { ErrorClass, ErrorCode } from './outcome'

/** The version of the remote envelopes a tab understands. */
export const remoteVersion = 1

/** The envelope versions a tab speaks, for `CapabilitiesPayload.envelopes`. */
export const remoteEnvelopes: readonly number[] = [1]

/**
 * The features a tab of this version has, for
 * `CapabilitiesPayload.features` (C-108): `argv` (`cli-request.argv`),
 * `received-v2` (`received.change` and `viewRelevant`), `suggest-argv`
 * (`suggest`, `next` and `help` as argv), `help-v2` (`help-request` and
 * `help-result`), `error-class` (`class` on every error) and
 * `capabilities-v2` (the list published in parts).
 */
export const remoteFeatures: readonly string[] = [
  'argv',
  'received-v2',
  'suggest-argv',
  'help-v2',
  'error-class',
  'capabilities-v2'
]

/** The most parts the `data` of one result, or the capabilities, take. */
export const remoteChunksMax = 3

/**
 * The longest `line` a `cli-request` may carry, in code points; also the
 * longest `argv` item and the most code points of all `argv` items together.
 */
export const remoteLineMax = 4000

/** The most items an `argv` may have. */
export const remoteArgvMaxItems = 256

/** Who sent a message, as the hub stamped it: a CLI grant and its binding. */
export interface RemoteOrigin {
  kind: 'cli'
  /** The CLI grant ("this user's CLI install"). */
  grantId: string
  /** The binding of the grant to one tab page. */
  bindingId: string
}

/** The fields the hub writes on every message from the CLI. */
export interface RemoteStamp {
  origin: RemoteOrigin
  /** When the hub stamped it, in ms since the epoch (the server's clock). */
  stampedAt: number
  /** After this the tab does not run it, in ms since the epoch. */
  expiresAt: number
}

interface CliRequestBase extends RemoteStamp {
  v: 1
  kind: 'cli-request'
  /** The request's id, chosen by the CLI; seen once. */
  id: string
  /** The view instance to run in; none means the view active on accept. */
  view?: string
}

/**
 * A command to run in the bound tab: as `argv` (the command name, then its
 * arguments, as the shell split them) or as one `line`, never both.
 */
export type CliRequest =
  | (CliRequestBase & { argv: string[]; line?: never })
  | (CliRequestBase & { line: string; argv?: never })

/** Cancels the request `id`. */
export interface CliCancel extends RemoteStamp {
  v: 1
  kind: 'cancel'
  id: string
}

/** Asks the tab for help on its commands (`gecko help …`). */
export interface HelpRequest extends RemoteStamp {
  v: 1
  kind: 'help-request'
  id: string
  /** Everything after `help`, as the shell split it; may be empty. */
  argv: string[]
  /** `text`: lines to print; `json`: the agent's `help` result. */
  want: 'text' | 'json'
  /** The terminal's width for `text`, 20 to 400; else 80. */
  width?: number
}

/** A message from the CLI. */
export type CliMessage = CliRequest | CliCancel | HelpRequest

/** A message read from the transport, or why it was refused. */
export type CliMessageResult =
  { ok: true; message: CliMessage } | { ok: false; code: EnvelopeErrorCode }

/** One command a bound tab runs for a CLI. */
export interface RemoteCommandSpec {
  name: string
  aliases: string[]
  danger: Exclude<Danger, 'irreversible'>
}

/**
 * What a bound tab runs for the CLI (C-108). It is not an envelope: the tab
 * publishes its JSON to the hub in parts (`capabilitiesParts`), and the hub
 * hands the parts to the CLI as they are.
 */
export interface CapabilitiesPayload {
  /** The envelope versions the tab speaks (`remoteEnvelopes`). */
  envelopes: number[]
  /** The features the tab has (`remoteFeatures`). */
  features: string[]
  /** The oldest CLI version the tab supports, from the shell; absent when none. */
  minCli?: string
  /** Changes whenever the commands or the sensitive names change. */
  revision: string
  /** The names and aliases of sensitive commands: their lines never leave the CLI. */
  sensitive: string[]
  /** The commands a CLI may send, in registration order. */
  commands: RemoteCommandSpec[]
}

/** The tab accepted the request and is about to run it. */
export interface ReceivedReply {
  v: 1
  kind: 'received'
  id: string
  /** Whether the page was hidden on accept. */
  hidden: boolean
  /** How old the data the command reads is, in ms; `null` when unknown. */
  dataAgeMs: number | null
  /** The request runs the path that changes data (not a preview, not a read). */
  change: boolean
  /** The CLI prints the view the command ran in. */
  viewRelevant: boolean
}

/** The request changes data and waits for the user's approval in the tab. */
export interface AwaitingApprovalReply {
  v: 1
  kind: 'awaiting-approval'
  id: string
  /** After this the plan is dropped, in ms since the epoch (the tab's clock). */
  expiresAt: number
}

/** One part of the JSON text of a result's `data`. */
export interface ChunkReply {
  v: 1
  kind: 'chunk'
  id: string
  /** 0-based. */
  index: number
  total: number
  /** The UTF-8 length of `data`. */
  bytes: number
  /** A slice of the JSON text, cut between code points. */
  data: string
}

/** How a remote request ended: the outcome without `data` (it came in chunks). */
export type RemoteOutcome =
  | { status: 'ok'; summary?: string }
  | { status: 'error'; code: ErrorCode; class: ErrorClass; message?: string }

/** The end of a request. `chunks` parts of `bytes` UTF-8 bytes came before it. */
export interface FinishedReply {
  v: 1
  kind: 'finished'
  id: string
  outcome: RemoteOutcome
  chunks: number
  bytes: number
  /** The view the command ran in. */
  view?: { id: string; title?: string }
  /** The command ran as its preview (its confirm field was not `true`). */
  preview?: true
  /** A command to run instead or next, as argv without the CLI's name. */
  suggest?: string[]
  /** The next page of a paged result, as argv without the CLI's name. */
  next?: string[]
  /** The command whose help the CLI points to, on an error. */
  help?: string
}

/** The answer to a `help-request`. */
export interface HelpResultReply {
  v: 1
  kind: 'help-result'
  id: string
  status: 'ok' | 'error'
  code?: ErrorCode
  class?: ErrorClass
  message?: string
  /** The lines to print, for `want: 'text'`. */
  text?: string[]
  /** The agent's `help` result, for `want: 'json'`. */
  result?: unknown
  suggest?: string[]
  next?: string[]
  help?: string
}

/** The answer to a `cancel`. */
export interface CancelReply {
  v: 1
  /**
   * `cancelled-before-start`: the command did not run. `cancel-requested`: it
   * was running; its local work stopped, backend work it started may go on.
   */
  kind: 'cancelled-before-start' | 'cancel-requested'
  id: string
}

/** A message from the tab to the CLI. */
export type CliReply =
  | ReceivedReply
  | AwaitingApprovalReply
  | ChunkReply
  | FinishedReply
  | HelpResultReply
  | CancelReply

/** The length in bytes of the UTF-8 JSON of a remote envelope. */
export function remoteBytes(value: CliMessage | CliReply): number {
  return utf8(JSON.stringify(value))
}

function utf8(text: string): number {
  return new TextEncoder().encode(text).length
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/** The JSON of `raw` within `envelopeMaxBytes`, or why not. */
function sized(raw: unknown): EnvelopeErrorCode | null {
  let bytes: number
  try {
    bytes = utf8(JSON.stringify(raw))
  } catch {
    return 'invalid'
  }
  return bytes > envelopeMaxBytes ? 'too-large' : null
}

/**
 * Whether `value` is an argv within the limits: at most `remoteArgvMaxItems`
 * strings, each and all together at most `remoteLineMax` code points.
 */
function isArgv(value: unknown): value is string[] {
  if (!isStrings(value) || value.length > remoteArgvMaxItems) {
    return false
  }
  let total = 0
  for (const item of value) {
    const length = codePoints(item)
    total += length
    if (length > remoteLineMax || total > remoteLineMax) {
      return false
    }
  }
  return true
}

/**
 * Reads a message from the CLI as the hub delivered it (C-96, C-106,
 * C-107). A plain object whose `v` is a number other than 1 is
 * `unsupported-version`; one larger than `envelopeMaxBytes` is `too-large`;
 * another `kind`, a missing or mistyped field, an `origin` that is not
 * `{ kind: 'cli', grantId, bindingId }`, times that are not finite numbers at
 * or above 0 or an `expiresAt` not after `stampedAt` are `invalid`. A
 * `cli-request` has exactly one of `argv` (not empty, its first item not
 * empty) and `line` (at most `remoteLineMax` code points). A `help-request`
 * has an `argv`, maybe empty, and `want` `text` or `json`; a `width` that is
 * not an integer from 20 to 400 is dropped. A `null` `view` is no view.
 * Unknown fields are left out of the new message; `raw` is never changed.
 */
export function parseCliMessage(raw: unknown): CliMessageResult {
  if (!isPlainObject(raw) || typeof raw.v !== 'number') {
    return { ok: false, code: 'invalid' }
  }
  if (raw.v !== 1) {
    return { ok: false, code: 'unsupported-version' }
  }
  const size = sized(raw)
  if (size) {
    return { ok: false, code: size }
  }
  const { kind, id, origin, stampedAt, expiresAt } = raw
  if (
    (kind !== 'cli-request' && kind !== 'cancel' && kind !== 'help-request') ||
    !isName(id) ||
    !isPlainObject(origin) ||
    origin.kind !== 'cli' ||
    !isName(origin.grantId) ||
    !isName(origin.bindingId) ||
    !isTime(stampedAt) ||
    !isTime(expiresAt) ||
    expiresAt <= stampedAt
  ) {
    return { ok: false, code: 'invalid' }
  }
  const stamp: RemoteStamp = {
    origin: {
      kind: 'cli',
      grantId: origin.grantId,
      bindingId: origin.bindingId
    },
    stampedAt,
    expiresAt
  }
  if (kind === 'cancel') {
    return { ok: true, message: { v: 1, kind, id, ...stamp } }
  }
  if (kind === 'help-request') {
    const { argv, want, width } = raw
    if (!isArgv(argv) || (want !== 'text' && want !== 'json')) {
      return { ok: false, code: 'invalid' }
    }
    const message: HelpRequest = {
      v: 1,
      kind,
      id,
      argv: [...argv],
      want,
      ...stamp
    }
    if (
      typeof width === 'number' &&
      Number.isInteger(width) &&
      width >= 20 &&
      width <= 400
    ) {
      message.width = width
    }
    return { ok: true, message }
  }
  const { argv, line, view } = raw
  const shown = typeof view === 'string' ? { view } : {}
  if (view !== undefined && view !== null && !isName(view)) {
    return { ok: false, code: 'invalid' }
  }
  if (argv !== undefined && line === undefined) {
    if (!isArgv(argv) || argv.length === 0 || argv[0] === '') {
      return { ok: false, code: 'invalid' }
    }
    return {
      ok: true,
      message: { v: 1, kind, id, argv: [...argv], ...shown, ...stamp }
    }
  }
  if (
    argv !== undefined ||
    typeof line !== 'string' ||
    codePoints(line) > remoteLineMax
  ) {
    return { ok: false, code: 'invalid' }
  }
  return { ok: true, message: { v: 1, kind, id, line, ...shown, ...stamp } }
}

/**
 * The `kind`, the `id` and the `origin` ids of a `cli-request` or a
 * `help-request` that `parseCliMessage` refused, when they can be read: a
 * plain object with one of those kinds, a non-empty string `id`, and an
 * `origin` with non-empty string `grantId` and `bindingId`. Anything else
 * (a `cancel`, an unknown `kind`) gives `undefined`. Nothing else of `raw` is
 * read.
 */
export function refusedCliRequest(raw: unknown):
  | {
      kind: 'cli-request' | 'help-request'
      id: string
      grantId: string
      bindingId: string
    }
  | undefined {
  if (
    !isPlainObject(raw) ||
    (raw.kind !== 'cli-request' && raw.kind !== 'help-request')
  ) {
    return undefined
  }
  const { kind, id, origin } = raw
  if (
    !isName(id) ||
    !isPlainObject(origin) ||
    !isName(origin.grantId) ||
    !isName(origin.bindingId)
  ) {
    return undefined
  }
  return { kind, id, grantId: origin.grantId, bindingId: origin.bindingId }
}

/**
 * `text` cut between code points into at most `remoteChunksMax` slices, each
 * slice passing `fits`; `undefined` when it does not fit. An empty text gives
 * no slice.
 */
function slices(
  text: string,
  fits: (part: string) => boolean
): string[] | undefined {
  const points = Array.from(text)
  const parts: string[] = []
  let start = 0
  while (start < points.length) {
    if (parts.length === remoteChunksMax) {
      return undefined
    }
    // The biggest slice that fits, by halving.
    let low = 1
    let high = points.length - start
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (fits(points.slice(start, start + middle).join(''))) {
        low = middle
      } else {
        high = middle - 1
      }
    }
    const part = points.slice(start, start + low).join('')
    if (!fits(part)) {
      return undefined
    }
    parts.push(part)
    start += low
  }
  return parts
}

/**
 * The JSON text of `data` cut into at most `remoteChunksMax` chunk replies of
 * request `id`, each within `envelopeMaxBytes`, cut between code points;
 * `undefined` when it does not fit. An empty text gives no chunk.
 */
export function chunkData(id: string, text: string): ChunkReply[] | undefined {
  const parts = slices(text, data => {
    // `total` and `index` take one digit each (at most 3 chunks).
    const reply: ChunkReply = {
      v: 1,
      kind: 'chunk',
      id,
      index: 0,
      total: 1,
      bytes: utf8(data),
      data
    }
    return remoteBytes(reply) <= envelopeMaxBytes
  })
  return parts?.map((data, index) => ({
    v: 1,
    kind: 'chunk',
    id,
    index,
    total: parts.length,
    bytes: utf8(data),
    data
  }))
}

/**
 * Joins the chunks of one result, as the CLI gets them: the `data` of a
 * `finished` reply with `chunks` parts of `bytes` bytes, or `undefined` when
 * a part is missing, repeated, of another request, or the bytes do not
 * match. The text it returns is the JSON of the data.
 */
export function joinChunks(
  finished: FinishedReply,
  chunks: readonly ChunkReply[]
): string | undefined {
  const mine = chunks.filter(chunk => chunk.id === finished.id)
  if (mine.length !== finished.chunks) {
    return undefined
  }
  const ordered: string[] = []
  for (let index = 0; index < finished.chunks; index++) {
    const found = mine.filter(chunk => chunk.index === index)
    if (
      found.length !== 1 ||
      found[0].total !== finished.chunks ||
      utf8(found[0].data) !== found[0].bytes
    ) {
      return undefined
    }
    ordered.push(found[0].data)
  }
  const text = ordered.join('')
  return utf8(text) === finished.bytes ? text : undefined
}

/**
 * The JSON text of `payload` cut between code points into one to
 * `remoteChunksMax` parts of at most `envelopeMaxBytes` UTF-8 bytes each, for
 * the hub (C-108). The fields go in the order `envelopes`, `features`,
 * `minCli`, `revision`, `sensitive`, `commands`, so the head is in the first
 * part. Throws a `RangeError` when the text does not fit.
 */
export function capabilitiesParts(payload: CapabilitiesPayload): string[] {
  const { envelopes, features, minCli, revision, sensitive, commands } = payload
  const text = JSON.stringify({
    envelopes,
    features,
    ...(minCli !== undefined && { minCli }),
    revision,
    sensitive,
    commands: commands.map(({ name, aliases, danger }) => ({
      name,
      aliases,
      danger
    }))
  })
  const parts = slices(text, part => utf8(part) <= envelopeMaxBytes)
  if (parts === undefined) {
    throw new RangeError(
      `The capabilities take ${utf8(text)} bytes; at most ${remoteChunksMax} parts of ${envelopeMaxBytes} bytes fit.`
    )
  }
  return parts
}

/**
 * Reads the parts of the capabilities as the CLI gets them from the hub
 * (C-108): joins one to `remoteChunksMax` strings of at most
 * `envelopeMaxBytes` bytes each and reads the JSON object. `undefined` when
 * the parts or a known field are malformed. Unknown fields are left out; an
 * unknown `danger` is read as `change`.
 */
export function readCapabilitiesParts(
  parts: readonly unknown[]
): CapabilitiesPayload | undefined {
  if (
    !Array.isArray(parts) ||
    parts.length === 0 ||
    parts.length > remoteChunksMax ||
    !parts.every(
      part => typeof part === 'string' && utf8(part) <= envelopeMaxBytes
    )
  ) {
    return undefined
  }
  let raw: unknown
  try {
    raw = JSON.parse(parts.join(''))
  } catch {
    return undefined
  }
  if (!isPlainObject(raw)) {
    return undefined
  }
  const { envelopes, features, minCli, revision, sensitive, commands } = raw
  if (
    !Array.isArray(envelopes) ||
    !envelopes.every(item => Number.isInteger(item)) ||
    !isStrings(features) ||
    (minCli !== undefined && typeof minCli !== 'string') ||
    !isName(revision) ||
    !Array.isArray(sensitive) ||
    !sensitive.every(isName) ||
    !Array.isArray(commands) ||
    !commands.every(
      (item: unknown) =>
        isPlainObject(item) &&
        isName(item.name) &&
        Array.isArray(item.aliases) &&
        item.aliases.every(isName) &&
        isName(item.danger)
    )
  ) {
    return undefined
  }
  return {
    envelopes: [...(envelopes as number[])],
    features: [...features],
    ...(minCli !== undefined && { minCli }),
    revision,
    sensitive: [...sensitive],
    commands: (commands as Record<string, unknown>[]).map(item => ({
      name: item.name as string,
      aliases: [...(item.aliases as string[])],
      danger: item.danger === 'read' ? 'read' : 'change'
    }))
  }
}

const replyKinds: readonly unknown[] = [
  'received',
  'awaiting-approval',
  'chunk',
  'finished',
  'help-result',
  'cancelled-before-start',
  'cancel-requested'
]

/** The optional argv fields `suggest` and `next` and the `help` name. */
function hasHints(raw: Record<string, unknown>): boolean {
  return (
    (raw.suggest === undefined || isStrings(raw.suggest)) &&
    (raw.next === undefined || isStrings(raw.next)) &&
    (raw.help === undefined || isName(raw.help))
  )
}

/**
 * Whether `raw` has the shape of a reply from the tab (version 1, a known
 * `kind`, its known fields typed), for the CLI to read (C-96). It checks shape
 * only and within `envelopeMaxBytes`; a value is never changed. An unknown
 * field is ignored; an `outcome.status`, `status` or `class` it does not know
 * is still a string the CLI reads by its default (`docs/remote-contract.md`).
 */
export function isCliReply(raw: unknown): raw is CliReply {
  if (
    !isPlainObject(raw) ||
    raw.v !== 1 ||
    !replyKinds.includes(raw.kind) ||
    sized(raw) !== null ||
    !isName(raw.id)
  ) {
    return false
  }
  switch (raw.kind) {
    case 'received':
      return (
        typeof raw.hidden === 'boolean' &&
        (raw.dataAgeMs === null || isTime(raw.dataAgeMs)) &&
        typeof raw.change === 'boolean' &&
        typeof raw.viewRelevant === 'boolean'
      )
    case 'awaiting-approval':
      return isTime(raw.expiresAt)
    case 'chunk':
      return (
        Number.isInteger(raw.index) &&
        Number.isInteger(raw.total) &&
        Number.isInteger(raw.bytes) &&
        typeof raw.data === 'string'
      )
    case 'finished':
      return (
        isPlainObject(raw.outcome) &&
        isName(raw.outcome.status) &&
        (raw.outcome.class === undefined ||
          typeof raw.outcome.class === 'string') &&
        Number.isInteger(raw.chunks) &&
        Number.isInteger(raw.bytes) &&
        hasHints(raw)
      )
    case 'help-result':
      return (
        isName(raw.status) &&
        (raw.class === undefined || typeof raw.class === 'string') &&
        (raw.text === undefined || isStrings(raw.text)) &&
        !(raw.text !== undefined && raw.result !== undefined) &&
        hasHints(raw)
      )
    default:
      return true
  }
}
