# @dolusoft/command-console-core

The engine of [Command Console](https://github.com/dolusoft/command-console): a headless console that ends lines,
runs commands, keeps the scrollback, recalls and completes lines, and redacts sensitive lines. No framework, no DOM, no
timer; it depends on `@dolusoft/command-protocol` only. The Vue package `@dolusoft/command-console` is built on it;
use the core directly for another framework or a test.

```sh
pnpm add @dolusoft/command-console-core
```

The repository README describes the behavior a user sees (commands, returns and effects, completion, recall, keys,
sensitive lines). This page describes the engine.

## Creating a console

```ts
import {
  completionFeature,
  consoleFeatures,
  contextFeature,
  createConsole,
  recallFeature
} from '@dolusoft/command-console-core'

const console = createConsole({
  features: consoleFeatures({
    recallFeature,
    completionFeature,
    contextFeature
  }),
  prompt: 'app>',
  commands: [
    { name: 'echo', run: request => request.rest },
    // From argument 1 on the line is secret: it is never kept or handed out.
    {
      name: 'set',
      sensitive: { fromArg: 1 },
      run: async (request, run) => save(request.args, run.signal)
    }
  ],
  onError: (error, info) => report(error, info)
})

const unsubscribe = console.subscribe(state => render(state))
console.setInput('echo hello')
await console.submit() // or: await console.run('echo hello')
```

The core features (`console`, `entries`, `input`, `dispatch`) are always present. `recallFeature`, `completionFeature`
and `contextFeature` are opt-in, so a console that does not use them does not ship them. `consoleFeatures()` keeps the
object's type: the instance type is computed from the features given, and a console created without `features` has
no optional method, in its type and at run time. The feature set is fixed for the life of the console.

## Options

| Option                                                 | Meaning                                                                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `features`                                             | the optional features, keyed `recallFeature` / `completionFeature` / `contextFeature`                      |
| `commands`                                             | the `CommandDefinition`s; validated at creation and on every `setOptions` (a violation throws)             |
| `prompt`                                               | the root prompt; default `'>'`                                                                             |
| `initialState`                                         | the first `entries`, `recall`, `context`; every other slice starts empty                                   |
| `state`                                                | a slice given here is controlled (below); it wins over `initialState`                                      |
| `onEntriesChange`, `onRecallChange`, `onContextChange` | the reports of a controlled slice: one updater per action                                                  |
| `createId`                                             | makes entry and run ids; default a per-console counter (`c1`, `c2`, …) that skips ids already in `entries` |
| `maxEntries`                                           | drops the oldest entries beyond this, in the same action; default unbounded                                |
| `beforeRun(info, signal)`                              | asked before a command runs; `undefined` goes on, `false` stops silently, a response ends the run with it  |
| `onError(error, info)`                                 | a command threw or rejected (`info` is its `RunInfo`), or a callback threw (`info` is `null`)              |
| `formatError(error, info)`                             | turns a command's error into its `CommandResponse`; default a `command-failed` entry                       |
| `onClose()`                                            | the `close` effect                                                                                         |
| `isSensitive(line)`                                    | marks more lines sensitive, OR-ed with the commands' `sensitive`; a throw counts as sensitive              |
| `recallLimit`                                          | recall: the most lines kept; default 100 (`Infinity` keeps all, a fraction is rounded down)                |
| `shouldRecord(line)`                                   | recall: whether a submitted line is recorded; default every line                                           |
| `gate`                                                 | sends described commands as envelopes and runs them from their echo (below); fixed for the console's life  |
| `activeView()`                                         | the view a typed line (or a `{ line }` request) targets, read when the line ends                           |
| `echoTimeoutMs`                                        | how long an envelope waits for its echo, a finite number above 0 (else a `TypeError`); default 5000        |
| `createEnvelopeId()`                                   | makes envelope ids; default `crypto.randomUUID()`, else a v4 UUID from `crypto.getRandomValues` (below)    |

Run ids come from `createId` too, so with the default counter the first command's output is `c3` (`c1` the input entry,
`c2` the run). An id `createId` returns that is already present throws from the method that caused it, as a duplicate
id in `appendEntries` does.

## State

```ts
interface ConsoleState {
  entries: ConsoleEntry[]
  input: { value: string; caret: number; revision: number }
  running: {
    runId: string
    command: string
    inputId: string
    phase: 'authorizing' | 'running'
  } | null
  recall: string[] // oldest → newest (recall)
  recallCursor: number | null // recall
  recallDraft: string | null // recall
  completion: CompletionSession | null // completion: candidates, active, the token's span, its original text
  context: ContextFrame[] // bottom → top, root implicit (context)
}
```

`getState()` returns the committed state, the same object until the next change. `running.phase` is `authorizing`
while `beforeRun` has not answered. `input.revision` changes when the input element must be replaced: after a
sensitive line ends, on `reset()` when the input was not empty, and on any programmatic clear of a non-empty input. An
adapter keys its input element by it, so the element that held the text goes together with its undo history.

## Methods

Every console has:

- `getState()`, `subscribe(listener)` (returns the unsubscribe function), `setOptions(updater)`.
- `setInput(value, caret?)`: the consumer's programmatic write; the caret defaults to the end. Clearing a non-empty
  input increments `input.revision`.
- `editInput(value, caret)`: reports a user edit or caret move the element already shows; never increments
  `input.revision` (a user backspacing to empty keeps the element). `setInput` and `editInput` do nothing while a
  command runs.
- `submit()`: ends the live input as Enter does. Resolves `true` after the run's end (at once when nothing runs: an
  empty line, a parse error, an unknown command), `false` without doing anything while a run exists.
- `run(line)`: replaces the live input with `line` and submits it; the same result as `submit()`.
- `cancel()`: interrupts the running command, else ends the live line as cancelled.
- `request(input)`: runs a command for an agent (below); resolves a `CommandOutcome`, never rejects.
- `handleKey(input: KeyInput)`: applies the fixed key map; `true` when the key was handled, so the adapter prevents the
  default.
- `appendEntries(entries)` (an id already present throws), `clearEntries()`.
- `getPrompt()`: the prompt of the next input entry. `isSensitive(line)`: whether `line` would be redacted.
- `getCommands()`: the `CommandSpec` of each command that is not `hidden`, in registration order, each with `aliases`
  (`[]` when it has none).
- `reset()`, `dispose()` (below).

The optional features add:

- recall: `recallPrevious()`, `recallNext()` (each `false` when nothing changed), `clearRecall()`;
- completion: `complete()`, `completeNext()`, `completePrevious()`, `acceptCompletion()`, `closeCompletion()` (each
  `false` when it did nothing);
- context: `pushContext(frame)`, `popContext(count?)`, `resetContext()`. `popContext` rounds `count` down; a count
  below 1 does nothing, `Infinity` returns to the root. Frames are stored as given; the console does not check that
  `data` is JSON.

`KeyInput` is `{ key, ctrlKey, shiftKey, altKey, metaKey, isComposing, selection }`, where `selection` is `'none'`,
`'input'` (text selected in the input) or `'document'` (text selected elsewhere inside the console). The adapter builds
it from its event; the core never sees a DOM event. Tab on a non-empty input is always handled, even where nothing can
be completed, so focus stays on the line.

## Actions and notification

An **action** is one synchronous change that starts from one trigger: a key, a method call, the settling of
a promise (`beforeRun`, a command's `run`) or a `write()` call. A command run is several actions: its start, each
asynchronous `write()`, and its end (fulfil, reject or cancel). Each action makes its changes on a working copy; at its
end:

1. each controlled slice that changed gets exactly one `on<Slice>Change(updater)` call, whose updater composes every
   change of the action, in order, onto the value it is given;
2. the internal slices are committed;
3. subscribers are notified once.

Nothing changes and nothing is called on creation. A method call or `write()` made while an action is open (synchronously
from `run`, `beforeRun` or `isSensitive`) joins it; a synchronous return of `beforeRun` or `run` continues it. A call
made from a change handler, `onClose`, `onError` or a subscriber comes after the commit and is an action of its own.
An exception in a callback is reported through `onError(error, null)` and does not stop the other callbacks or the
action's cleanup; without `onError`, or when `onError` is the thrower, it is rethrown asynchronously.

A settle, `write()` or effect of a run that is no longer current (cancelled, reset, disposed, or replaced) changes
nothing and calls nothing.

## Controlled slices

`entries`, `recall` and `context` are controlled when `options.state[slice]` is defined. The console then reads the
slice from the options, never writes it, and reports each action's change through `on<Slice>Change(updater)`, where an
updater is a value or a function of the old value. Hand the new value back with `setOptions`:

```ts
let entries: ConsoleEntry[] = []
const console = createConsole({
  commands,
  state: { entries },
  onEntriesChange: updater => {
    entries = typeof updater === 'function' ? updater(entries) : updater
    console.setOptions(old => ({ ...old, state: { ...old.state, entries } }))
  }
})
```

An action starts from the value the console last reported for the slice, until `setOptions` delivers a new
`state[slice]` (that value wins, whether it accepts, refuses or edits the report; a defined `state[slice]` counts as
delivered even when it is the same array) or the microtask after the report runs. That microtask is the only scheduling
the core does. After it the base is `options.state[slice]` again. So two actions in one tick never lose each other's
change, and a consumer that ignores a report gets its own value back on the next tick.

An external change of `recall` ends recall browsing. An external change of `context` counts as a context change when
the sequence of frame ids differs; a new array with the same ids is not one.

## Lifecycle

- `reset()` (one action): ends the running command as cancelled without an `interrupted` entry (the run is invalidated,
  then its signal aborted), closes completion, and returns `entries`, `recall`, `context` and the input to their
  initial values (`initialState`, else empty; for a controlled slice too). Each controlled slice gets one report.
- `dispose()`: ends the running command the same way, runs every feature's cleanup once (an exception in one does not
  stop the others), clears the internal state, and turns every later method into a no-op. Two consoles share nothing.

