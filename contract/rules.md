# Behavior rules

Each rule has a stable ID. Every ID is covered by at least one test whose name contains it, and a test that names an unknown or withdrawn ID fails the build (`tests/repo/contract-traceability.spec.ts`, P12). Numbers are never reused: a later rule appends, and a withdrawn rule keeps its heading with `(withdrawn)` as its title and needs no test.

A rule marked (Vue) is tested in the Vue package, the others in the core or the protocol. "An action" is one synchronous step of the console (`PRINCIPLES.md` P3); "the line-end cleanup" is what every way of ending a line does (the recall draft and the completion session are dropped, sensitive lines are redacted first).

The console handles keys on its input element only. Where the browser's default for a key differs from a rule, the override is:

| Rule                             | Browser default on a text input                         | Override                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-09 Submit                      | Enter does nothing outside a form                       | Enter ends the line, or accepts the selected candidate when the completion list is open (C-41); the input is never inside a `<form>` (C-69)                                                     |
| C-15 Cancel line, C-57 Interrupt | Ctrl+C copies the selection                             | without a selection, Ctrl+C cancels the line or interrupts the run; with a selection it is left to the browser and copies (C-52)                                                                |
| C-20 Recall browsing             | ArrowUp / ArrowDown move the caret to the start / end   | while no completion list is open, they browse the recall list                                                                                                                                   |
| C-37, C-41 Completion            | Tab and Shift+Tab move the focus                        | Tab completes on a non-empty input or with a list open; Shift+Tab selects the previous candidate with a list open; otherwise both are left to the browser so focus can leave the console (C-59) |
| C-41 Several candidates          | ArrowUp / ArrowDown move the caret; Escape does nothing | with a list open, the arrows select and Escape restores the typed token                                                                                                                         |
| C-53 Key map                     | a key pressed during IME composition is the IME's       | a key with `isComposing` is never handled                                                                                                                                                       |

Every other key (characters, Backspace, Delete, left and right, Home and End, selection, paste, Ctrl+A) keeps its native behavior.

The [README](../README.md) describes the same behavior for a reader of the library; where a rule is short, its section there gives the detail.

### C-01 Plain console

`createConsole({ commands })` works with the core features only; optional feature methods are absent from the
instance and its type.

### C-02 Features

Options merge feature defaults, then the given options; `setOptions` keeps the defaults and cannot change the feature
set.

### C-03 Inputs never mutated

Options, `initialState`, controlled state, commands and their returns are never written; deep-frozen inputs work
through every action.

### C-04 Controlled slices

With `state.entries` (resp. `recall`, `context`) given, the console reads the slice from options, `state` wins over
`initialState`, and each action reports its changes through one `on*Change` updater that composes them all. A value
the consumer passes back (accepted, rejected or edited) is the base of the next action.

### C-05 Actions

Each action notifies subscribers at most once; nothing is notified or called on creation; a throwing callback does not
stop the others or the cleanup.

### C-06 JSON

Every entry, block, response, effect and frame the console produces survives a JSON round trip and holds only finite
numbers.

### C-07 Dispose

`dispose()` invalidates and aborts the running run, runs disposers once, clears state, and makes every later call a
no-op.

### C-08 Isolation

Two consoles share no state, ids, DOM ids or timers; disposing one does not affect the other.

### C-09 Submit

Enter ends the line: an input entry with the current prompt and trimmed text, then the line-end cleanup. An empty line
adds an empty input entry and nothing else.

### C-10 Tokenizer

