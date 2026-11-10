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

### C-70 Input schema

`checkInputSchema` accepts only the subset: a root of `type: 'object'`; per type only its keywords (`description` and
`default` for all; `enum`, `minLength`, `maxLength`, `pattern` for strings; `enum`, `minimum`, `maximum` for numbers
and integers; `items` (required) and `maxItems` for arrays; `properties` and `required` for objects); property names
that match `^[A-Za-z][A-Za-z0-9_-]*$`; a `pattern` that compiles as a `u` regular expression; `required` names that
are properties; containers no deeper than `inputLimits.maxDepth`; a `default` the node itself accepts, and none on an
array. Anything else throws a `TypeError` that names the path; nothing is ignored.

### C-71 Input validation

`validateInput(schema, value)` returns a copy of the value, never the input: an optional field missing from an object
takes its `default`, an absent optional array is `[]`. Otherwise it returns every error as `{ path, code }` (`ip`,
`filter.ip`, `tags[2]`; `''` for the root), with no value in it: a wrong type (`integer` wants a whole number), a
missing required field, an unknown field (`additional`), and each failed keyword under its own name. Lengths count
code points.

### C-72 Input limits

A string longer than `inputLimits.maxTextLength` (1000) code points, an array longer than
`inputLimits.maxArrayLength` (50), or an object or array deeper than `inputLimits.maxDepth` (3, the root object is 1)
is a `limit` error, whatever the schema allows; nothing below it is checked.

### C-73 Option lines

`parseOptions(args, schema)` reads the tokens after the command name as `--name value` pairs: a value converts to the
field's type (a number as JSON writes it; an object, or an array item that is an object or an array, as JSON text); a
boolean field alone is `true` and also takes `true` or `false`; an array field repeats its name, and an array field
that is absent is `[]`. An unknown name or a token that is not a name (`additional`), a name without its value or a
second value of a field that is not an array (`type`) is an error. The result is that of `validateInput`.

### C-74 Canonical line

`formatCommandLine(command, value, schema)` writes the command and the fields of the validated value in the order of
`properties`, each value through `quoteArgument`; `true` is the bare `--name`, `false` is `--name false`. Its tokens
after the first read back with `parseOptions` to the validated value. A value the schema rejects throws.

### C-75 Envelope

`parseEnvelope(raw)` accepts a version 1 `request` and returns a new envelope with only the known fields, without
changing `raw`. A plain object whose `v` is a number other than 1 is `unsupported-version`; one larger than
`envelopeMaxBytes` (16384 bytes of UTF-8 JSON, `envelopeBytes`) is `too-large`; a missing or mistyped field, another
`kind`, or `args` that is not a JSON object within the input limits (C-72) is `invalid`. A `null` `target.view` (a
typed transport may write one back) is no view: it is valid and left out of the new envelope.

### C-76 Command input and danger

A command's `input` passes `checkInputSchema` and its `danger` is `read`, `change` or `irreversible`, and its
`normalize` is a function, at creation and on every `setOptions`; anything else throws. `getCommands()` copies
`input` and `danger` into a command's spec when it has them. `danger` does not need `input`, and a command whose
`danger` is `irreversible`, with `input` or without, never runs from the console (C-77, C-82).

### C-77 Schema lines

A line whose command has `danger: 'irreversible'`, with `input` or without, appends an `error` entry
`operation-failed` with `not-allowed` before its options are read, and no run starts. Otherwise a line whose command
has `input` is read with `parseOptions`: an error appends an `error` entry `invalid-args` with the first error's
`path` (`null` for a sensitive line) and `reason`, and no run starts. Otherwise the run starts, `normalize` (if any)
maps the value, which is checked again; a throw or an invalid result ends the run as failed (C-18). The command's
request carries the value as `input`, the view of `activeView()` (or of the request, C-82) as `view`, and `args`,
`rest` and `line` of the canonical line (C-74); `name` stays as typed. An empty or `null` view is no view: the
request has no `view` and the envelope no `target.view`. Without a gate, or for a command without `danger` or with
`sensitive`, or a line `isSensitive` marks, it then runs locally.

