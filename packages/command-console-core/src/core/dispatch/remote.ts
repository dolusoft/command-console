// The pure parts of the remote entry (ADR 0014): the stamp check, the
// capabilities and the finished reply with its chunks.
import {
  chunkData,
  type CapabilitiesReply,
  type ChunkReply,
  type CliReply,
  type CliRequest,
  type CommandOutcome,
  type ErrorCode,
  type FinishedReply,
  type RemoteOutcome
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
  request: CliRequest,
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

/** The capabilities reply of a binding (C-97). */
export const capabilitiesOf = (
  bindingId: string,
  commands: readonly CommandDefinition[]
): CapabilitiesReply => ({
  v: 1,
  kind: 'capabilities',
  bindingId,
  envelope: 1,
  commands: commands
    .filter(
      command =>
        command.hidden !== true &&
        describedCommand(command) &&
        command.danger !== 'irreversible'
    )
    .map(command => ({
      name: command.name,
      aliases: [...(command.aliases ?? [])],
      danger: command.danger as 'read' | 'change',
      ...(command.confirm !== undefined && { confirm: command.confirm.field })
    })),
  sensitive: commands
    .filter(
      command => command.sensitive !== undefined && command.sensitive !== false
    )
    .flatMap(command => [command.name, ...(command.aliases ?? [])])
})

/**
 * The replies that end request `id` (C-100): the chunks of `data`, then
 * `finished`. `data` that does not fit in `remoteChunksMax` chunks makes the
 * outcome `too-large`.
 */
export const finishedReplies = (
  id: string,
  outcome: CommandOutcome,
  view: string | undefined,
  binding: RemoteBinding,
  preview: boolean
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
        message: 'The data does not fit in 3 chunks.'
      }
    } else {
      chunks = cut
      result =
        summary === undefined ? { status: 'ok' } : { status: 'ok', summary }
    }
  } else {
    const { code, message, line } = outcome
    result = {
      status: 'error',
      code,
      ...(message !== undefined && { message }),
      ...(line !== undefined && { line })
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
    typeof given.send !== 'function'
  ) {
    throw new TypeError(
      'attachRemote needs { bindingId, grantId, approvedAt, send }: two non-empty strings, a finite time and a function.'
    )
  }
  return given as RemoteBinding
}
