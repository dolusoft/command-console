// The envelopes of the remote entry (ADR 0014): a command line that comes
// from a desktop CLI through the hub to the one tab it is bound to, and the
// replies the tab sends back. The hub stamps every message from the CLI
// (`origin`, `stampedAt`, `expiresAt`); the tab checks the stamp. JSON only,
// no transport.

import type { Danger } from './command'
import type { EnvelopeErrorCode } from './envelope'
import { envelopeMaxBytes } from './envelope'
import { codePoints, isPlainObject } from './input/validate'
import type { ErrorCode } from './outcome'

/** The version of the remote envelopes a tab understands. */
export const remoteVersion = 1

/** The most parts the `data` of one result travels in. */
export const remoteChunksMax = 3

/** The longest line a `cli-request` may carry, in code points. */
export const remoteLineMax = 4000

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

/** A line to run in the bound tab. */
export interface CliRequest extends RemoteStamp {
  v: 1
  kind: 'cli-request'
  /** The request's id, chosen by the CLI; seen once. */
  id: string
  /** The command line, as the user or the agent wrote it. */
  line: string
  /** The view instance to run in; none means the view active on accept. */
  view?: string
}

/** Cancels the request `id`. */
export interface CliCancel extends RemoteStamp {
  v: 1
  kind: 'cancel'
  id: string
}

/** A message from the CLI. */
export type CliMessage = CliRequest | CliCancel

/** A message read from the transport, or why it was refused. */
export type CliMessageResult =
  { ok: true; message: CliMessage } | { ok: false; code: EnvelopeErrorCode }

/** One command a bound tab runs for a CLI. */
export interface RemoteCommandSpec {
  name: string
  aliases: string[]
  danger: Exclude<Danger, 'irreversible'>
  /** The boolean field that turns a preview into the change (`CommandSpec.confirm`). */
  confirm?: string
}

/** Sent once when a binding is attached: what the tab runs for the CLI. */
export interface CapabilitiesReply {
  v: 1
  kind: 'capabilities'
  bindingId: string
  /** The remote envelope version the tab speaks (`remoteVersion`). */
  envelope: 1
  /** The commands a CLI may send, in registration order. */
  commands: RemoteCommandSpec[]
  /** The names and aliases of sensitive commands: their lines never leave the CLI. */
  sensitive: string[]
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
  | { status: 'error'; code: ErrorCode; message?: string; line?: string }

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
  | CapabilitiesReply
  | ReceivedReply
  | AwaitingApprovalReply
  | ChunkReply
  | FinishedReply
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
 * Reads a message from the CLI as the hub delivered it. A plain object whose
 * `v` is a number other than 1 is `unsupported-version`; one larger than
 * `envelopeMaxBytes` is `too-large`; another `kind`, a missing or mistyped
 * field, an `origin` that is not `{ kind: 'cli', grantId, bindingId }`, times
 * that are not finite numbers at or above 0 or an `expiresAt` not after
 * `stampedAt`, and a `line` longer than `remoteLineMax` code points are
 * `invalid`. A `null` `view` is no view. Unknown fields are left out of the
 * new message; `raw` is never changed.
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
    (kind !== 'cli-request' && kind !== 'cancel') ||
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
  const { line, view } = raw
  if (
    typeof line !== 'string' ||
    codePoints(line) > remoteLineMax ||
    (view !== undefined && view !== null && !isName(view))
  ) {
    return { ok: false, code: 'invalid' }
  }
  return {
    ok: true,
    message:
      typeof view === 'string'
        ? { v: 1, kind, id, line, view, ...stamp }
        : { v: 1, kind, id, line, ...stamp }
  }
}

/**
 * The `id` and the `origin` ids of a `cli-request` that `parseCliMessage`
 * refused, when they can be read: a plain object with that `kind`, a
 * non-empty string `id`, and an `origin` with non-empty string `grantId` and
 * `bindingId`. Anything else gives `undefined`. Nothing else of `raw` is read.
 */
export function refusedCliRequest(
  raw: unknown
): { id: string; grantId: string; bindingId: string } | undefined {
  if (!isPlainObject(raw) || raw.kind !== 'cli-request') {
    return undefined
  }
  const { id, origin } = raw
  if (
    !isName(id) ||
    !isPlainObject(origin) ||
    !isName(origin.grantId) ||
    !isName(origin.bindingId)
  ) {
    return undefined
  }
  return { id, grantId: origin.grantId, bindingId: origin.bindingId }
}

/**
 * The JSON text of `data` cut into at most `remoteChunksMax` chunk replies of
 * request `id`, each within `envelopeMaxBytes`, cut between code points;
 * `undefined` when it does not fit. An empty text gives no chunk.
 */
export function chunkData(id: string, text: string): ChunkReply[] | undefined {
  const points = Array.from(text)
  const parts: string[] = []
  let start = 0
  while (start < points.length) {
    if (parts.length === remoteChunksMax) {
      return undefined
    }
    // The biggest slice whose reply fits, by halving.
    let low = 1
    let high = points.length - start
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (fits(id, points.slice(start, start + middle).join(''))) {
        low = middle
      } else {
        high = middle - 1
      }
    }
    const part = points.slice(start, start + low).join('')
    if (!fits(id, part)) {
      return undefined
    }
    parts.push(part)
    start += low
  }
  return parts.map((data, index) => ({
    v: 1,
    kind: 'chunk',
    id,
    index,
    total: parts.length,
    bytes: utf8(data),
    data
  }))
}

function fits(id: string, data: string): boolean {
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

const replyKinds: readonly unknown[] = [
  'capabilities',
  'received',
  'awaiting-approval',
  'chunk',
  'finished',
  'cancelled-before-start',
  'cancel-requested'
]

/**
 * Whether `raw` has the shape of a reply from the tab (version 1, a known
 * `kind`, its fields typed), for the CLI to read. It checks shape only and
 * within `envelopeMaxBytes`; a value is never changed.
 */
export function isCliReply(raw: unknown): raw is CliReply {
  if (
    !isPlainObject(raw) ||
    raw.v !== 1 ||
    !replyKinds.includes(raw.kind) ||
    sized(raw) !== null
  ) {
    return false
  }
  switch (raw.kind) {
    case 'capabilities':
      return (
        isName(raw.bindingId) &&
        raw.envelope === 1 &&
        Array.isArray(raw.commands) &&
        raw.commands.every(
          (item: unknown) =>
            isPlainObject(item) &&
            isName(item.name) &&
            Array.isArray(item.aliases) &&
            item.aliases.every(isName) &&
            (item.danger === 'read' || item.danger === 'change') &&
            (item.confirm === undefined || isName(item.confirm))
        ) &&
        Array.isArray(raw.sensitive) &&
        raw.sensitive.every(isName)
      )
    case 'received':
      return (
        isName(raw.id) &&
        typeof raw.hidden === 'boolean' &&
        (raw.dataAgeMs === null || isTime(raw.dataAgeMs))
      )
    case 'awaiting-approval':
      return isName(raw.id) && isTime(raw.expiresAt)
    case 'chunk':
      return (
        isName(raw.id) &&
        Number.isInteger(raw.index) &&
        Number.isInteger(raw.total) &&
        Number.isInteger(raw.bytes) &&
        typeof raw.data === 'string'
      )
    case 'finished':
      return (
        isName(raw.id) &&
        isPlainObject(raw.outcome) &&
        (raw.outcome.status === 'ok' || raw.outcome.status === 'error') &&
        Number.isInteger(raw.chunks) &&
        Number.isInteger(raw.bytes)
      )
    default:
      return isName(raw.id)
  }
}
