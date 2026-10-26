# @dolusoft/command-console-core

The engine of [Command Console](https://github.com/dolusoft/command-console): a headless console that ends lines, runs
commands, keeps the scrollback and redacts sensitive lines. No framework, no DOM; depends on
`@dolusoft/command-protocol` only.

Not released yet. The optional features (recall, completion, context) and the Vue package come in their own pull
requests; see the repository README.

```ts
import { createConsole } from '@dolusoft/command-console-core'

const console = createConsole({
  prompt: 'app>',
  commands: [
    { name: 'echo', run: request => request.rest },
    // From argument 1 on, the line is secret: it is never kept or handed out.
    { name: 'set', sensitive: { fromArg: 1 }, run: async request => save(request.args) }
  ],
  onError: (error, info) => report(error, info)
})

console.subscribe(state => render(state.entries, state.input, state.running))
console.setInput('echo hello')
await console.submit() // or: await console.run('echo hello')
```

- **State** (`getState()`): `entries`, `input`, `running`, and the slices of the optional features. `entries`,
  `recall` and `context` can be controlled: pass `state.entries` and `onEntriesChange(updater)`, and hand the value
  back with `setOptions`.
- **Actions**: every method is one action, with one notification. A command's `run` gets a `CommandRequest` and a
  `RunContext` (`signal`, `write()`); it returns nothing, a string, blocks or a `CommandResponse` with effects.
- **Input**: `setInput(value, caret?)` is the programmatic write; clearing a non-empty input increments
  `input.revision` so the adapter replaces the element (and its undo history). `editInput(value, caret)` reports a user
  edit the element already shows and never increments it.
- **Keys**: `handleKey(input)` applies the fixed key map (Enter submits, Ctrl+C cancels or interrupts) and returns
  whether it handled the key.
- **Completion** (`features: { completionFeature }`): Tab completes the token at the caret from the visible command
  names, or from the command's `complete(request)` for an argument. One candidate is written (quoted when needed) with
  a space after it; several open `state.completion`, which Tab/Shift+Tab and the arrows walk, Enter accepts and Escape
  undoes. Argument positions at or after a command's `fromArg` are never completed.
- **Sensitive lines** (a `sensitive` command or the `isSensitive` predicate) end as a redacted input entry and never
  reach `RunInfo`, messages, recall or callbacks.
- **Lifecycle**: `reset()` returns to the initial state, `dispose()` ends the run and turns every method into a no-op.

The behavior is specified in [`contract/rules.md`](../../contract/rules.md); the public API is in
[`etc/command-console-core.api.md`](./etc/command-console-core.api.md).

## License

MIT, see [LICENSE.md](./LICENSE.md).