Whitespace (tabs included) separates; quotes group; escapes only inside `"…"`; `\` literal outside; spans cover the
raw text; nothing is dropped; `quoteArgument` round-trips.

### C-11 Unterminated quote

Dispatch gives `unterminated-quote` and runs nothing; the tolerant tokens mark the open token.

### C-12 Request

`run` gets one `CommandRequest` (`name`, `command`, `args`, `rest`, `line`, `context` snapshot).

### C-13 Lookup

Only registered names and aliases run, matched exactly; a dot is an ordinary character; an unknown name gives
`command-not-found` with the first token.

### C-14 beforeRun

Runs inside the run (read-only input, cancellable, `phase: 'authorizing'`) with `RunInfo` and the signal; `undefined`
goes on, `false` stops silently, a response is handled as the run's fulfil (effects, then output), a throw ends the run
as failed.

### C-15 Cancel line

Ctrl+C without a selection and without a run ends the line as `cancelled` with the line-end cleanup and records
nothing.

### C-16 Run lock

While a run exists, Enter, Tab and recall do nothing and `submit()` / `run(line)` resolve `false`; the input is
writable again after every outcome.

### C-17 Stale runs

A settle, effect or `write` of a run that is no longer current changes nothing and calls nothing (`onError` included),
and never clears another run's `running`.

### C-18 Errors

A throw or rejection calls `onError(error, RunInfo)` and handles `formatError`'s response as a fulfil, or appends
`command-failed` without the error's text; a throwing `formatError` falls back to the default.

### C-19 Recall order

Unique lines oldest → newest; re-recording moves a line to the newest.

### C-20 Recall browsing

ArrowUp keeps the draft and shows the newest, stops at the oldest; ArrowDown past the newest restores the draft; an
edit ends browsing; an external `recall` change ends browsing.

### C-21 Recall filter

`shouldRecord` and sensitivity run before insertion; empty and cancelled lines are not recorded; unknown, unparsable
and failing lines are.

### C-22 Recall limit

`recallLimit` drops the oldest.

### C-23 Clear recall

`clearRecall()` and the `clear-recall` effect empty the list and end browsing in one action.

### C-24 Initial state

`initialState` seeds `entries`, `recall`, `context` only; nothing else is added on creation.

### C-25 Effects

Effects apply in order before the output; `clear` empties the entries; `close` calls `onClose` (Vue: the `close`
event); an effect without its feature is ignored.

### C-26 Context stack

`push-context` / `pop-context` / `reset-context` change the stack; popping at the root does nothing; a request
carries the snapshot taken at its start.

### C-27 Prompt snapshot

An input entry keeps the prompt it was ended with; the next prompt follows the top frame.

### C-28 Returns

`void` gives no output entry, a string one text block, a block array those blocks, a response its output with its
`tone` and `quiet`; same content, same entries.

### C-29 Write

`write()` appends in call order, joins an open action, and does nothing after the run ended.

### C-30 Sensitivity

A line whose first token resolves case-insensitively, quotes removed, to a sensitive command, or that the predicate
marks (or whose predicate throws), ends as an input entry with `text: null`, `redacted: true`.

### C-31 Redacted recall

A sensitive line is never in `recall` nor in the recall draft, in any outcome.

### C-32 Redacted cancel

A sensitive line ended with Ctrl+C is redacted and its draft dropped.

### C-33 Redacted messages

For a sensitive line, `command-not-found` carries `name: null` and `unterminated-quote` carries `index: null`;
`RunInfo` never carries the line or arguments.

### C-34 No error text

The default error entry carries no part of the error.

### C-35 Redacted completion

Positions at or after `fromArg` (all, for `sensitive: true` or a predicate match) call no provider and open no session;
safe positions get only the arguments before `fromArg`.

### C-36 Leak matrix

For every path (submit, cancel, parse error, unknown, refusal, failure, interrupt, completion, recall draft, reset,
dispose, late rejection), the secret is absent from the state, every callback and event argument at call time
(updaters resolved, errors' own fields included), the DOM, the accessibility tree and the input element that held it.
The library never adds the line or the request to an error; an error the command itself builds is the command's.

### C-37 Name completion

Tab on the first token completes visible names and aliases.

### C-38 Argument completion

Tab on a later safe token asks the command's `complete` with `args`, `prefix`, `index`, `context`; no `complete`, or a
throwing one, gives no candidates.

### C-39 No candidates

The input does not change.

### C-40 One candidate

The candidate is written into the token's span and its quote closed, and a space is added unless `final: false`, the
token is not the last, or a space already follows it; the caret follows it. Quoting: a quoted or open token keeps its
quote character, except that `'…'` becomes `"…"` for a candidate containing `'`; a bare token whose text needs quoting
(`quoteArgument(text) !== text`) opens `'`, or `"` when the text contains `'`.

### C-41 Several candidates

The longest common prefix is written when longer than the typed prefix, without closing a quote; the list opens;
Tab/ArrowDown and Shift+Tab/ArrowUp select with wrap and write the candidate into the span; text outside the span is
kept; Enter on a selection accepts it as C-40 does and submits nothing; Escape restores the original token.

### C-42 (withdrawn)

Async completion is not in 1.0 (README, "Not in 1.0").

### C-43 Completion closes

An edit or caret move the session did not make closes the session and keeps the text; tolerant tokens complete inside
an open quote, keeping its quote character.

### C-44 Busy (Vue)