### C-78 Gate

`gate` is fixed for the life of the console (`setOptions` with another gate throws). The console subscribes to it on
its first envelope or when a remote binding is attached (C-97), never on creation, and `dispose()` unsubscribes and cancels what it scheduled. With a gate, an
envelope id comes from `createEnvelopeId`, else `crypto.randomUUID()`, else an RFC 4122 version 4 UUID made from
`crypto.getRandomValues` (a page on an insecure origin has only that); creating a console with a gate and none of them
throws, and a `createEnvelopeId` that throws or returns a closed id ends the run as failed (C-18). An `echoTimeoutMs`
that is not a finite number above 0 throws a `TypeError` at creation and on `setOptions`.

### C-79 Envelope

With a gate, a schema line of a command with `danger` and without `sensitive` sends an envelope after `beforeRun` lets
it go: version 1, `kind: 'request'`, the actor, `from.tab` and `target.tab` the gate's tab, `target.view` the run's
view, the canonical name and the normalized value. The run stays in `phase: 'running'` and the console stays locked
(C-16) while it waits for its echo; the command does not run before it. An envelope larger than `envelopeMaxBytes`
ends the run with `operation-failed` `too-large` and sends nothing; a gate `subscribe`, `schedule` or `send` that
throws, or a `send` that rejects, before the echo ends it with `connection-lost` in an action of its own; no echo
within `echoTimeoutMs` (default 5000, through `gate.schedule`) ends it with `timeout`.

### C-80 Echo

What the gate delivers is read with `parseEnvelope`. A value it refuses, one whose `target.tab` is not the gate's tab
or whose `from.tab` is not its `target.tab`, and one whose id is not the pending one, is ignored. The pending
envelope's echo is its own action: when its `command`, `args` and `target` equal the local record, the command's `run`
is called in the same run with the local record, never the echo's content; otherwise the run ends with
`operation-failed` `id-conflict` and `onError(error, RunInfo)`. `gate.send` gets a deep copy of the envelope: what the
transport does to it never reaches the local record.

### C-81 Closed operations

Every end of a run that sent an envelope (done, failed, cancelled, `timeout`, `connection-lost`, `id-conflict`)
cancels its timer and records its id among the last 500 closed ids; an echo of a closed id runs nothing. Ctrl+C,
`cancel()`, `reset()` or a context change while the echo is awaited ends the run as cancelled (`cancel()`, Ctrl+C and
a context change append `interrupted`).

### C-82 request

`request(input)` never rejects and resolves a `CommandOutcome`. While a run exists it is `busy`; an unparsable line
is `invalid-args`; an unknown or `hidden` command is `unknown-command`; a command without `input` or `danger`, a
sensitive one, an `irreversible` one, an actor other than `external-agent`, and a `danger` other than `read` (a `change` command whose `confirm` field is not `true` counts as `read`, C-95) are
`not-allowed`, with a `message` and, for a `change` command, a `line` (C-93); options that do not match the schema
are `invalid-args`, with a `message` (C-89). `{ command }`
without `args` is `{ command, args: {} }`, and a string given for an array of strings is a list of it (C-91). Nothing
of these reaches the entries.
Otherwise an input entry with the canonical line and the `actor` is appended and the line takes the path of C-77 to
C-81. The run's end gives `ok` with the response's `summary` (cut to 200 code points) and `data` (C-88), `failed`,
`cancelled`, `not-allowed` when `beforeRun` returns `false`, the code of a `CommandError` (C-86), `too-large` for
`data` C-88 refuses, or the code it ended with; a response with `tone: 'error'` is `failed` (C-87). A user's line
carries no `actor`.

### C-83 Agent tools

