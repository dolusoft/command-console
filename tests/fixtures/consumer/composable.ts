// A consumer that draws its own markup from `useCommandConsole()`, importing
// the package by name through its `exports` map: one command, the entries as
// text, a plain input (P8). Built by `pnpm measure:consumer-size`; never part
// of the package.
import { createApp, h } from 'vue'

import {
  useCommandConsole,
  type CommandDefinition
} from '@dolusoft/command-console'

const commands: CommandDefinition[] = [
  { name: 'echo', run: request => request.args.join(' ') }
]

createApp({
  setup() {
    const { console, state } = useCommandConsole({ commands })
    return () =>
      h('div', [
        ...state.value.entries.map(entry =>
          h(
            'p',
            entry.kind === 'input' ? String(entry.text) : entry.blocks.length
          )
        ),
        h('input', {
          onInput: (event: Event) => {
            const input = event.target as HTMLInputElement
            console.editInput(input.value, input.selectionStart ?? 0)
          },
          onKeydown: (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
              void console.submit()
            }
          }
        })
      ])
  }
}).mount('#app')