While a run exists the root has `data-busy`, the status element shows `labels.busy` (or the `busy` slot) and the input
is `readonly`; the log has no `aria-busy`.

### C-45 DOM contract (Vue)

The elements the library renders carry only the classes, attributes and ids of `contract/dom.ts`, each on the element
it is listed for; slot content is excluded.

### C-46 No styles (Vue)

No element the library renders has a `style` attribute; no size or `overflow` is set.

### C-47 Labels (Vue)

Every text comes from `labels`; no literal `aria-label` in a `.vue` file; message codes render through
`labels.messages`; a partial `labels.messages` keeps the other defaults.

### C-48 Accessibility (Vue)

axe-core finds no violation with the list closed and open; the log is a named `role="log"`; the input is a named and
described combobox with `aria-controls` and `aria-activedescendant` only when they point to existing elements; the
listbox is named; a recalled line is written to the status element; quiet entries are `aria-live="off"`.

### C-49 Packaging

ESM only, own `.d.ts`, `vue` a peer, no alias or `optimizeDeps` needed by a consumer, `README.md` and `LICENSE.md` in
every tarball (pack-install test).

### C-50 No transport, no storage

No package reads or writes storage or the network.

### C-51 Focus (Vue)

`autofocus` focuses on mount; a click anywhere in the console (the log, the status, the completion list, the input
line and the empty space around them) focuses the input unless text is selected or the target is interactive.

### C-52 Keys scoped (Vue)

Keys are handled on the input only; no listener remains after unmount; Ctrl+C with a selection is not prevented.

### C-53 Key map

The fixed key map (the table above; README, "Keyboard") applies with exact modifiers; a key with `isComposing` is never handled.

### C-54 Input replaced (Vue)

After a sensitive line ends, after `reset()` and after any programmatic clear of a non-empty input, the input is a new
element (identity check) with an empty value; it has focus only if the old one had it. A native undo
(`execCommand('undo')`) in the new element brings nothing back.

### C-55 maxEntries and ids

Appending beyond `maxEntries` drops the oldest in the same action; generated ids skip existing ones; appending a
duplicate id throws.

### C-56 Command names

Invalid or duplicate names and aliases, and an invalid `fromArg`, throw at creation and at `setOptions`.

### C-57 Interrupt

Ctrl+C or `cancel()` during a run invalidates the run, then aborts its signal, then appends `interrupted`; the run's
cleanup runs once.

### C-58 Scroll (Vue)

The log sticks to the bottom only while it is at the bottom and after the user's own submit; `scrollTop` is the only
style-related write; the `ResizeObserver` is disconnected on unmount and its late callback does nothing.

### C-59 Focus exit (Vue)

Tab on an empty input and Shift+Tab without a session are not prevented, so focus leaves the console.

### C-60 Nested actions

Method calls and `write()` inside an open action join it: two synchronous `write()` calls in `run` followed by a
return give one notification, with the input entry and the three outputs in order.

### C-61 Same-tick updates

Two actions in one tick without a `setOptions` in between build on the last reported value; a value passed back with
`setOptions` wins over it. Tested in core and through `v-model` in Vue.

### C-62 External context change

A change of the context during a run by anything other than the run's own effects (a context method call, an external
controlled `context`) aborts the run's signal and drops its context effects; its output still appears.

### C-63 run and submit

`submit()` ends the live input as Enter does; `run(line)` replaces the live input with `line` (incrementing
`input.revision` when it was not empty) and submits it; both resolve `true` after the run's end action, or after the
line ended when nothing ran, and `false` when a run already exists.

### C-64 submit event (Vue)

The `submit` event carries only `{ inputId, sensitive }`.

### C-65 getCommands

`getCommands()` lists the specs that are not `hidden`, in registration order, each with its aliases.

### C-66 Context depth (Vue)

The root's `data-context-depth` equals the number of context frames after every action.

### C-67 Slots (Vue)

A `block-<type>` slot replaces the rendering of that block type only; `prompt`, `busy` and `completion` render inside
their library element, which keeps its classes, ids and ARIA attributes.

### C-68 Composable (Vue)

`useCommandConsole` passes reactive option changes to `setOptions`, mirrors every notification into its `state`, does
no DOM work, and disposes the console when its effect scope is disposed.

### C-69 No form, no name (Vue)

The input is not inside a `<form>` rendered by the library and has no `name` attribute; `autocomplete`,
`autocorrect`, `autocapitalize` and `spellcheck` are off.