`agentTools(console, { context })` returns the `context`, `help` and `run` tools as plain objects (`name`,
`description`, `inputSchema`, `annotations`, `execute`). `context` returns what `options.context()` returns, or
`failed` when it throws. `help` lists the commands that have `input` and `danger` and are neither `hidden` nor
`sensitive` in their definition (`name`, `summary`, `danger`), or describes one of them (`name`, `summary`, `usage`,
`danger`, `input`), or is `unknown-command`; a line `isSensitive` would mark does not take a command off the list.
`help` without `command` lists a page (C-92). `run` calls `request` as `external-agent` with `{ line }` or
`{ command, args?, view? }` (no `args` is `{}`), and resolves its outcome; another input is `invalid-args` with a
`message`. A `run` of `help` or `context` (the command, or the first word of the line) that `request` refuses as
`not-allowed` or `unknown-command` keeps its code, and its `message` says to call the tool of that name instead. No
`execute` rejects. The description of `help` says what `danger` means (`read` the agent runs, `change`
only the user runs by typing it), and that of `run` says not to try a `change` command but to suggest its line, and
gives the outcome as `{ status: "error", code, message?, line? }`.

### C-84 External console (Vue)

`useCommandConsole({ console })` and `<CommandConsole :console>` use a console they did not create: they subscribe to
it and mirror its state, and never call its `setOptions` or `dispose`; the end of the effect scope, or the unmount,
only unsubscribes. With `console`, any other option of the composable, and any console-option prop of the component
(`commands`, `prompt`, `initialState`, `createId`, `maxEntries`, `beforeRun`, `onError`, `formatError`, `isSensitive`,
`recallLimit`, `shouldRecord`) or controlled slice (`entries`, `recall`, `context`), throws a `TypeError`; so does a
component with neither `commands` nor `console`. A component mounted again on the same console shows its entries and
its live input.

### C-85 Actor (Vue)

An input entry whose `actor` is `assistant`, `external-agent` or `cli` (C-102) has `data-actor` with that value and, before its
prompt, a `span.cc-actor` with `labels.actors[actor]`, so the label is read with the line; a line without `actor` or
with `user` has neither. A partial `labels.actors` keeps the other defaults.

### C-86 Command error

A command's `run` that throws or rejects a `CommandError` (an `Error` whose `name` is `CommandError`, so one from
another copy of the core counts) ends the run as failed like any error (C-18): `onError` gets
the error and the entry is `formatError`'s response or `command-failed`. Its outcome (C-82) is
`{ status: 'error', code }` with the error's `code` when that is `target-not-found`, `invalid-args` or `failed`, and
`failed` for any other code, a code the core owns (`busy`, `timeout`, `id-conflict`, …) included. Any other error, and
a `CommandError` thrown by `beforeRun`, `normalize` or `createEnvelopeId`, gives `failed`. The outcome carries
the `CommandError`'s message only as C-89 says.

### C-87 Error response

A response with `tone: 'error'`, returned by a command's `run` or by `beforeRun`, is applied as any response (effects,
then output) and its outcome (C-82) is `{ status: 'error', code: 'failed' }`, without its `summary`. A response
with any other tone, or none, is `ok`.

### C-88 Data

A response's `data` reaches the `ok` outcome of a `request()` (C-82) as a JSON copy: what the command does to it
later never reaches the caller. It is never drawn; the entries are the same with it or without it. No `data`, or
`undefined`, leaves `data` out of the outcome. `data` that is not a JSON value (`isJsonValue`: `undefined` inside, a
function, a bigint, a cycle, a class instance, …) or whose UTF-8 JSON is larger than `dataMaxBytes` (32768) makes the
outcome `{ status: 'error', code: 'too-large' }`, not `ok` without it; the response is still applied. A response with
`tone: 'error'` is `failed` (C-87) and carries no `data`. A line the user types never reads `data`.

### C-89 Error message

The `error` outcome of a `request()` (C-82) and of the agent's `run` tool (C-83) may carry a `message` for the
caller, cut to 300 code points: the message of a `CommandError` thrown or rejected by the command's own `run` (C-86),
when it differs from its code; and, for input the schema refuses, each error in words (`columns: expected array of
string`, `last: one of 15m|1h|24h|7d`, `unknown field "time"`, with `(did you mean last?)` when a known field of the
same object is near), joined by `; `; and, for `not-allowed` before the line is accepted, why (C-93). Any other error, a `CommandError` thrown by `beforeRun`, `normalize` or
`createEnvelopeId`, and a refused line that `isSensitive` marks give no `message`. A message never repeats an input
value and never reaches the entries.

