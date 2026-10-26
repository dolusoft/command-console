// One entry of the log (README: DOM and styling): an ended input line (its
// prompt, its text or `labels.redacted`, the cancelled marker) or the blocks of
// an output.
import { h, type VNode, type VNodeArrayChildren } from 'vue'

import type { ConsoleEntry } from '@dolusoft/command-protocol'

import { renderBlock, type BlockSlots } from './block-view'
import type { ConsoleLabels, ConsoleSlots } from '../contract'

/** The slots an entry may use. */
export type EntrySlots = BlockSlots & Pick<ConsoleSlots, 'prompt'>

/** `span.cc-prompt` with the `prompt` slot inside, or the prompt text. */
export const renderPrompt = (
  prompt: string,
  slots: Pick<ConsoleSlots, 'prompt'>
): VNode =>
  h(
    'span',
    { class: 'cc-prompt' },
    slots.prompt ? (slots.prompt({ prompt }) as VNodeArrayChildren) : prompt
  )

export const renderEntry = (
  entry: ConsoleEntry,
  labels: ConsoleLabels,
  slots: EntrySlots
): VNode => {
  if (entry.kind === 'input') {
    return h(
      'div',
      {
        key: entry.id,
        class: 'cc-entry',
        'data-kind': 'input',
        'data-status': entry.status,
        'data-redacted': entry.redacted ? '' : undefined
      },
      [
        renderPrompt(entry.prompt, slots),
        h(
          'span',
          { class: 'cc-line' },
          entry.redacted || entry.text === null ? labels.redacted : entry.text
        ),
        entry.status === 'cancelled'
          ? h('span', { class: 'cc-cancelled' }, labels.cancelledMarker)
          : null
      ]
    )
  }
  return h(
    'div',
    {
      key: entry.id,
      class: 'cc-entry',
      'data-kind': 'output',
      'data-tone': entry.tone,
      'aria-live': entry.quiet ? 'off' : undefined
    },
    entry.blocks.map(block => renderBlock(block, entry, labels, slots))
  )
}
