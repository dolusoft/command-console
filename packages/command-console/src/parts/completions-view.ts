// The completion list (spec §7.3, §6.5): a named listbox, one option per
// candidate, rendered only while a session is open. The ids tie it to the
// input's `aria-controls` and `aria-activedescendant` (C-48).
import { h, type VNode, type VNodeArrayChildren } from 'vue'

import type { CompletionSession } from '@dolusoft/command-console-core'

import type { ConsoleSlots } from '../contract'

/** The id of candidate `index` of the list `listId`. */
export const optionId = (listId: string, index: number): string =>
  `${listId}-${index}`

export const renderCompletions = (
  session: CompletionSession,
  listId: string,
  label: string,
  slots: Pick<ConsoleSlots, 'completion'>
): VNode =>
  h(
    'ul',
    {
      class: 'cc-completions',
      role: 'listbox',
      id: listId,
      'aria-label': label
    },
    session.candidates.map((candidate, index) => {
      const active = index === session.active
      return h(
        'li',
        {
          key: `${index}:${candidate}`,
          class: 'cc-completion',
          role: 'option',
          id: optionId(listId, index),
          'aria-selected': active ? 'true' : 'false'
        },
        slots.completion
          ? (slots.completion({
              candidate,
              index,
              active
            }) as VNodeArrayChildren)
          : candidate
      )
    })
  )