### C-90 Summary function

A command's `summary` may be a function. It is called each time a spec is made (`getCommands`, the agent's `help`),
never at creation, and its string is the spec's `summary`; a function that throws or returns anything but a string
gives no `summary`. `CommandSpec.summary` stays a string.

### C-91 Text for a list

Before `request({ command, args })` checks `args` against the schema, a string given for a field whose schema is an
array of strings, at any depth of objects, becomes a list of that one string; the caller's object is not changed.
Splitting it is the command's work (`normalize`). A string for an array of another type stays refused.

### C-92 Help pages

The agent's `help` takes `{ command?, prefix?, cursor?, limit? }`. With `command` it describes that command (C-83).
Without it, it returns `{ namespaces, commands, nextCursor? }`: `namespaces` is `{ name, count, summary? }` per
namespace of the listed commands (a name up to its first dot; `summary` as C-94 says), `commands` is a page of
`{ name, summary, danger }` (summary cut to 200 code points) in the order of the commands. `prefix` without one
trailing dot keeps the commands whose name is it or starts with it and a dot. `limit` is 30 when not given and at most
100. A page's JSON takes at most 8192 UTF-8 bytes; commands leave its end until it fits (one always stays), then
namespace summaries leave, from the last namespace. `nextCursor` is there when commands follow; passed back as
`cursor` it gives the next page. Another type for a field, a `cursor` `help` did not give or a `limit` below 1 or not
an integer is `invalid-args` with a `message`.

### C-93 Why not allowed

Every `not-allowed` that `request()` gives before the line is accepted (C-82) has a `message` that says why: an actor
other than `external-agent`; a command not open to agents (no `input` or `danger`, or `sensitive` in its definition);
an `irreversible` one, which never runs from the console; a sensitive line. A `change` command's says that it changes
data and only the user runs it, by typing it in the terminal, and gives `line`: the canonical line of the input
(`formatCommandLine`, before `normalize`, as the input entry of an accepted line would show it), for the caller to
suggest to the user instead of retrying. A line that `isSensitive` marks, typed or canonical, gives no `line` and no
input value; options that do not match the schema give no `line`, and the message adds what is wrong as C-89 says
(not for a typed sensitive line). The message is cut to 300 code points. `not-allowed` from `beforeRun` carries
neither.

### C-94 Namespace summaries

The `namespaces` option is an array of `{ name, summary? }`: a name non-empty, without whitespace, quotes or a dot,
given once; a summary a string or a function. A violation throws at creation and in `setOptions`. `getNamespaces()`
returns them in their order as `{ name, summary? }`, a summary function called each time as C-90 says. The agent's
`help` without `command` gives each listed namespace that has a non-empty summary its `summary`, cut to 160 code
points; a namespace no listed command has is not listed. A console passed to `agentTools` without `getNamespaces`
lists no summary.

### C-95 Confirm field

A command's `confirm` is `{ field }` naming a boolean property of its `input`, on a `change` command only; anything
else throws at creation and on `setOptions`, as does a `plan` that is not a function. `getCommands()` copies it into
the spec. For an agent's `request()` (C-82) and a CLI request (C-98), a call whose field is not `true` is the
command's preview and runs as `read`; one whose field is `true` is the change: `not-allowed` with its line for the
agent (C-93), an approval plan for the CLI (C-99). The decision reads the input after `normalize` and the schema,
normalized once: the same input the plan and the run get; an input that cannot be normalized fails as C-77 says. The agent's `help` of such a command gives `confirm` (the field name), and the `help` and `run` descriptions and the skill say that it runs first as a preview, without its field. Options the schema refuses are `invalid-args` for a command with
`confirm`. A line the user types is not changed by it.

### C-96 Remote envelopes

