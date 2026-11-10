// The pure parts of the remote entry (ADR 0014, ADR 0015): the stamp check,
// the capabilities and the finished reply with its chunks.
import {
  capabilitiesParts,
  chunkData,
  envelopeMaxBytes,
  errorClassOf,
  remoteBytes,
  remoteEnvelopes,
  remoteFeatures,
  type ChunkReply,
  type CliReply,
  type CommandOutcome,
  type ErrorCode,
  type FinishedReply,
  type RemoteCommandSpec,
  type RemoteOutcome,
  type RemoteStamp
} from '@dolusoft/command-protocol'

import type { CommandDefinition, RemoteBinding } from './dispatch.types'
import { describedCommand } from './operation'

/** The largest clock difference between the tab and the hub (C-98). */
const skewMs = 30_000

/** How long an approval waits for the user (C-99). */
export const approvalMs = 120_000

/** How long after the window opens an approval is refused (C-99). */
export const approvalHoldMs = 1000

/**
 * Why a stamped request may not run now, by the tab's clock (C-98): stamped
 * more than `skewMs` ahead of it is `clock-skew`; after `expiresAt` is
 * `expired`. `null` when it may run.
 */
export const stampRefusal = (
  request: RemoteStamp,
  now: number
): { code: ErrorCode; message: string } | null => {
  if (request.stampedAt - now > skewMs) {
    return {
      code: 'clock-skew',
      message:
        "The tab's clock is more than 30 s behind the server; set the computer's clock. The request did not run."
    }
  }
  if (now > request.expiresAt) {
    return {
      code: 'expired',
      message:
        "The request came after it expired (or the tab's clock is ahead); it did not run and is safe to retry."
    }
  }
  return null
}

/**
 * Whether the CLI may run `command` (C-97): neither `hidden` nor
 * `irreversible`, with `input` and `danger` and without `sensitive`.
 */
export const openToCli = (command: CommandDefinition): boolean =>
  command.hidden !== true &&
  describedCommand(command) &&
  command.danger !== 'irreversible'

/**
 * The 32-bit FNV-1a hash of the UTF-16 units of `text`, as 8 hex digits: the
 * same text gives the same revision, with no clock and no randomness.
 */
const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * What a binding publishes to the hub (C-97, C-108): the commands the CLI
 * may run, the names and aliases of every sensitive command, a `revision`
 * made from those two, and the shell's `minCli`. Throws a `RangeError` when
 * the list does not fit in `remoteChunksMax` parts.
 */
export const capabilitiesOf = (
  commands: readonly CommandDefinition[],
  minCli: string | undefined
): { revision: string; parts: string[] } => {
  const specs: RemoteCommandSpec[] = commands
    .filter(openToCli)
    .map(command => ({
      name: command.name,
      aliases: [...(command.aliases ?? [])],
      danger: command.danger as 'read' | 'change'
    }))
  const sensitive = commands
    .filter(
      command => command.sensitive !== undefined && command.sensitive !== false
    )
    .flatMap(command => [command.name, ...(command.aliases ?? [])])
  const revision = fnv1a(JSON.stringify({ commands: specs, sensitive }))
  const parts = capabilitiesParts({
    envelopes: [...remoteEnvelopes],
    features: [...remoteFeatures],
    ...(minCli !== undefined && { minCli }),
    revision,
    sensitive,
    commands: specs
  })
  return { revision, parts }
}

/** What a `finished` reply suggests besides its outcome (C-111). */
export interface Hints {
  suggest?: string[]
  next?: string[]
  help?: string
}

/**
 * The replies that end request `id` (C-100): the chunks of `data`, then
 * `finished` with the `hints`. `data` that does not fit in `remoteChunksMax`
 * chunks makes the outcome `too-large`.
 */
export const finishedReplies = (
  id: string,
  outcome: CommandOutcome,
  view: string | undefined,
  binding: RemoteBinding,
  preview: boolean,
  hints: Hints = {}
): CliReply[] => {
  let chunks: ChunkReply[] = []
  let result: RemoteOutcome
  if (outcome.status === 'ok') {
    const { data, summary } = outcome
    const cut = data === undefined ? [] : chunkData(id, JSON.stringify(data))
    if (cut === undefined) {
      result = {
        status: 'error',
        code: 'too-large',
        class: errorClassOf('too-large'),
        message: 'The data does not fit in 3 chunks.'
      }
    } else {
      chunks = cut
      result =
        summary === undefined ? { status: 'ok' } : { status: 'ok', summary }
    }
  } else {
    // The local `line` does not go to the CLI (C-108); `suggest` replaces it.
    const { code, message } = outcome
    result = {
      status: 'error',
      code,
      class: errorClassOf(code),
      ...(message !== undefined && { message })
    }
  }
  const finished: FinishedReply = {
    v: 1,
    kind: 'finished',
    id,
    outcome: result,
    chunks: chunks.length,
    bytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0)
  }
  if (view !== undefined) {
    let title: unknown
    try {
      title = binding.viewTitle?.(view)
    } catch {
      title = undefined
    }
    finished.view =
      typeof title === 'string' ? { id: view, title } : { id: view }
  }
  if (preview && result.status === 'ok') {
    finished.preview = true
  }
  const { suggest, next, help } = hints
  if (suggest !== undefined) {
    finished.suggest = suggest
  }
  if (next !== undefined) {
    finished.next = next
  }
  if (help !== undefined) {
    finished.help = help
  }
  // A long input may not fit as argv; the outcome always does.
  if (remoteBytes(finished) > envelopeMaxBytes) {
    delete finished.suggest
    delete finished.next
  }
  return [...chunks, finished]
}

/** Checks a binding before it is attached (C-97). */
export const checkBinding = (binding: unknown): RemoteBinding => {
  const given = binding as Partial<RemoteBinding> | null
  if (
    typeof given !== 'object' ||
    given === null ||
    typeof given.bindingId !== 'string' ||
    given.bindingId === '' ||
    typeof given.grantId !== 'string' ||
    given.grantId === '' ||
    typeof given.approvedAt !== 'number' ||
    !Number.isFinite(given.approvedAt) ||
    typeof given.send !== 'function' ||
    typeof given.publishCapabilities !== 'function' ||
    (given.minCli !== undefined &&
      (typeof given.minCli !== 'string' || given.minCli === ''))
  ) {
    throw new TypeError(
      'attachRemote needs { bindingId, grantId, approvedAt, send, publishCapabilities }: two non-empty strings, a finite time and two functions; minCli, when given, a non-empty string.'
    )
  }
  return given as RemoteBinding
}
