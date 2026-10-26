# @dolusoft/command-console

A headless command console for Vue 3: `useCommandConsole` and the `CommandConsole` component of
[Command Console](https://github.com/dolusoft/command-console). Ships no CSS; `vue` 3.5+ is its only peer.

Not released yet; see the repository README.

## The component

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { CommandConsole, type CommandDefinition, type ConsoleEntry } from '@dolusoft/command-console'

const commands: CommandDefinition[] = [
  { name: 'echo', run: request => request.rest },
  // From argument 1 on, the line is secret: it is never kept, shown or emitted.
  { name: 'set', sensitive: { fromArg: 1 }, run: request => save(request.args) }
]
const entries = ref<ConsoleEntry[]>([])
</script>

<template>
  <CommandConsole v-model:entries="entries" :commands="commands" prompt="app>" autofocus />
</template>
```

- **Recall, completion and context** are always on. `entries`, `recall` and `context` are the console's own unless
  bound with `v-model:*`; `initialState` gives the first value of an unbound slice.
- **Events:** `submit` (`{ inputId, sensitive }`, never the line), `close` (a command's `close` effect) and the
  `update:*` of `v-model`.
- **Slots:** `block-text`, `block-json`, `block-table`, `block-list`, `block-message`, `block-custom`, `prompt`,
  `busy`, `completion`. A slot replaces the content, never the element that carries the hooks.
- **Labels:** every text the component shows is in `labels` (English defaults; messages may be functions of their
  params).
- **Expose:** `focus()`, `run(line)`, `cancel()`, `reset()`, `clear()`, `console` and `state`.

## Styling

The component renders plain elements with `cc-*` classes and `data-*` attributes, listed in `contract/dom.ts` and
`CONTRACT.md`. Nothing has a size or a style of its own: give `.cc-log` a height and `overflow-y: auto` and it
scrolls, staying at the bottom while the user is there.

```css
.cc-log { height: 20rem; overflow-y: auto; }
.cc-entry[data-tone='error'] { color: crimson; }
.cc-console[data-busy] .cc-input { opacity: 0.6; }
```

## The composable

`useCommandConsole(options)` gives the same console without markup: `{ console, state }`, where `state` is a
read-only `ShallowRef` of the snapshot. Value options take a ref or a getter, function options a ref or the function
itself; the console is disposed with the calling scope.

MIT License.