`parseCliMessage(raw)` accepts a version 1 `cli-request` (`id`, exactly one of `argv` (C-106) and `line` of at most
`remoteLineMax` code points, an optional `view`), `help-request` (C-107) or `cancel` (`id`), each with the hub's stamp: `origin` `{ kind: 'cli', grantId, bindingId }`,
`stampedAt` and `expiresAt` finite numbers at or above 0, `expiresAt` after `stampedAt`. It returns a new message
with only the known fields and never changes `raw`; another `v` is `unsupported-version`, a JSON over
`envelopeMaxBytes` is `too-large`, anything else `invalid`, and a `null` `view` is no view. `refusedCliRequest(raw)`
gives `{ id, grantId, bindingId }` of a plain object with `kind: 'cli-request'`, a non-empty `id` and an `origin` with
non-empty `grantId` and `bindingId`, else `undefined`. `chunkData(id, text)` cuts
a JSON text into at most `remoteChunksMax` (3) chunk replies, each within `envelopeMaxBytes` with its UTF-8 `bytes`,
cut between code points, or returns `undefined`; `joinChunks(finished, chunks)` gives the text back only when every
part from 0 to `chunks - 1` is there once, of that request, and the byte counts hold. `isCliReply` checks the shape of
a `received` (with the booleans `change` and `viewRelevant`), `awaiting-approval`, `chunk`, `finished` (an
`outcome` with a non-empty `status`; `suggest` and `next` arrays of strings, `help` a non-empty string, each
optional) or `help-result` (never both `text` and `result`), `cancelled-before-start` or `cancel-requested` reply; an
unknown field is ignored and a `status` or `class` it does not know is still read (C-109). The list of commands is
not a reply (C-108).

### C-97 Attach remote

`attachRemote(binding)` needs the `gate` and `now` options and a binding with a non-empty `bindingId` and `grantId`,
a finite `approvedAt`, a `send` and a `publishCapabilities` function, and a `minCli` that is a non-empty string when
given; otherwise it throws a `TypeError`. It subscribes to the gate at once, puts `{ bindingId, approvedAt, approval:
null }` in `state.remote`, replaces a binding already attached, and calls `publishCapabilities({ revision, parts })`
(no reply goes through `send`): `parts` is `capabilitiesParts` (C-108) of the commands that are neither `hidden` nor
`irreversible` and have `input` and `danger` without `sensitive` (name, aliases, danger), the names and aliases of
every sensitive command, `remoteEnvelopes`, `remoteFeatures` and the binding's `minCli`; `revision` is 8 hex digits
made from the commands and the sensitive names only, the same for the same list, with no clock and no randomness. A
list that does not fit in three parts makes `attachRemote` throw that `RangeError` before anything changes. A message
whose `origin` is not the binding's is ignored. A `setOptions` that changes `commands` publishes the list again while
a binding is attached; one that keeps them publishes nothing, and a list that no longer fits goes to `onError`
and is not published. `detachRemote()` drops a waiting approval (C-99), sets `state.remote` to `null` and sends
nothing more through the binding, not even the end of a command still running; so does `dispose()`. A `send` or a
`publishCapabilities` that throws or rejects goes to `onError` and changes nothing else.

### C-98 Remote accept

