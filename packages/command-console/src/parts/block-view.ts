// One output block (spec §7.3): `.cc-block` with its `data-type`, in the
// element of its type, or a `div` around the consumer's `block-<type>` slot
// (C-67). All text goes through Vue's escaping; there is no HTML (S-08).
import { h, type VNode, type VNodeArrayChildren } from 'vue'

import type {
  JsonPrimitive,
  OutputBlock,
  OutputEntry
} from '@dolusoft/command-protocol'

import type { BlockSlotProps, ConsoleLabels, ConsoleSlots } from '../contract'
import { messageText } from '../labels'

/** The `block-<type>` slots the component was given. */
export type BlockSlots = Pick<
  ConsoleSlots,
  | 'block-text'
  | 'block-json'
  | 'block-table'
  | 'block-list'
  | 'block-message'
  | 'block-custom'
>

const json = (value: unknown) => JSON.stringify(value, null, 2)

/** A table cell: a missing key and `null` are empty. */
const cellText = (value: JsonPrimitive | undefined): string =>
  value === undefined || value === null ? '' : String(value)

const content = (block: OutputBlock, labels: ConsoleLabels): VNode => {
  const hooks = { class: 'cc-block', 'data-type': block.type }
  switch (block.type) {
    case 'text':
      return h('pre', hooks, block.text)
    case 'json':
      return h('pre', hooks, json(block.value))
    case 'table':
      return h('table', hooks, [
        h(
          'thead',
          h(
            'tr',
            block.columns.map(column => h('th', { scope: 'col' }, column.label))
          )
        ),
        h(
          'tbody',
          block.rows.map(row =>
            h(
              'tr',
              block.columns.map(column => h('td', cellText(row[column.key])))
            )
          )
        )
      ])
    case 'list':
      return h(
        'ul',
        hooks,
        block.items.map(item => h('li', item))
      )
    case 'message':
      return h('div', hooks, messageText(labels, block))
    case 'custom':
      return h('pre', hooks, json(block))
  }
}

/** Renders `block` of `entry`, through its slot when one is given. */
export const renderBlock = (
  block: OutputBlock,
  entry: OutputEntry,
  labels: ConsoleLabels,
  slots: BlockSlots
): VNode => {
  const slot = slots[`block-${block.type}`] as
    ((props: BlockSlotProps) => unknown) | undefined
  if (slot) {
    return h(
      'div',
      { class: 'cc-block', 'data-type': block.type },
      slot({ block, entry }) as VNodeArrayChildren
    )
  }
  return content(block, labels)
}