## Commands with an input schema

A command with `input` (an `InputSchema`, checked with `checkInputSchema` when the command is registered) is typed as
`name --field value …` (`parseOptions`). A command with `danger: 'irreversible'`, with `input` or without, cannot be
run from the line (`operation-failed` with `not-allowed`, before its options are read). Options that do not match
append an `error` entry `invalid-args` with the first error's `path` and `reason`, and nothing runs. Otherwise the
run starts: `normalize(input)` (optional, pure) maps the value, which is checked again, and the command's
`CommandRequest` carries it as `input`, the target view as `view` (none for an empty or `null` view), and `args`,
`rest` and `line` of the canonical line (`formatCommandLine`). `getCommands()` copies `input` and `danger`.

## The gate

```ts
interface ConsoleGate {
  tab: string
  send(envelope: Envelope): Promise<void>
  subscribe(listener: (raw: unknown) => void): () => void
  schedule(ms: number, fn: () => void): () => void
}
```

The consumer's transport implements the gate; the core never touches the network, and `schedule` is its only clock
(ADR 0012). With a gate, a line of a command that has `input` and `danger` and is not sensitive does not run at once:

1. `beforeRun` is asked as before; the run stays `running` and the console locked.
2. An envelope (`v: 1`, `kind: 'request'`, the actor, `from.tab` and `target.tab` the gate's tab, `target.view`,
   the canonical name, the normalized input) is sent as a copy: the transport cannot change the local record. Above
   `envelopeMaxBytes` it is not sent (`too-large`).
3. Its echo, delivered through `subscribe`, runs the command with the local record when `command`, `args` and `target`
   match; a different echo ends the run with `id-conflict` and `onError`. Other traffic is ignored.
4. A `send` that rejects, or a `subscribe`, `schedule` or `send` that throws, ends the run with `connection-lost`;
   no echo within `echoTimeoutMs` with `timeout`. `cancel()`, `reset()` and a context change end it as cancelled.

These ends append an `operation-failed` entry with the code. The last 500 closed ids are remembered, so a late echo
runs nothing. The console subscribes on its first envelope, and `dispose()` unsubscribes and cancels the timer. A
command without `input` or `danger`, or a sensitive one, runs locally as without a gate.

Envelope ids come from `createEnvelopeId`, else `crypto.randomUUID()`, else a version 4 UUID made from
`crypto.getRandomValues` (a page served over plain `http` on a LAN address has only the latter). A console with a gate
and none of these throws on creation.

## Requests and agent tools

`request({ command, args, view?, actor })` or `request({ line, actor })` runs a command for a caller other than the
user's Enter. It resolves `busy` while a run exists, `unknown-command` (for a `hidden` command too), `invalid-args`,
or `not-allowed` for a command without `input` or `danger`, a sensitive or `irreversible` one, and in this release
for every actor other than `external-agent` and every `danger` other than `read`. These leave no entry. Otherwise an
input entry with the canonical line and the `actor` is appended and the line takes the path above. The outcome is
`ok` with the response's `summary` (cut to 200 code points), `failed`, `cancelled`, `not-allowed` (`beforeRun`
returned `false`), the code of a `CommandError`, or the gate's code. A response with `tone: 'error'` (from the command
or from `beforeRun`) is drawn as usual but its outcome is `failed`, without `summary`. A line the user types carries no
`actor`.

A command ends its run with a code of its own by throwing (or rejecting) a `CommandError`:

```ts
import { CommandError } from '@dolusoft/command-console-core'

const show: CommandDefinition = {
  name: 'show',
  input: showInput,
  danger: 'read',
  run: request => {
    const tab = findTab(request.view)
    if (!tab) {
      throw new CommandError('target-not-found', 'No such tab.')
    }
    return tab.render(request.input)
  }
}
```

The run fails as with any error (`onError` gets it, the entry is `formatError`'s or `command-failed`), and the
outcome is `{ status: 'error', code }`. A command may give `target-not-found`, `invalid-args` or `failed`; any other
code (`busy`, `timeout`, `id-conflict`, … belong to the core) gives `failed`, and so does a `CommandError` thrown by
`beforeRun`, `normalize` or `createEnvelopeId`.

`agentTools(console, { context })` returns the `context`, `help` and `run` tools as plain objects in the shape of a
WebMCP tool (`name`, `description`, `inputSchema`, `annotations`, `execute`). The consumer registers them:

```ts
const controller = new AbortController()
for (const tool of agentTools(console, { context: () => describeViews() })) {
  document.modelContext?.registerTool(tool, { signal: controller.signal })
}
```

`help` lists the commands that have `input` and `danger` and are neither `hidden` nor `sensitive`; `run` calls
`request` as `external-agent`. No `execute` rejects.

## Contract

The behavior rules are in [`contract/rules.md`](https://github.com/dolusoft/command-console/blob/main/contract/rules.md);
the public API is in [`etc/command-console-core.api.md`](./etc/command-console-core.api.md).

## License

MIT, see [LICENSE.md](./LICENSE.md).
