# @dolusoft/command-console

A headless command console for Vue 3: `useCommandConsole` and the `CommandConsole` component of
[Command Console](https://github.com/dolusoft/command-console). A scrollback of entries above one input line with a
prompt: the user types a line, the console runs your command for it and shows what the command returns. Line editing,
recall, completion, cancellation, a context stack and the redaction of sensitive lines are the library's; the commands,
every text and all styling are yours. Ships no CSS; `vue` 3.5+ is its only peer.

```sh
pnpm add @dolusoft/command-console
```

The full guide (commands, returns and effects, completion, recall, keys, sensitive lines) is the
[repository README](https://github.com/dolusoft/command-console#readme).

## The component

```vue
<script setup lang="ts">
import { ref } from 'vue'
import {
  CommandConsole,
  type CommandDefinition,
  type ConsoleEntry
} from '@dolusoft/command-console'

const commands: CommandDefinition[] = [
  { name: 'echo', run: request => request.rest },
  // From argument 1 on the line is secret: it is never kept, shown or emitted.
  {
    name: 'set',
    sensitive: { fromArg: 1 },
    run: (request, run) => save(request.args, run.signal)
  },
  { name: 'exit', run: () => ({ effects: [{ type: 'close' }] }) }
]
const entries = ref<ConsoleEntry[]>([])
const open = ref(true)
</script>

<template>
  <CommandConsole
    v-if="open"
    v-model:entries="entries"
    :commands="commands"
    prompt="app>"
    autofocus
    @close="open = false"
  />
</template>
```

- **Recall, completion and context** are always on. `entries`, `recall` and `context` are the console's own unless
  bound with `v-model:*`; `initialState` gives the first value of an unbound slice.
- **Props:** `commands`, `prompt`, `initialState`, `createId`, `maxEntries`, `beforeRun`, `onError`, `formatError`,
  `isSensitive`, `recallLimit`, `shouldRecord`, `labels`, `autofocus`, `entries` / `recall` / `context`, and
  `console`.
- **A console that outlives the component:** `:console="pageConsole"` draws a console created elsewhere with every
  optional feature, and never disposes it, so a panel mounted again shows the same entries and live input. Its options
  are its creator's: with `console`, `commands` to `shouldRecord` and `entries` / `recall` / `context` throw a
  `TypeError`; `labels` and `autofocus` apply.
- **Events:** `update:entries`, `update:recall`, `update:context` (for `v-model`, each resolved against the value last
  emitted, so two changes in one tick are both kept), `close` (a command's `close` effect) and `submit`
  (`{ inputId, sensitive }`, never the line; for Enter and the exposed `run`).
- **Slots:** `block-text`, `block-json`, `block-table`, `block-list`, `block-message`, `block-custom` (`{ block, entry }`,
  inside a `div.cc-block`), `prompt`, `busy`, `completion`. A slot replaces content, never the element that carries the
  hooks.
- **Labels:** every text the component shows is in `labels`, over English defaults; `messages` and `actors` merge one
  level deep and a message may be a function of its parameters. A line from the assistant or an external agent
  (`InputEntry.actor`) shows `labels.actors[actor]` (`AI`, `Agent`) in a `span.cc-actor` before its prompt, and its
  entry has `data-actor`.
- **Expose:** `focus()`, `run(line)`, `cancel()`, `reset()`, `clear()`, `console` and `state` (unwrapped by the
  template ref: `consoleRef.value.state.running`).

## Styling

The component renders plain elements with `cc-*` classes and `data-*` attributes, listed in
[`contract/dom.ts`](https://github.com/dolusoft/command-console/blob/main/contract/dom.ts). Nothing has a size or a
style of its own: give `.cc-log` a height and `overflow-y: auto` and it scrolls, staying at the bottom while the user is
there.

```css
.cc-log {
  height: 20rem;
  overflow-y: auto;
}
.cc-block {
  margin: 0;
  white-space: pre-wrap;
}
.cc-entry[data-tone='error'] {
  color: crimson;
}
.cc-console[data-busy] .cc-input {
  opacity: 0.6;
}
.cc-completion[aria-selected='true'] {
  background: highlight;
}
```

## The composable

`useCommandConsole(options)` gives the same console without markup: `{ console, state }`, where `state` is a read-only
`ShallowRef` of the console's state. A value option (`commands`, `prompt`, `state`, `maxEntries`, `recallLimit`) takes
a value, a ref or a getter; a function option takes the function or a ref to it. `features` and `initialState` are read
once, and the console is disposed with the calling scope; `useCommandConsole({ console })` mirrors a console created
elsewhere, takes no other option and never disposes it. The optional features come from
`@dolusoft/command-console-core`:

```ts
import { useCommandConsole } from '@dolusoft/command-console'
import { consoleFeatures, recallFeature } from '@dolusoft/command-console-core'

const { console, state } = useCommandConsole({
  features: consoleFeatures({ recallFeature }),
  commands: () => commands.value
})
```

## License

MIT, see [LICENSE.md](./LICENSE.md).
