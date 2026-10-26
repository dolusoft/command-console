# Command Console

A headless command console for Vue 3: a scrollback of entries above one input line with a prompt. The user types a line, the console parses it, runs the consumer's command for it and appends what the command returns. The library owns the console's behavior (line editing keys, recall, completion, dispatch, cancellation, redaction of sensitive lines, a context stack that changes the prompt); the consumer owns the commands, their meaning, every product text and all styling.

The console ships no CSS. It renders plain elements with a small, stable set of `cc-` classes and `data-*` attributes; style them with your own design system. A line typed into a command marked sensitive leaves no trace in what the library keeps or hands out ([Sensitive lines](#sensitive-lines)).

It is not a terminal emulator: no PTY, no ANSI escape handling, no cursor addressing, no full-screen program. `xterm.js` is the tool for that; this library is the tool for an in-app command line whose commands are JavaScript functions.

| Package                                                           | Contents                                                                                                       | Dependencies               |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------- |
| [`@dolusoft/command-protocol`](packages/command-protocol)         | JSON types of entries, output blocks, command specs, responses, effects and context frames; the line tokenizer | none                       |
| [`@dolusoft/command-console-core`](packages/command-console-core) | the console engine (`createConsole`) and its features                                                          | the protocol               |
| [`@dolusoft/command-console`](packages/command-console)           | `useCommandConsole` and the `CommandConsole` component                                                         | core, protocol; `vue` peer |

## Install

The three packages are released together on npm. Add the Vue package; the protocol and the core come with it as dependencies.

```bash
pnpm add @dolusoft/command-console@1.0.0
```

Peer dependency: `vue` 3.5+. The packages are ESM only and need Node 22.18 or newer (`engines`). A consumer that builds its own markup with optional features imports them from the core, so it adds `@dolusoft/command-console-core` too. A consumer without Vue installs only the core (and the protocol, if it uses the protocol's functions).

## Quick start

```vue
<script setup lang="ts">
import { ref } from 'vue'
import {
  CommandConsole,
  type CommandDefinition,
  type ConsoleEntry
} from '@dolusoft/command-console'

const commands: CommandDefinition[] = [
  {
    name: 'echo',
    summary: 'Prints its arguments.',
    run: request => request.args.join(' ')
  },
  {
    name: 'set',
    usage: 'set <key> <value>',
    // From argument 1 on the line is secret: the value is never kept, shown or emitted.
    sensitive: { fromArg: 1 },
    complete: ({ index }) => (index === 0 ? ['title', 'theme'] : []),
    run: async (request, run) => {
      await save(request.args[0], request.args[1], run.signal)
      return `${request.args[0]} saved.`
    }
  },
  { name: 'clear', run: () => ({ effects: [{ type: 'clear' }] }) }
]
const entries = ref<ConsoleEntry[]>([])
</script>

<template>
  <CommandConsole
    v-model:entries="entries"
    :commands="commands"
    prompt="app>"
    autofocus
  />
</template>

<style>
.cc-log {
  height: 20rem;
  overflow-y: auto;
}
</style>
```

Without markup of the library, `useCommandConsole` gives the same console as state and methods ([The composable](#the-composable)). Without Vue, `createConsole` from `@dolusoft/command-console-core` is the engine both are built on ([its README](packages/command-console-core/README.md)).

## Commands

A command is a `CommandDefinition`: the JSON part (`CommandSpec`, from the protocol) plus the functions.

| Field       | Meaning                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`      | The name the first token must match, exactly (case-sensitive; a dot is an ordinary character).                                                         |
| `aliases`   | Other names that run the same command. The request tells which one was typed.                                                                          |
| `summary`   | One line on what the command does, for your help text.                                                                                                 |
| `usage`     | How it is called, for your help text.                                                                                                                  |
| `hidden`    | Not listed by `getCommands()` and not completed by name; it still runs when typed.                                                                     |
| `sensitive` | `true`, or `{ fromArg: k }`: the arguments at and after position `k` are secret (`true` is `{ fromArg: 0 }`). See [Sensitive lines](#sensitive-lines). |
| `run`       | `(request, run) => CommandReturn \| Promise<CommandReturn>`: runs the command.                                                                         |
| `complete`  | `(request) => string[] \| { candidates, final? }`: the candidates for an argument, synchronous. See [Completion](#completion).                         |

Names and aliases are non-empty, contain no whitespace and no quote character, and are unique across all names and aliases; `fromArg` is a non-negative integer. A violation throws when the console is created and whenever the commands change (C-56).

The library ships no `help` command: build it from `console.getCommands()`, which lists the commands that are not `hidden`, in registration order, each as its `CommandSpec` with `aliases` (an empty array when it has none). The text is yours anyway.

## Running a line

Enter ends the line. The console appends an input entry (the current prompt and the trimmed text), clears the input, records the line for [recall](#recall), and then:

1. An empty line ends there: an input entry with empty text, nothing recorded, nothing run.
2. The line is split into tokens ([line syntax](packages/command-protocol/README.md#line-syntax)). An unclosed quote gives an `unterminated-quote` error entry; nothing runs.
3. The first token is looked up among the names and aliases. An unknown name gives a `command-not-found` error entry.
4. `beforeRun` is asked, if given (below); then the command's `run`.

`run` gets a `CommandRequest` and a `RunContext`:

```ts
interface CommandRequest {
  name: string // the name as typed (an alias stays an alias)
  command: string // the canonical name
  args: string[] // the tokens after the name, quotes removed
  rest: string // the raw text after the name and the whitespace that follows it
  line: string // the whole line, trimmed
  context: ContextFrame[] // the context frames when the run started, bottom → top
}

interface RunContext {
  runId: string
  inputId: string // the input entry of this line
  signal: AbortSignal // aborted on cancel, reset, dispose, and a context change by someone else
  write(
    output: string | OutputBlock[],
    tone?: 'default' | 'error' | 'notice'
  ): void
}
```

### Returns and effects

`run` returns, or resolves to, one of:

- nothing: no output entry;
- a string: one output entry with one text block;
- an array of blocks: one output entry with those blocks;
- a `CommandResponse`: `{ output?, tone?, quiet?, effects? }`.

Output is structured blocks, never HTML: `text`, `json`, `table` (`columns` and `rows`), `list`, `custom` (`kind` and `data`, drawn by your `block-custom` slot) and the library's own `message` blocks. `tone` is `default`, `error` or `notice`. `quiet: true` marks long output (a whole configuration, say) that the live region should not read out.

Effects ask the console for a change, applied in order and before the output is appended, so `clear` plus a banner leaves only the banner:

| Effect                            | Does                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| `{ type: 'clear' }`               | empties the entries                                              |
| `{ type: 'close' }`               | asks you to close the console: the component emits `close`       |
| `{ type: 'push-context', frame }` | pushes a [context](#context) frame                               |
| `{ type: 'pop-context', count? }` | pops `count` frames (default 1, rounded down); stops at the root |
| `{ type: 'reset-context' }`       | returns to the root                                              |
| `{ type: 'clear-recall' }`        | empties the recall list                                          |

### `write()`

`run.write(output, tone?)` appends an output entry for the run while it runs: progress, partial results. Calls made synchronously inside `run`, together with its synchronous return, are one action: one notification, the entries in call order (C-60). After the run has ended (finished, cancelled, reset, disposed), `write` does nothing.

```ts
{
  name: 'import',
  run: async (request, run) => {
    for (const file of request.args) {
      await importFile(file, run.signal)
      run.write(`${file} imported.`)
    }
    return { output: 'Done.', tone: 'notice' }
  }
}
```

### Cancelling and errors

While a command runs the input is read-only (it keeps focus), Enter, Tab and recall do nothing, and the component shows the `busy` status. There is no timeout. Ctrl+C (without a selection) or `cancel()` interrupts the run: it stops being the current run, its `signal` is aborted, and a `notice` entry `interrupted` is appended. Anything the run writes or returns afterwards is ignored, but a cancelled command may still finish work on its side (a save that already reached the server is not undone); pass `run.signal` to your requests.

When a command throws or rejects, the console calls `onError(error, info)` with the error exactly as it was thrown, then appends an error entry `command-failed`, which never shows the error's text. Give `formatError(error, info)` to turn an error into your own `CommandResponse` (tone `error` unless it sets one); if it throws, the default entry is used. `onError` is also called with `info: null` when one of your callbacks throws (a change handler, a subscriber, `shouldRecord`).

### `beforeRun`

`beforeRun(info, signal)` is called after the lookup and before `run`, inside the run: the input is already locked and Ctrl+C cancels it. Use it for a permission check. It returns, or resolves to:

- `undefined`: go on to `run`;
- `false`: end the run silently;
- a `CommandResponse`: end the run as if the command had returned it (effects, then output).

A throw or rejection ends the run as failed. `info` is a `RunInfo`: `runId`, `inputId`, `name` (as typed, `null` for a sensitive line), `command` (the canonical name), `sensitive` and `context`. It never carries the line or the arguments, for any command.

## Controlled state

`entries`, `recall` and `context` are the console's own unless you bind them. Bound with `v-model:*`, the slice is yours: the console reads it from the prop and emits `update:<slice>` with the new value after each action. Unbound, `initialState` gives its first value.

```vue
<CommandConsole
  v-model:entries="entries"
  v-model:context="frames"
  :commands="commands"
  :initial-state="{ recall: savedRecall }"
/>
```

Take the emitted value in the same tick, as `v-model` does. The component resolves each change against the value it last emitted until your new prop arrives, so two actions in one tick never lose each other's change; a value you change or refuse wins on the next action (C-61). Changing a bound `recall` from outside ends recall browsing; changing a bound `context` to a different sequence of frame ids counts as a context change by someone else ([Context](#context)).

The library writes no storage. To keep recall across reloads, bind `recall` and store it yourself: it never holds a sensitive line.

Everything else (the input text, the recall cursor and draft, the completion session, the running command) is internal and dies with the line, the run or the console.

## Context

A context is a stack of frames, bottom → top, with an implicit root. The prompt of the next line is the top frame's `prompt`, or the `prompt` prop at the root. An input entry keeps the prompt it was ended with.

```ts
{
  name: 'config',
  run: ({ args }) => ({
    effects: [{ type: 'push-context', frame: { id: args[0], prompt: `config/${args[0]}>` } }]
  })
},
{ name: 'end', run: () => ({ effects: [{ type: 'pop-context' }] }) }
```

A frame is `{ id, prompt, data? }`; what it means is yours. A run gets the frames of its start in `request.context`. A command changes the context only through its effects. If the context changes by any other means while a run is current (a `pushContext`/`popContext`/`resetContext` call, or a new bound `context` with other frame ids), the run's signal is aborted and its context effects are dropped when it ends; its output still appears. Keep one source of truth: derive your own state from `context`, or control `context` from your state, never both.

## Completion

Tab completes the token at the caret. The first token completes from the names and aliases of the visible commands; a later token asks the command's `complete` with a `CompletionRequest`:

```ts
interface CompletionRequest {
  command: string | null // null while the name is completed
  args: string[] // the arguments before the completed one
  prefix: string // the completed token's value, quotes removed
  index: number // the argument index, 0-based; -1 for the name
  context: ContextFrame[]
}
```

`prefix` is the whole value of the token the caret is in or touches, not only the part before the caret, because the candidate replaces the whole token. The library filters the candidates (case-insensitive "starts with" `prefix`), keeps your order and drops duplicates. A `complete` that throws gives no candidates.

- No candidate: the input does not change.
- One candidate: it is written into the token, quoted when it needs quotes (keeping the token's own quote character), with its quote closed and a space after it when the token is the last one, unless you return `{ candidates, final: false }` (for a path that goes on). No second space is added after an existing one.
- Several: their longest common prefix is written when it is longer than the typed one, and the list opens. Tab / ArrowDown select the next candidate, Shift+Tab / ArrowUp the previous, both with wrap-around; each selection is written into the token. Enter accepts the selected candidate (and submits nothing); Escape restores what was typed. Any other edit or caret move closes the list and keeps the text.

Argument positions at or after a command's `fromArg` are never completed: no provider is called and no list opens. For `sensitive: true`, and for a line your `isSensitive` predicate marks, no position is completed, the name included; nor is an unknown first token that names a sensitive command in another case (`SET`), which would otherwise put the secret's command into the completion state. So `set <key>` completes and `set <key> <value>` never does.

Inside an open quote the token keeps its quote character; a candidate that contains `'` in a `'…'` token switches the token to `"…"`, since a single quote cannot be written inside single quotes.

## Recall

ArrowUp and ArrowDown browse the submitted lines, oldest → newest, each line once (recording a line again moves it to the newest place). The first ArrowUp keeps what you typed as a draft and shows the newest line; ArrowDown past the newest brings the draft back. An edit of the input ends browsing and keeps the text; a caret move does not. At the oldest line ArrowUp is left to the browser.

Every submitted line is recorded, unknown commands, unparsable lines and failures included (as a shell does); empty and cancelled lines are not, and a sensitive line never is. `shouldRecord(line)` can refuse more lines (a throwing one refuses the line and reports to `onError`); `recallLimit` (default 100) drops the oldest. The `clear-recall` effect and `console.clearRecall()` empty the list. Each recalled line is also written to the status element, because a screen reader does not announce a scripted change of a focused field.

## Keyboard

Keys are handled on the input element only, never on `window` or `document`. Modifiers match exactly (Ctrl+Shift+C is not Ctrl+C), and a key pressed during IME composition is never handled. The map is fixed in 1.0.

| Key                 | When                                         | Does                                                                      |
| ------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| Enter               | a candidate is selected                      | accepts it                                                                |
| Enter               | otherwise                                    | ends the line                                                             |
| Ctrl+C              | nothing selected in the input or the console | interrupts the run, else cancels the line (shown with `^C`, not recorded) |
| Ctrl+C              | text selected                                | left to the browser: copies                                               |
| ArrowUp / ArrowDown | completion list open                         | select the previous / next candidate                                      |
| ArrowUp / ArrowDown | otherwise                                    | browse recall                                                             |
| Tab                 | the input is not empty, or the list is open  | completes, or selects the next candidate                                  |
| Shift+Tab           | the list is open                             | selects the previous candidate                                            |
| Escape              | the list is open                             | restores the typed token, closes the list                                 |

Tab on an empty input and Shift+Tab without an open list are left to the browser, so the keyboard can always leave the console (there is no focus trap); the input's description says so. Cmd+C on macOS is never bound. Every other key (characters, Backspace, Delete, left and right, Home and End, selection, paste, Ctrl+A) is the input's native behavior. While a command runs only Ctrl+C is handled.

## Sensitive lines

A line is sensitive when its first token names a command with `sensitive` (compared case-insensitively and with quotes removed, so `SET`, `"set"` and `s"et"` all count), or when your `isSensitive(line)` predicate returns `true` or throws. Sensitivity is computed once, when the line ends, and the line is redacted before anything else sees it, on every way a line can end: submit, cancel, parse error, unknown command, `beforeRun` refusal, failure and interrupt.

What the library guarantees (P16): after a sensitive line ends, nothing of it is in what the library keeps or hands out.

- The input entry has `text: null` and `redacted: true`; the component shows `labels.redacted`.
- The line is never in `recall` or the recall draft, and no completion list holds it.
- Messages carry `null` instead of the typed name (`command-not-found`) or quote position (`unterminated-quote`).
- `RunInfo`, given to `beforeRun`, `onError` and `formatError`, never carries the line or the arguments, for any command. The `submit` event carries only `{ inputId, sensitive }`.
- The rendered DOM and its accessibility tree hold nothing of it. The input element that held the line is replaced by a new, empty one (with no undo history), as it is after `reset()` and after any programmatic clear of a non-empty input. The input's value is written to the element as a property, never into its `value` attribute.
- The input is never inside a `<form>`, has no `name`, and has `autocomplete`, `autocorrect`, `autocapitalize` and `spellcheck` off.

The exceptions are explicit: the live input while the user types the line, the `CommandRequest` given to the matched command's own `run`, the safe argument positions given to its `complete`, and the line given to your `isSensitive` predicate. What a command outputs, what its own errors carry (an HTTP client error may carry a request body) and what you put into controlled state is yours to mask.

Not guaranteed, because the library cannot reach it: the IME's own history, the operating system's keyboard suggestions, the speech and braille history of a screen reader that read the line while it was typed, the operating system's clipboard history, and the browser's form restore and autofill. The last is mitigated by the input being outside any form, without a `name`, with `autocomplete="off"`.

## The component

`<CommandConsole>` always has recall, completion and context; its `console` is typed with all three.

**Props.** `commands` (required), `prompt` (default `'>'`), `initialState`, `createId` (default a per-console counter `c1`, `c2`, … that skips ids already in the entries), `maxEntries` (drops the oldest; default unbounded), `beforeRun`, `onError`, `formatError`, `isSensitive`, `recallLimit`, `shouldRecord`, `labels`, `autofocus` (default `false`), and `entries`, `recall`, `context` for `v-model:*`. A changed prop is passed on to the console; `initialState` is read once.

**Events.** `update:entries`, `update:recall`, `update:context` (the new value, for `v-model`); `close` (a command returned the `close` effect); `submit` (`{ inputId, sensitive }`, never the line) when a line is submitted with Enter or the exposed `run`. A change of a slice and the `close` request are events, not `on*` props, so `v-model` has one channel.

**Slots.** Each replaces content, never the element that carries the hooks.

- `block-text`, `block-json`, `block-table`, `block-list`, `block-message`, `block-custom` (`{ block, entry }`): the rendering of one block type, inside a `div.cc-block` with its `data-type`; the other types keep the default. A `custom` block without a slot shows the whole block as JSON in a `pre`. Use `block-json` to highlight JSON, for example.
- `prompt` (`{ prompt }`): inside each `span.cc-prompt`.
- `busy` (`{ running }`): inside `.cc-status` while a command runs; default `labels.busy`.
- `completion` (`{ candidate, index, active }`): inside each `li.cc-completion`; the list, its ids and ARIA stay the library's.

**Expose.** Through a template ref: `focus()`, `run(line)` (replaces the input with `line` and submits it, as the user would; resolves `true` after the run ended, `false` when a run already exists), `cancel()`, `reset()` (ends the run without an `interrupted` entry and returns every slice and the input to its initial value), `clear()` (removes every entry), `console` (the core instance) and `state`. The template ref unwraps `state`, so `consoleRef.value.state` is the `ConsoleState` itself; read it in a computed or a template to key an overlay on `state.running`.

## DOM and styling

The component renders this tree. The classes, `data-*` attributes and ids are listed in [`contract/dom.ts`](contract/dom.ts) (and [CONTRACT.md](CONTRACT.md)); they are the only hooks a skin may select, and they are public API (P6).

```
div.cc-console [data-busy] data-context-depth=<frames>
├─ div.cc-log role="log" aria-label            the scroll container
│  └─ div.cc-entries
│     └─ div.cc-entry data-kind="input|output" data-tone data-status [data-redacted] [aria-live="off" when quiet]
│        ├─ input:  span.cc-prompt, span.cc-line, span.cc-cancelled (after Ctrl+C)
│        └─ output: one .cc-block data-type=… per block
│           text, json, custom → pre · table → table/thead/th scope=col/tbody · list → ul/li · message → div
├─ div.cc-status role="status"                 busy text, or the recalled line
├─ ul.cc-completions role="listbox"            only while a list is open
│  └─ li.cc-completion role="option" aria-selected
└─ div.cc-input-line                           never a form
   ├─ span.cc-prompt
   └─ input.cc-input role="combobox" [readonly while running]
```

The library writes no `style` attribute, sets no size and no `overflow`. Give `.cc-log` a height and `overflow-y: auto` and it scrolls:

```css
.cc-console {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: ui-monospace, monospace;
}
.cc-log {
  flex: 1;
  overflow-y: auto;
}
.cc-block {
  margin: 0;
  white-space: pre-wrap;
}
.cc-entry[data-tone='error'] {
  color: crimson;
}
.cc-entry[data-redacted] .cc-line {
  font-style: italic;
}
.cc-console[data-busy] .cc-input {
  opacity: 0.6;
}
.cc-completion[aria-selected='true'] {
  background: highlight;
}
.cc-console[data-context-depth='0'] .cc-prompt {
  color: gray;
}
```

**Scroll.** The log stays at the bottom while the user is within 2 px of it, and always after the user's own submit; when the user has scrolled up, new output does not move the view. `scrollTop` of `.cc-log` is the only style-related write the library makes.

**Focus.** `autofocus` focuses the input on mount; after a submit the input keeps focus. A click in the log focuses the input, unless text is selected (so it can be copied) or the click was on something interactive (a link, a button, a form field, an element with `tabindex` or `contenteditable`). When the input element is replaced, the new one gets focus only if the old one had it.

**Ids** come from Vue's `useId()`, so two consoles on one page never collide and server rendering matches. All text is escaped; nothing is rendered as HTML.

## Labels

Every text the component shows comes from the `labels` prop, over English defaults. `messages` merges one level deep, so overriding one message keeps the others. A message is a string or a function of its parameters.

| Label                            | Default                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `input`                          | `Command` (the input's accessible name)                                           |
| `inputDescription`               | `Enter runs the command. Tab completes; on an empty line it leaves the console.`  |
| `log`                            | `Console output`                                                                  |
| `redacted`                       | `(input hidden)`                                                                  |
| `cancelledMarker`                | `^C`                                                                              |
| `completions`                    | `Suggestions` (the list's accessible name)                                        |
| `busy`                           | `Running…`                                                                        |
| `messages['command-not-found']`  | `` p => p.name === null ? 'command not found' : `${p.name}: command not found` `` |
| `messages['command-failed']`     | `The command failed.`                                                             |
| `messages['unterminated-quote']` | `Unterminated quote.`                                                             |
| `messages.interrupted`           | `Interrupted.`                                                                    |

```vue
<CommandConsole
  :commands="commands"
  :labels="{
    input: t('console.input'),
    busy: t('console.busy'),
    messages: {
      'command-not-found': p => t('console.notFound', { name: p.name ?? '' })
    }
  }"
/>
```

The core writes no human text: what the library says is a `message` block with a code (`command-not-found`, `command-failed`, `unterminated-quote`, `interrupted`) and parameters, and the component turns it into text with `labels.messages`.

## The composable

`useCommandConsole(options)` gives the console without markup: `{ console, state }`, where `state` is a read-only `ShallowRef` of the console's state after every action. It takes the core options; a value option (`commands`, `prompt`, `state`, `maxEntries`, `recallLimit`) may be a value, a ref or a getter, a function option (`beforeRun`, `onError`, `onEntriesChange`, …) the function or a ref to it (a bare function is the option, never a getter). `features` and `initialState` are read once. The console is disposed with the calling effect scope.

```ts
import { useCommandConsole } from '@dolusoft/command-console'
import {
  consoleFeatures,
  recallFeature,
  contextFeature
} from '@dolusoft/command-console-core'

const { console, state } = useCommandConsole({
  features: consoleFeatures({ recallFeature, contextFeature }),
  commands: () => commands.value,
  prompt: 'app>'
})
```

A console created without `features` has only the core methods, in its type and at run time. Drawing the console yourself means doing what the component does: report each user edit with `console.editInput(value, caret)`, pass keys to `console.handleKey(keyInput)` and prevent the default when it returns `true`, write `state.input.value` into the element as a property, and key the input element by `state.input.revision` so the element that held a sensitive line is dropped. The [core README](packages/command-console-core/README.md) describes the state, the methods and the actions.

## Not in 1.0

Multi-line input and backslash line continuation (a `\` is an ordinary character), reverse search (Ctrl+R), persisted recall (bind `recall` instead), raw HTML output, a public plugin API, a help command helper, a virtualised scrollback (`maxEntries` bounds it), typing ahead while a command runs, asynchronous completion providers, configurable key bindings and a custom candidate matcher. Some of these can come in a minor release.

## Documents

- [PRINCIPLES.md](PRINCIPLES.md): the boundaries of the library.
- [contract/rules.md](contract/rules.md) and the generated [CONTRACT.md](CONTRACT.md): the behavior rules and the public contract.
- [docs/decisions/](docs/decisions/README.md): the architecture decisions.
- [CONTRIBUTING.md](CONTRIBUTING.md): layout, commands, measuring, releasing.

## License

[MIT](LICENSE.md)
