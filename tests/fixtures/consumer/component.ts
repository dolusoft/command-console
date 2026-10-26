// A consumer that renders `<CommandConsole>`, importing the package by name
// through its `exports` map: one command, the entries bound like `v-model`
// (P8). Built by `pnpm measure:consumer-size`; never part of the package.
import { createApp, h, shallowRef } from 'vue'

import {
  CommandConsole,
  type CommandDefinition,
  type ConsoleEntry
} from '@dolusoft/command-console'

const commands: CommandDefinition[] = [
  { name: 'echo', run: request => request.args.join(' ') }
]

createApp({
  setup() {
    const entries = shallowRef<ConsoleEntry[]>([])
    return () =>
      h(CommandConsole, {
        commands,
        prompt: '$',
        entries: entries.value,
        'onUpdate:entries': (value: ConsoleEntry[]) => {
          entries.value = value
        }
      })
  }
}).mount('#app')
