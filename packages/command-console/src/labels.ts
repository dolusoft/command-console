// Every text the component renders comes from here (P7, C-47): English
// defaults, merged one level deep with the `labels` prop.
import type { MessageBlock, MessageParams } from '@dolusoft/command-protocol'

import type { ConsoleLabels, ConsoleLabelsInput } from './contract'

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
    interrupted: 'Interrupted.'
  }
}

/**
 * The defaults with `labels` over them; `messages` merges one level deep, so
 * overriding one message keeps the others.
 */
export const resolveLabels = (labels?: ConsoleLabelsInput): ConsoleLabels => ({
  ...defaultLabels,
  ...labels,
  messages: { ...defaultLabels.messages, ...labels?.messages }
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