A `cli-request` of the bound CLI is its own action. An id seen before is ignored. One that `parseCliMessage` refuses
but whose `id` and `origin` ids can be read (C-96, the binding's) sends only `finished`, once per id: `unsupported-version`,
`too-large`, or `invalid-args` for any other reason, with a short `message` and nothing of the request; a refused
`help-request` gets the same answer as a `help-result` (C-113); a refused `cancel`, a message of another `kind`,
and one without a readable `id` are ignored. By the `now` option, one stamped
more than 30 s ahead is `clock-skew` and one after its `expiresAt` is `expired`, each with a `message`; while a run
exists it is `busy` (no queue). An `argv` request (C-106) is never made a line: its first item is the name and the
rest are the option tokens as they are; a `line` gives its name and its tokens as C-112 says. Then, as for an agent
(C-82, C-89, C-93): a line typed as is (or an `argv` joined through `quoteArgument`) that `isSensitive` marks, a
sensitive command and a canonical line `isSensitive` marks are `not-allowed` without a `message` (C-111); an
unparsable or empty line or a name C-112 refuses is `invalid-args`, an unknown or `hidden` command
`unknown-command`; an `irreversible` command and one without `input` or `danger` are `not-allowed`; options the
schema refuses are `invalid-args` with a `message`. Each of these sends only `finished`, and adds no entry.
Otherwise the tab sends `received` (`hidden` and `dataAgeMs` from
the binding's `status`, else `false` and `null`; `change` and `viewRelevant` as C-110 says), appends an input entry with the canonical line and
`actor: 'cli'`, and starts the run without an envelope: `beforeRun`, then a `read` command or a preview (C-95) runs,
and a change waits for approval (C-99). The view is the request's, else `activeView()` on accept.

### C-99 Approval plan

A change from the CLI is in `phase: 'approving'` while it waits. The command's `plan(input, signal)`, when it has
one, is called with the normalized input and may return a promise; a throw or rejection fails the request and
nothing runs. Then `state.remote.approval` holds the plan (the request id, the command, the canonical line, the
normalized input, the `targets` strings, the `preview` string, the view, `openedAt` by `now`, `acceptsAt` one second
later and `expiresAt` two minutes later), the CLI gets `awaiting-approval` with `expiresAt`, and a timer of two
minutes is set through `gate.schedule`. `approve(id)` returns `false` and does nothing for another id or before
`acceptsAt`; after `expiresAt` it ends the request. Otherwise it clears the plan, cancels its timer and calls the
command's `run` once with the plan's input; the line is not read again. `reject(id)`, the timer, `suspendRemote()`,
`detachRemote()`, `cancel()`, Ctrl+C and a CLI `cancel` drop the plan: the request ends `not-allowed` (with a
`message` that says why) or `cancelled`, and nothing runs. A schedule that throws ends it `connection-lost`.

### C-100 Remote result

The end of a CLI request sends its outcome as the agent's `request()` would give it (C-82, C-86 to C-89): when it has
`data`, first its JSON in at most three `chunk` replies (C-96), then `finished` with the outcome without `data`,
`chunks`, `bytes`, `view` (`{ id, title? }`, the title from the binding's `viewTitle`) and `preview: true` for a
preview that ended `ok`. Every error outcome, the refusals of C-98 included, carries `class: errorClassOf(code)`
(C-105); the local `line` of `not-allowed` does not go to the CLI (`suggest` takes its place, C-111). Data that does
not fit in three chunks makes the outcome `too-large` without chunks. The terminal's blocks never go to the CLI, nor
the text of an error other than C-89's.

### C-101 Remote cancel

A `cancel` of the bound CLI for the current run's request interrupts it as `cancel()` does (C-57): the CLI gets
`cancelled-before-start` when the command's `run` was not called yet (an approval waiting included) and
`cancel-requested` when it was, then `finished` with `cancelled`. A `cancel` of another id, or after the end, is
ignored.

### C-102 CLI marker (Vue)

An input entry with `actor: 'cli'` has `data-actor="cli"` and `span.cc-actor` with `labels.actors.cli` (default
`CLI`), as C-85 says. While `state.remote` is set, `div.cc-remote` shows `labels.remote.connected` and the approval
time of the binding (`labels.formatTime`) and a `button.cc-remote-detach` that emits `detach-remote`; the consumer
ends the binding at the hub and calls `detachRemote()`.

### C-103 Approval window (Vue)

While `state.remote.approval` is set, `div.cc-approval` (a `role="alertdialog"` named by `labels.remote.approval`)
shows `labels.remote.fromCli` with the approval time of the binding, the plan's `preview` (else its line), its
targets when it has any, and the buttons `cc-approve` and `cc-reject`, which call `approve()` and `reject()`. It never
shows a computer name.

### C-104 Pairing question (Vue)

With the `pairing` prop, `div.cc-pairing` (a `role="alertdialog"` named by `labels.remote.pairing`) shows the question
and the server's facts (`createdAt` through `labels.formatTime`, `environment`) and the buttons `cc-pair-accept` and
`cc-pair-decline`, which emit `pair` with `true` and `false`. A click on any of the library's buttons does not move
the focus to the input (C-51).

### C-105 Error class

`errorClassOf(code)` gives every `ErrorCode` one `ErrorClass`, from a table that names all of them: `usage` for
`invalid-args`, `unknown-command`, `unsupported-version` and `too-large`; `denied` for `not-allowed`; `not-run` for
`busy`, `connection-lost`, `expired`, `clock-skew`, `not-delivered`, `tab-unreachable` and `gone`; `unknown` for
`unknown-outcome`; `cancelled` for `cancelled`; `failed` for `failed`, `timeout`, `target-not-found` and `id-conflict`.
`fixtures/remote/error-class.json` lists the same table.

### C-106 CLI request argv

A `cli-request` carries exactly one of `argv` and `line`; both or neither is `invalid`. `argv` is an array of at most
`remoteArgvMaxItems` (256) strings, each and all together at most `remoteLineMax` (4000) code points, not empty and
its first item not empty; `parseCliMessage` returns a copy of it.

### C-107 Help envelopes

A `help-request` (`id`, `argv` within the limits of C-106 but maybe empty, `want` `text` or `json`, an optional
`width`) carries the hub's stamp; anything else is `invalid`, and a `width` that is not an integer from 20 to 400 is
left out of the message. A `help-result` reply has `id`, `status`, and on an error `code`, `class` and `message`; at
most one of `text` (lines) and `result`; optional `suggest`, `next` and `help` as in `finished`.

### C-108 Capabilities parts

What a bound tab runs for the CLI is a `CapabilitiesPayload` (`envelopes`, `features`, `minCli` when the shell gives
one, `revision`, `sensitive`, `commands` of `{ name, aliases, danger }`), not an envelope. `capabilitiesParts(payload)`
writes its JSON with the fields in that order and cuts it between code points into one to `remoteChunksMax` parts of
at most `envelopeMaxBytes` UTF-8 bytes; when it does not fit it throws a `RangeError`. `readCapabilitiesParts(parts)`
joins one to three such strings and reads the object, leaving unknown fields out and reading an unknown `danger` as
`change`; malformed parts or fields give `undefined`. `remoteEnvelopes` is `[1]` and `remoteFeatures` names `argv`,
`received-v2`, `suggest-argv`, `help-v2`, `error-class` and `capabilities-v2`.

### C-109 Remote fixtures

`fixtures/remote/` holds examples of `docs/remote-contract.md`, each named once in its file. Every `valid` example is
read as its `read` (`parseCliMessage` from the CLI, `isCliReply` from the tab, `readCapabilitiesParts` for parts);
every `invalid` example is refused with its `code`; a `future` example is accepted with its unknown parts left out,
ignored as a whole (an unknown `kind`), or read by its documented default. `error-class.json` matches C-105. The
`sequence` examples and `command-name.json` have the documented form: they describe the CLI and the core, and run
where those are tested.

### C-110 Received fields

`received` tells the CLI `change`: the request runs the path that changes data, after `normalize` and the schema (not
a `read` command, not a preview, C-95); and `viewRelevant`: the request carries a `view`, or the command's
`usesView` is `true` (else, when the command does not set it, its namespace's `usesView`), so the CLI prints the
view. An `activeView()` alone does not make it `true`; `finished.view` still names the view the command ran in.
`usesView` changes nothing for the local terminal or an agent. The binding's `status` is called
as `status({ command })` with the command's canonical name; `hidden` and `dataAgeMs` come from it as they are (an age
that is not a finite number at or above 0 is `null`).

### C-111 Remote suggestions

A `finished` reply carries `suggest`, `next` and `help` as argv without the CLI's name, and never `outcome.line`.
`formatCommandArgv(name, value, schema)` is the canonical argv: the items `formatCommandLine` quotes, so
`tokenize(formatCommandLine(...))` gives it back. A preview that ends `ok` suggests the argv of its normalized input
with the confirm field `true`. `unknown-command` has the message `unknown command: <name>; did you mean: a, b, c` (or
`unknown command: <name>` without a near name) and suggests `[a]`, never its arguments: the near names are at most
three commands within Damerau-Levenshtein distance 2 of the name (optimal string alignment, by code point, the ASCII
case ignored), an alias counting for its command, nearest first and a tie by name; only commands the CLI may run
(C-97) are candidates. The name is echoed only when it has the form of C-112. An `invalid-args` of the options
names the command in `help`; when no argument starts with `-`, there is at least one and the command's only
required field is a string, it suggests `[name, '--field', arguments joined by one space]`. The `invalid-args` end
of a run also names the command in `help`. A `not-allowed` end of an accepted request (an approval rejected,
expired or dropped, `beforeRun`) suggests the canonical argv of its normalized input. An `ok` end whose `data` is a
plain object with a non-empty string `nextCursor`, of a command whose schema has a `cursor` field, has `next`: the
argv of the normalized input with `cursor` set to it. An argv the schema refuses is left out, and so are `suggest`
and `next` when `finished` would not fit in `envelopeMaxBytes`. A sensitive request's reply (C-98) has none of
them, nor a `message`.

### C-112 Remote command name

The command of a CLI request is its first part, found by exact match of its name or an alias, the ASCII case
ignored (an exact match first); one request runs one command. A `line` is trimmed and its name ends at the first
ECMAScript `WhiteSpace` or `LineTerminator` (U+FEFF in, U+0085 out), raw: quotes and backslashes are part of it;
the rest is tokenized (ADR 0007). The name, and so `argv[0]`, must match `^[A-Za-z][A-Za-z0-9._-]*$`; otherwise
the request is `invalid-args` and the name is not echoed. Every row of `fixtures/remote/command-name.json` runs
through `attachRemote` and finds the `tab` name or is refused with its code; a `sensitive` row is refused as
sensitive. The local terminal and `request()` keep their exact, case-sensitive lookup.

### C-113 Remote help

A `help-request` of the bound CLI is answered with one `help-result`, in its own action: an id seen before is
ignored, and the stamp is checked as C-98 says (`clock-skew`, `expired`). It is answered while a command runs (no
`busy`), with no `received` and no approval, and adds no entry. Its `argv` is read in the tab: the first item that
does not start with `-` is the target; `--cursor <n>` and `--limit <n>` (or `--name=<n>`) page as the agent's `help`
does (C-92); any other option, a second target or an option without a value is `invalid-args` with a message that
echoes nothing of the argv. The content is the agent's `help` (C-92, C-94) over the commands the CLI may run (C-97):
a target that names one of them or its alias (C-112's lookup) gives that command; one that starts a namespace of
them gives that page; none gives the whole list. Any other target is `unknown-command` with the message of C-111 and
`suggest: [nearest name]`; a target that names a sensitive command is `unknown-command` with no `message`, no
`suggest` and no `help` (P16). An invalid `--cursor` or `--limit` is `invalid-args`, naming the target command in
`help` when it has one. `want: 'json'` gives the result as `result`; `want: 'text'` gives `text`, English lines at most
`width` (else 80) code points long, wrapped at spaces, with no control character and no CLI name: a page lists the
namespaces (at the top level) and the commands with their danger and summary; a command shows its danger, summary,
usage, the line "Runs as a preview without --<field>" when it has `confirm`, and each field with its type, whether it
is required and its description. The JSON of `text` is at most 12 KB: a page that does not fit lists fewer commands,
and a command that does not fit is cut with a last line that says so. A page with a `nextCursor` has `next`:
`['help', target?, '--cursor', <n>, '--limit', <n> when given]`. A reply over `envelopeMaxBytes` is `too-large`.
Every error carries `class: errorClassOf(code)` (C-105).

### C-114 Frozen fixtures

`scripts/check-fixtures-frozen.mjs` compares `fixtures/remote/` with the `remote-fixtures-<version>.tar.gz` asset of
the latest published GitHub Release: every example of every published file must still exist, under the same `name`,
with the same content (a file that was a single object must be equal). A release without that asset, or no release,
passes. A failed download fails with a message that says to run it again. CI runs it on every pull request, and
`release.yml` attaches the archive of `fixtures/remote/` and `docs/remote-contract.md` to each release.
