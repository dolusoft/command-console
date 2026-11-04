// Every text the component renders comes from here (P7, C-47): English
// defaults, merged one level deep with the `labels` prop.
import type {
  ErrorCode,
  MessageBlock,
  MessageParams
} from '@dolusoft/command-protocol'

import type { ConsoleLabels, ConsoleLabelsInput } from './contract'

/** The default text of each `operation-failed` code. */
const operationTexts: Record<ErrorCode, string> = {
  'invalid-args': 'Invalid options.',
  'unknown-command': 'Unknown command.',
  'not-allowed': 'Not allowed from here.',
  'target-not-found': 'The target no longer exists.',
  'id-conflict': 'The operation was changed on the way; it did not run.',
  'unsupported-version': 'Unsupported version.',
  'too-large': 'The command is too large to send.',
  busy: 'Busy.',
  timeout: 'The transport did not answer; the command did not run.',
  failed: 'The command failed.',
  'connection-lost': 'No connection; the command did not run.',
  cancelled: 'Cancelled.'
}

/** The English defaults (README: Labels). */
const defaultLabels: ConsoleLabels = {
  input: 'Command',
  inputDescription:
    'Enter runs the command. Tab completes; on an empty line it leaves the console.',
  log: 'Console output',
  redacted: '(input hidden)',
  cancelledMarker: '^C',
  completions: 'Suggestions',
  busy: 'Running…',
  messages: {
    'command-not-found': params =>
      params.name === null
        ? 'command not found'
        : `${params.name}: command not found`,
    'command-failed': 'The command failed.',
    'unterminated-quote': 'Unterminated quote.',
    interrupted: 'Interrupted.',
    'invalid-args': params =>
      params.path === null || params.path === ''
        ? 'Invalid options.'
        : `Invalid option: ${params.path}.`,
    'operation-failed': params => operationTexts[params.code]
  },
  actors: {
    assistant: 'AI',
    'external-agent': 'Agent'
  }
}

/**
 * The defaults with `labels` over them; `messages` and `actors` merge one
 * level deep, so overriding one message keeps the others.
 */
export const resolveLabels = (labels?: ConsoleLabelsInput): ConsoleLabels => ({
  ...defaultLabels,
  ...labels,
  messages: { ...defaultLabels.messages, ...labels?.messages },
  actors: { ...defaultLabels.actors, ...labels?.actors }
})

/** The text of a message block, from `labels.messages`. */
export const messageText = (
  labels: ConsoleLabels,
  block: MessageBlock
): string => {
  const label = labels.messages[block.code] as
    string | ((params: MessageParams[typeof block.code]) => string)
  if (typeof label === 'string') {
    return label
  }
  // A library-made block of a code with parameters always carries them;
  // `{}` keeps a consumer-made block without them from throwing.
  return label((block.params ?? {}) as never)
}
