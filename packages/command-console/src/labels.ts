// Every text the component renders comes from here (P7, C-47): English
// defaults, merged one level deep with the `labels` prop.
import type {
  ErrorCode,
  InputErrorCode,
  MessageBlock,
  MessageParams
} from '@dolusoft/command-protocol'

import type { ConsoleLabels, ConsoleLabelsInput } from './contract'

/**
 * The default text of each `operation-failed` code: one short sentence each,
 * saying whether the command ran where the user cannot tell.
 */
const operationTexts: Record<ErrorCode, string> = {
  'invalid-args': 'Invalid options.',
  'unknown-command': 'Unknown command.',
  'not-allowed': 'This command is not allowed here.',
  'target-not-found': 'The target no longer exists.',
  'id-conflict': 'The command came back changed; it did not run.',
  'unsupported-version': 'Unsupported protocol version.',
  'too-large': 'The command is too large to send.',
  busy: 'Another command is running.',
  timeout: 'No answer in time; the command did not run.',
  failed: 'The command failed.',
  'connection-lost': 'No connection; the command did not run.',
  cancelled: 'The command was cancelled.'
}

/** What is wrong with an option, after `Invalid option <path>: `. */
const reasonTexts: Record<InputErrorCode, string> = {
  type: 'wrong type',
  required: 'missing',
  enum: 'not one of the allowed values',
  minimum: 'too small',
  maximum: 'too large',
  minLength: 'too short',
  maxLength: 'too long',
  pattern: 'wrong format',
  maxItems: 'too many values',
  additional: 'unknown',
  limit: 'too long or too deeply nested'
}

/** The default `invalid-args` text; a sensitive line names no option. */
const invalidArgsText = ({
  path,
  reason
}: MessageParams['invalid-args']): string => {
  if (path === null || path === '') {
    return 'Invalid options.'
  }
  if (reason === 'required') {
    return `Missing option: ${path}.`
  }
  if (reason === 'additional') {
    return `Unknown option: ${path}.`
  }
  return `Invalid option ${path}: ${reasonTexts[reason]}.`
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
    'invalid-args': invalidArgsText,
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
