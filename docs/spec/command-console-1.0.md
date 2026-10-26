# Command Console 1.0 — specification

Status: draft v1 (2026-10-26). Review 1 (independent reviewer) and review 2 (independent reviewer) follow; this file is
revised after each. Once accepted, its parts move into the repository's real documents (§13) and this file is deleted
in the same change.

Inputs: the frontendx console behavior inventory (`B-nn` behaviors, `D-nn` defects, `S-nn` security invariants,
`Q-nn` open questions; frontendx `stage` @ `f177008ea`, `src/modules/terminal/`) and the Query Table layout survey
(`dolusoft/query-table` `main` @ `670a8e1`). Both surveys are working notes outside the repository; every item this
spec depends on is restated here.

## 1. What this is

A headless command console for Vue 3: a scrollback of entries above one input line with a prompt. The user types a
line, the console parses it, runs the consumer's command for it and appends what the command returns. The library
owns the console's behavior (line editing keys, recall, completion, dispatch, cancellation, redaction of sensitive
lines, a context stack that changes the prompt); the consumer owns the commands, their meaning, every product text
and all styling.

It is not a terminal emulator. There is no PTY, no ANSI escape handling, no cursor addressing, no full-screen program.
`xterm.js` is the tool for that; this library is the tool for an in-app command line whose commands are JavaScript
functions.

Three packages, versioned together, published to npm under `@dolusoft`:

| Package | Contents | Dependencies |
| --- | --- | --- |
| `@dolusoft/command-protocol` | JSON types of entries, output blocks, command specs, requests, results, effects; the line tokenizer | none |
| `@dolusoft/command-console-core` | the console engine (`createConsole`), its features, the `shared/` contract, helpers | the protocol |
| `@dolusoft/command-console` | `useCommandConsole` and the `CommandConsole` component | core, protocol; `vue` peer |

First consumer: the settings console of `dolusoft/frontendx` (dolusoft/frontendx#1812). Everything that is Gecko
(`show`, `config`, `set`, masking of config values, permission checks, the config store, the loading overlay, the
welcome banner text) stays in frontendx.

### 1.1 Out of scope for 1.0

- A demo, playground or documentation site. The repository ships the library, its tests and its generated contract.
- Multi-line input and backslash line continuation (Q-02: dropped; a `\` is an ordinary character).
- Reverse incremental search (Ctrl+R) (Q-03: not in 1.0; can come in a minor release as a recall action).
- Persisted recall. The library never writes storage (P1); a consumer that persists recall does it from the
  controlled `recall` state and gets only lines that passed the redaction filter (S-03).
- Rendering raw HTML (Q-06: output is structured blocks; ADR 0005).
- Virtualised scrollback. Entries are bounded by an optional `maxEntries`; virtual rendering can come later.
- Typing ahead while a command runs (the input is read-only while busy, §6.4).
- Window chrome (title bar, buttons, fullscreen) (B-03).

## 2. Principles (become `PRINCIPLES.md`)

Each principle names the check that holds it. They are Query Table's P1–P15 carried over to a console.

**P1 The console renders; the consumer supplies the commands.** The library parses, dispatches and renders; what a
command means, which data it reads and where it sends it is the consumer's. No `fetch`, `XMLHttpRequest`,
`WebSocket`, `EventSource`, `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie` anywhere in `src/`.
Check: ESLint `no-restricted-globals`/`no-restricted-properties` over every package's `src/`; C-50.

**P2 Lasting state can be controlled; internal state is short-lived.** `entries`, `recall` and `context` can be owned
by the consumer (`state` + `on*Change`, TanStack v9 style) or left to the console. The input text, the recall cursor
and draft, the completion session and the running command are internal and die with the console. The console never
mutates objects it was given. Check: C-03, C-04; tests with deeply frozen inputs.

**P3 Every state change is defined.** Every user action (a key, a click, a method call) produces a specified,
ordered set of changes, and each controlled slice gets at most one `on*Change` call per action. Nothing changes on
mount. Check: C-05 and the per-action rules.

**P4 The protocol is plain JSON.** Entries, blocks, specs, requests, results, effects and context frames are JSON
values: they survive `JSON.parse(JSON.stringify(x))` unchanged. Functions (command handlers, completion providers,
predicates) live in core options, never in protocol types. Check: a JSON round-trip test over every entry the suite
produces (C-06); `pnpm api:check`.

**P5 No CSS, no styling props.** The packages ship no stylesheet, no `<style>`, no inline style, no `@keyframes`.
The only style-related write is `scrollTop` on the log element (C-44). Check: `pnpm check:package` (no `.css` in
`dist/` or the tarball) and the CSS leak scan; C-46 (no `style` attribute in the rendered DOM).

**P6 The DOM is public API.** The classes (`cc-*`) and `data-*` attributes listed in `contract/dom.ts` are the only
hooks a skin may select, and every rendered element carries only listed hooks. Check: the DOM contract browser test
(C-45).

**P7 Native semantics first; no hardcoded text.** Native elements (`input`, `ul`/`li`, `table`/`th scope="col"`,
`pre`) before ARIA. The library writes no human text of its own: core produces message *codes* (§5.3) and the Vue
package renders every text from the `labels` prop, with English defaults. Check: C-47 (no literal `aria-label="`
in any `.vue`), an axe-core scan of the rendered console (C-48).

**P8 Size is a budget, per consumer fixture.** Measured as a consumer pays it: a built app importing the package by
name minus the same app without it, minified + gzipped. Fixtures: protocol, core with core features only, core with
all features, the composable, the component. A budget is the last measure + 5%; a deliberate growth raises it in the
same change with a one-line reason. Check: `pnpm check:package-size`, `pnpm check:size`.

**P9 One small, typed surface per package.** Every published entry has a reviewed api-extractor report
(`packages/<name>/etc/*.api.md`). New surface is a minor, fixes are patches, never a major (ADR 0009). The three
packages share one version. Check: `pnpm api:check`, `tests/repo/package-manifest.spec.ts`.

**P10 Extension order: slot, event, prop, method; inside, feature first.** Publicly: a slot when the consumer draws,
an event when it reacts, a prop when the console needs data, a method only for an action that is not state. Inside:
behavior goes into a core feature first, a core helper second, Vue code last. Check: review; every prop, event, slot
and method rests on a C-rule (contract generator cross-check).

**P11 Dependencies are few and layered.** Protocol: none. Core: the protocol. Vue: core, protocol, `vue` as the only
peer (`^3.5`). No runtime dependency is added without an ADR. Check: `package-manifest.spec.ts`, `pnpm check:deps`,
`pnpm knip`.

**P12 Rule, test, code and generated docs move together.** A behavior change starts as a rule in
`contract/rules.md`, gets a test titled with the rule ID that asserts it, then code, then the regenerated
`CONTRACT.md`. Check: `tests/repo/contract-traceability.spec.ts`, `pnpm contract:check`.

**P13 Page layout is out of scope.** Panels, tabs, overlays, toasts, loaders and the size of the console belong to
the consumer. The console sets no size and no `overflow`; the consumer's CSS makes `.cc-log` scroll. The console
writes a scroll position only to keep the newest output in view (C-44). Check: review; C-46.

**P14 Layers point one way.** protocol → core → vue. Inside core, a feature imports only `shared/`, `helpers/` that
are pure, and the protocol; never another feature. Check: the ESLint `layers/boundaries` rule (copied from Query
Table, tested in `tests/repo/eslint-layers.spec.ts`), `pnpm check:deps`.

**P15 The core holds the console; there is no second copy.** The Vue package keeps no console state of its own: it
renders the core's state and forwards DOM events to core actions. The only Vue-side state is DOM-bound (the
element refs, the "stuck to bottom" flag of scrolling). Check: review; the composable test that drives the console
only through core actions and asserts the DOM.

**P16 Sensitive text never outlives its keystrokes.** A line the redaction predicate marks sensitive is never stored
in `entries`, `recall`, the completion session, an error message or any callback argument except the command request
handed to its handler. This holds on every path that ends a line: submit, cancel, a parse error, an unknown command,
a refused or failing command. Check: C-30..C-36 and a sweep test that serialises the whole console state and every
callback argument after each path and searches for the secret.

## 3. Architecture

### 3.1 Repository tree

```
command-console/
├─ packages/
│  ├─ command-protocol/
│  │  ├─ src/
│  │  │  ├─ index.ts
│  │  │  ├─ json.ts                 JsonValue, JsonPrimitive, isJsonValue
│  │  │  ├─ entry.ts                ConsoleEntry, InputEntry, OutputEntry
│  │  │  ├─ block.ts                OutputBlock union, MessageCode
│  │  │  ├─ command.ts              CommandSpec, CommandRequest, CommandResult, ConsoleEffect
│  │  │  ├─ context.ts              ContextFrame
│  │  │  ├─ completion.ts           CompletionRequest, CompletionResult
│  │  │  └─ syntax/
│  │  │     ├─ tokenize.ts          tokenize(line) → TokenizeResult
│  │  │     └─ quote.ts             quoteArgument(value)
│  │  ├─ etc/command-protocol.api.md
│  │  ├─ README.md  LICENSE  package.json  tsconfig.json  vite.config.ts
│  ├─ command-console-core/
│  │  ├─ src/
│  │  │  ├─ index.ts
│  │  │  ├─ core/
│  │  │  │  ├─ console/             constructConsole.ts, consoleFeature.ts, console.types.ts, console.utils.ts
│  │  │  │  ├─ entries/             entriesFeature.ts, entries.types.ts, entries.utils.ts
│  │  │  │  ├─ input/               inputFeature.ts, input.types.ts, input.utils.ts
│  │  │  │  └─ dispatch/            dispatchFeature.ts, dispatch.types.ts, dispatch.utils.ts
│  │  │  ├─ features/
│  │  │  │  ├─ recall/              recallFeature.ts, recall.types.ts, recall.utils.ts
│  │  │  │  ├─ completion/          completionFeature.ts, completion.types.ts, completion.utils.ts
│  │  │  │  ├─ context/             contextFeature.ts, context.types.ts, context.utils.ts
│  │  │  │  └─ redaction/           redactionFeature.ts, redaction.types.ts, redaction.utils.ts
│  │  │  ├─ shared/                 registry.ts, hooks.ts, effects.ts, keys.ts, lifecycle.ts, index.ts
│  │  │  ├─ store/                  createStore.ts (state + subscribe, no dependency)
│  │  │  └─ helpers/
│  │  │     ├─ consoleFeatures.ts   consoleFeatures({ ... }) typed feature set
│  │  │     ├─ coreFeatures.ts      the four core features
│  │  │     ├─ allFeatures.ts       core + every optional feature
│  │  │     └─ helpCommand.ts       createHelpCommand()
│  │  ├─ tests/                     feature-level specs, one describe per C-rule
│  │  ├─ etc/command-console-core.api.md
│  │  └─ README.md  LICENSE  package.json  tsconfig.json  vite.config.ts
│  └─ command-console/
│     ├─ src/
│     │  ├─ index.ts
│     │  ├─ use-command-console.ts  the composable
│     │  ├─ command-console.vue     the component
│     │  ├─ parts/                  entry-view.ts, block-view.ts (render functions)
│     │  ├─ dom/                    scroll.ts (stick to bottom), selection.ts, keys.ts (KeyboardEvent → KeyInput)
│     │  ├─ labels.ts               ConsoleLabels + English defaults
│     │  └─ contract.ts             ConsoleProps, ConsoleEmits, ConsoleSlots, ConsoleExpose (+ JSDoc)
│     ├─ etc/command-console.api.md
│     └─ README.md  LICENSE  package.json  tsconfig.json  vite.config.ts
├─ contract/
│  ├─ rules.md                      C-nn rules (§9)
│  └─ dom.ts                        listed classes and data attributes (§7.3)
├─ docs/decisions/                  0001…0010 + README.md index (§10)
├─ tests/
│  ├─ contract/unit/                Vue-level unit specs (happy-dom)
│  ├─ contract/browser/             Vue-level browser specs (Playwright Chromium)
│  ├─ repo/                         traceability, manifests, layers, no-css, pr-body …
│  ├─ fixtures/                     consumer-size fixture apps
│  └─ support/                      dom-collector.ts, helpers
├─ scripts/                         copied/adapted from Query Table (§11)
├─ .github/                         workflows ci.yml, pr-body.yml, release.yml; CODEOWNERS; PR template
├─ PRINCIPLES.md  CONTRACT.md (generated)  README.md  CONTRIBUTING.md  AGENTS.md  CLAUDE.md  LICENSE
└─ package.json  pnpm-workspace.yaml  tsconfig*.json  vitest.config.ts  eslint.config.js  knip.json  .prettierrc …
```

### 3.2 The engine (TanStack v9 shape, no TanStack dependency)

TanStack Table v9 is the model: an instance assembled from features, each feature a plain object, options merged
from feature defaults, state either internal or controlled. There is no TanStack package to depend on for a console,
so the engine is ours and small (ADR 0001).

```ts
interface ConsoleFeature<TOptions = {}, TState = {}, TApi = {}> {
  name: string
  getInitialState?(initial: Partial<ConsoleState>): Partial<TState>
  getDefaultOptions?(console: Console): Partial<TOptions>
  constructConsoleAPIs?(console: Console): void   // assigns its methods onto the instance
  init?(console: Console): void                    // registers shared/ hooks, effects, key actions
}

function createConsole<TFeatures extends ConsoleFeatures>(options: ConsoleOptions<TFeatures>): Console<TFeatures>
```

- `options.features` is a `consoleFeatures({ recallFeature, completionFeature, … })` object. The four core features
  (`consoleFeature`, `entriesFeature`, `inputFeature`, `dispatchFeature`) are always added. The instance type and the
  option type are computed from the feature set, as TanStack v9 does, so `console.recallPrevious` exists in the type
  only when `recallFeature` is in the set.
- State lives in a store (`getState()`, `subscribe(listener)`). A slice is **controlled** when `options.state[slice]`
  is defined: the console reads it from options and reports changes only through `options.on<Slice>Change(updater)`
  (`Updater<T> = T | ((old: T) => T)`), never writing it itself. Controllable slices: `entries`, `recall`, `context`.
  Every other slice is internal.
- `console.setOptions(updater)` replaces options (the Vue adapter calls it when props change). `console.reset()`
  returns every internal slice to its initial value and calls each controlled slice's `on*Change` with its initial
  value. `console.dispose()` aborts a running command, runs every disposer once and makes every later method a no-op
  (C-07).
- Notification: the store batches all changes of one action and notifies subscribers once at the end of it (C-05).

### 3.3 `shared/` — how features talk (ADR 0002)

Features never import each other. What one feature needs from another goes through a per-console record in
`shared/` (a `WeakMap` keyed by the instance, dropped on dispose, as in Query Table):

| Hook | Registered by | Called by | Purpose |
| --- | --- | --- | --- |
| `sensitivity` predicates | redaction | dispatch, input (cancel), completion | `isSensitive(line)`; true if any predicate says so |
| `onLineEnded(line, outcome)` | recall | dispatch (submit), input (cancel) | lets recall record; never called with a sensitive line |
| `promptProviders` | context | input, dispatch | the prompt string for the next input entry |
| `effectHandlers[type]` | each feature for its effects | dispatch | applies one `ConsoleEffect` |
| `keyActions[name]` | each feature for its keys | `console.handleKey` | the key map (§6.6) |
| `commandLookup` | dispatch | completion | command names, aliases, specs and `complete` of a name |
| `contextFrames` | context | dispatch, completion | the frames put into a request |
| `disposers` | every feature | `console.dispose()` | cleanup, once |

## 4. Protocol (`@dolusoft/command-protocol`)

All types are JSON (P4). Ids are strings.

```ts
type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

type ConsoleEntry = InputEntry | OutputEntry

interface InputEntry {
  id: string
  kind: 'input'
  prompt: string                 // the prompt as it was when the line was ended (B-05, D-17)
  text: string | null            // null when redacted
  redacted: boolean
  status: 'submitted' | 'cancelled'
}

interface OutputEntry {
  id: string
  kind: 'output'
  tone: 'default' | 'error' | 'notice'
  blocks: OutputBlock[]
  inputId?: string               // the input entry this output answers, when there is one
}

type OutputBlock =
  | { type: 'text'; text: string }
  | { type: 'json'; value: JsonValue }
  | { type: 'table'; columns: { key: string; label: string }[]; rows: Record<string, JsonPrimitive>[] }
  | { type: 'list'; items: string[] }
  | { type: 'message'; code: MessageCode; params?: Record<string, JsonPrimitive> } // library-generated; text from labels
  | { type: 'custom'; kind: string; data?: JsonValue }

type MessageCode =
  | 'command-not-found'          // params: { name }
  | 'command-failed'             // params: {} (no error text: S-06)
  | 'unterminated-quote'         // params: { index }
  | 'interrupted'                // a running command was cancelled

interface CommandSpec {
  name: string                   // non-empty, no whitespace
  aliases?: string[]
  summary?: string
  usage?: string
  hidden?: boolean               // not listed by help nor completed by name
}

interface CommandRequest {
  name: string                   // the name as typed (an alias stays an alias)
  command: string                // the canonical name of the matched spec
  args: string[]                 // tokens after the name, quotes removed
  rest: string                   // the raw text after the name and the whitespace that follows it
  line: string                   // the whole line, trimmed
  context: ContextFrame[]        // bottom → top, root excluded
}

type CommandResult =
  | void
  | string                                              // shorthand for one text block, tone default
  | OutputBlock[]                                       // tone default
  | { output?: string | OutputBlock[]; tone?: OutputEntry['tone']; effects?: ConsoleEffect[] }

type ConsoleEffect =
  | { type: 'clear' }                                   // entries ← []
  | { type: 'close' }                                   // ask the consumer to close the console
  | { type: 'push-context'; frame: ContextFrame }
  | { type: 'pop-context'; count?: number }             // default 1; popping past the root stops at the root
  | { type: 'reset-context' }
  | { type: 'clear-recall' }

interface ContextFrame { id: string; prompt: string; data?: JsonValue }

interface CompletionRequest {
  command: string | null         // null while completing the command name itself
  args: string[]                 // the complete arguments before the one being completed
  prefix: string                 // the typed part of the token at the caret, quotes removed
  index: number                  // the argument index being completed (0-based); -1 for the name
  context: ContextFrame[]
}
type CompletionResult = string[] | { candidates: string[]; final?: boolean } // final: append a space after a sole candidate (default true)
```

### 4.1 Line syntax (Q-05, D-10; ADR 0007)

`tokenize(line): { ok: true; tokens: Token[] } | { ok: false; error: { code: 'unterminated-quote'; index: number } }`,
`Token = { value: string; start: number; end: number; quoted: boolean }` (`start`/`end` in UTF-16 code units of
`line`, `end` exclusive).

- Separators are runs of whitespace (`\s`, so tabs too).
- `'…'` groups literally. `"…"` groups; inside it `\"` and `\\` are the only escapes. Outside quotes `\` is an
  ordinary character, so `C:\data` stays `C:\data`. Adjacent quoted and unquoted parts join one token (`a"b c"d` →
  `ab cd`).
- `""` and `''` produce an empty token.
- An unclosed quote is an error with the index of the opening quote; nothing is ever dropped silently.
- `quoteArgument(value)` returns the shortest form that tokenizes back to `value` (bare, else `'…'`, else `"…"` with
  escapes); completion uses it when it inserts a candidate.

## 5. Core (`@dolusoft/command-console-core`)

### 5.1 Options

```ts
interface ConsoleOptions {
  features?: ConsoleFeatures
  commands: CommandDefinition[]
  prompt?: string                                   // root prompt, default '>'
  initialState?: Partial<ConsoleState>              // e.g. initialState.entries = a banner
  state?: Partial<Pick<ConsoleState, 'entries' | 'recall' | 'context'>>
  onEntriesChange?(updater: Updater<ConsoleEntry[]>): void
  onRecallChange?(updater: Updater<string[]>): void
  onContextChange?(updater: Updater<ContextFrame[]>): void
  createId?(): string                               // default: per-instance counter 'e1', 'e2', …
  maxEntries?: number                               // drop the oldest beyond this; default unbounded
  beforeRun?(request: CommandRequest): CommandResult | false | Promise<CommandResult | false>
  onError?(error: unknown, request: CommandRequest): void
  formatError?(error: unknown, request: CommandRequest): CommandResult
  onClose?(): void                                  // the 'close' effect
  // feature options
  isSensitive?(line: string): boolean               // redaction
  recallLimit?: number                              // recall, default 100
  shouldRecord?(line: string): boolean              // recall, default () => true
  matchCandidate?(candidate: string, prefix: string): boolean // completion, default case-insensitive startsWith
  keyBindings?: Partial<Record<KeyActionName, KeyChord[] | null>>
}

interface CommandDefinition extends CommandSpec {
  run(request: CommandRequest, context: RunContext): CommandResult | Promise<CommandResult>
  complete?(request: CompletionRequest, signal: AbortSignal): CompletionResult | Promise<CompletionResult>
}

interface RunContext {
  signal: AbortSignal            // aborted on cancel and on dispose
  write(output: string | OutputBlock[], tone?: OutputEntry['tone']): void // appends while running; no-op after it ended
  inputId: string                // the id of the submitted input entry
}
```

### 5.2 State

```ts
interface ConsoleState {
  entries: ConsoleEntry[]
  input: { value: string; caret: number }
  running: { id: string; command: string; inputId: string } | null
  recall: string[]                                  // oldest → newest
  recallCursor: number | null                       // index into recall while browsing
  recallDraft: string | null                        // the input as it was before browsing
  completion: CompletionSession | null
  context: ContextFrame[]
}
interface CompletionSession {
  status: 'pending' | 'open' | 'none'
  candidates: string[]                              // already filtered by matchCandidate
  active: number                                    // -1 before the first cycle
  span: { start: number; end: number }              // the token being replaced
  original: string                                  // the token's text before completion, restored by Escape
}
```

Instance methods (core features): `getState`, `subscribe`, `setOptions`, `reset`, `dispose`, `setInput(value,
caret?)`, `submit()`, `run(line)` (as if typed and submitted), `cancel()` (cancels the running command, else the
line), `appendEntries(entries)`, `clearEntries()`, `getCommands()` (visible specs), `handleKey(input: KeyInput):
boolean` (true when handled, so the adapter prevents the default), `getPrompt()`. Optional features add
`recallPrevious`, `recallNext`, `clearRecall` (recall); `complete`, `completeNext`, `completePrevious`,
`closeCompletion` (completion); `pushContext`, `popContext`, `resetContext` (context); `isSensitive` (redaction).

`KeyInput = { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; selection: 'none'
| 'input' | 'document' }` — the adapter builds it, so core never sees a DOM event.

### 5.3 What core writes as text

Nothing. Library-generated output is a `message` block with a code; the Vue package turns it into text with
`labels` (P7). A redacted input entry has `text: null`; the Vue package renders `labels.redacted`.

### 5.4 Helpers

`createHelpCommand({ name?: 'help', aliases?: ['?'], title?: string })` returns a `CommandDefinition` whose result is
a `table` block of the visible commands (`usage ?? name`, `summary`), aliases joined after the name. Replaces the
hand-coloured `<pre>` of today (B-27).

## 6. Behavior

### 6.1 Submit (Enter)

In this order, all inside one action (one notification, C-05):

1. `line = input.value`. If `line.trim()` is empty: append an input entry with `text: ''`, clear the input, stop.
   Nothing is recorded, nothing runs (B-12).
2. `sensitive = isSensitive(line)` (any redaction predicate; false without the feature).
3. Append the input entry: the current prompt, `text: sensitive ? null : line.trim()`, `redacted: sensitive`,
   `status: 'submitted'`. Clear the input, the recall cursor and draft, and the completion session.
4. Unless `sensitive`, call `onLineEnded(line.trim(), 'submitted')` (recall records it, §6.3).
5. Tokenize. On error: append an error output entry with `{ type: 'message', code: 'unterminated-quote' }`. Stop.
6. Look up the first token among names and aliases: own properties of a `Map`, case-sensitive (D-09). Unknown:
   append an error output entry `command-not-found` with `params.name` = the first token (never the rest of the line;
   `null` when the line is sensitive, C-33). Stop.
7. Build the `CommandRequest`. Call `beforeRun(request)` if given: `false` stops silently; a result is applied as
   the command's result (step 9) and the handler does not run (S-07: redaction already happened in 3).
8. Run the handler. While it is pending, `running` is set and the input is read-only (§6.4). `write()` appends output
   entries as they come.
9. On fulfil: apply `effects` in array order (each through its feature's handler; an effect whose feature is absent
   is ignored), then append the output entry, if the result has output. Effects before output, so `clear` + banner
   output leaves only the banner (B-29).
10. On reject or throw: call `onError(error, request)`; append `formatError(error, request)` if given, else an error
    output entry `command-failed`. The error's text is never rendered by default (S-06, D-11).
11. Clear `running`. The input is writable again (exactly one input exists at any time: D-08).

A command that fulfils after it was cancelled or after `dispose` has no effect: its result, effects and `write`
calls are dropped (C-17).

### 6.2 Cancel (Ctrl+C) and copy

- If a command is running: abort its signal, append a `notice` output entry `interrupted`, clear `running` (C-16).
- Else: append the input line as an input entry with `status: 'cancelled'` (redacted if sensitive; the Vue package
  renders `labels.cancelledMarker`, default `^C`, after it), clear the input. Nothing is recorded (B-10).
- Copy is never taken over: if the keystroke comes with a selection inside the input or a non-empty document
  selection inside the console root, `handleKey` returns false and the browser copies (D-07). Cmd+C on macOS is
  never bound.

### 6.3 Recall (ArrowUp / ArrowDown) — `recallFeature`

- `recall` is oldest → newest, unique: recording a line already present moves it to the newest position (B-12).
- `shouldRecord(line)` and the redaction filter run before insertion (D-06); a sensitive line never reaches
  `onLineEnded`.
- Lines are recorded for unknown commands and failures too (Q-15: kept, shell-like).
- `recallLimit` (default 100) drops the oldest.
- ArrowUp: on first press store `recallDraft = input.value` and show the newest line; further presses go older and
  stop at the oldest. ArrowDown goes newer; past the newest it restores `recallDraft` and ends browsing (fixes the
  lost draft of B-12). Any edit of the input ends browsing and keeps the edited text.
- `clearRecall()` and the `clear-recall` effect empty the list and end browsing in one action (D-06).
- Without the feature ArrowUp/ArrowDown are not handled.

### 6.4 Running commands

- `running` is set from step 8 to step 11. While set, the input is read-only (not disabled, so it keeps focus and
  receives Ctrl+C), Enter and Tab do nothing, recall keys do nothing.
- There is no timeout. Long work is the consumer's to bound; the signal is how the library asks it to stop.
- The Vue package renders `data-busy` on the root and `aria-busy="true"` on the log while running, and a `busy` slot
  (Q-07: the consumer can show its overlay from the console's own state).

### 6.5 Completion (Tab / Shift+Tab / Escape) — `completionFeature` (Q-04, D-12)

1. Tab with no session: find the token at the caret (or an empty token when the caret follows whitespace). Token 0 →
   candidates are visible command names and aliases. Later tokens → the matched command's `complete(request,
   signal)`; a command without `complete`, or an unknown command, gives no candidates. Sensitive lines are completed
   normally (the line is only in the input), but the session never stores more than the candidates and the original
   token.
2. Filter with `matchCandidate(candidate, prefix)` (default: case-insensitive `startsWith`). Keep the provider's
   order; drop duplicates.
3. Zero candidates: `status: 'none'`, the input does not change (D-12). The session closes on the next key.
4. One candidate: replace the token with `quoteArgument(candidate)` and, if `final !== false` and the token was the
   last one, a space. Session closes.
5. Several: replace the token with their longest common prefix if it is longer than what was typed (case of the
   candidates wins), and open the session (`status: 'open'`, `active: -1`) so the adapter lists them. The next Tab
   sets `active` to 0 and writes that candidate into the span; further Tabs cycle forward with wrap-around, Shift+Tab
   backward. Arguments before and after the span are kept (D-12).
6. Escape restores `original` into the span and closes the session. Enter submits the line as it is and closes it.
   Any other key that edits the input closes the session and keeps the text.
7. Async providers: while pending `status: 'pending'`. If the input changes before the provider settles, the signal
   is aborted and the result dropped. A rejected provider closes the session silently.
8. The candidate list is session state, never an entry, so a Tab never freezes a line on screen (closes the S-04
   leak of B-16).

### 6.6 Keys

`handleKey` maps a `KeyInput` to an action through the key map. Defaults:

| Action | Chord | Feature |
| --- | --- | --- |
| `submit` | Enter | dispatch |
| `cancel` | Ctrl+C (no selection) | dispatch |
| `recallPrevious` / `recallNext` | ArrowUp / ArrowDown | recall |
| `completeNext` / `completePrevious` | Tab / Shift+Tab | completion |
| `closeCompletion` | Escape (only while a session is open) | completion |

`keyBindings` replaces chords per action; `null` unbinds. Every other key (characters, Backspace, Delete, arrows
left/right, Home/End, selection, paste, Ctrl+A) is the browser's native input behavior and is not handled (B-09).
Keys are listened to on the input element only, never on `window` or `document` (D-07). Submit is on `keydown`,
ignoring a key held during IME composition (`isComposing`).

### 6.7 Context — `contextFeature`

- `context` is a stack of frames, bottom → top, root implicit. The prompt of a new input entry is the top frame's
  `prompt`, or `options.prompt` at the root.
- Effects `push-context`, `pop-context`, `reset-context`; methods of the same names. Popping at the root does nothing
  and is not an error.
- Every request carries the current frames (`request.context`), so a handler knows where it runs. The meaning of a
  frame (a config service, a section) is the consumer's (B-35, B-36).
- An input entry keeps the prompt it was ended with; later context changes do not touch it (B-05, D-17).

### 6.8 Redaction — `redactionFeature`

- `isSensitive(line)` option; the feature also exposes `console.isSensitive(line)`. Recommended consumer predicate
  for frontendx: `/^\s*set(\s|$)/i` (Q-10: case-insensitive and any whitespace; closes `Set Password x` and
  `set\tPwd x`).
- Applied on every path that ends a line: submit (§6.1 step 2), cancel (§6.2), parse error and unknown command
  (they follow step 3), `beforeRun` refusal and handler failure (the entry was redacted before).
- A redacted input entry never contains the line, not even partially (no "first word" display). Labels supply the
  text (`labels.redacted`, default `(input hidden)`).
- The handler of a sensitive line receives the full request; what it outputs is the consumer's responsibility
  (masking stays in frontendx, S-05).

### 6.9 Entries

- Ids come from `createId` (default: a per-instance counter); no global or module state.
- `maxEntries` drops the oldest entries after an append (one change).
- The `clear` effect and `clearEntries()` set entries to `[]`. The library has no "banner after clear" concept: the
  command returns its banner as output after the effect (B-29).
- `initialState.entries` seeds the first screen (B-04; Q-01: no spacer line — a consumer that wants a gap adds it).

### 6.10 Lifecycle

- Nothing runs and no callback is called on creation (P3).
- `reset()`: aborts a running command (its late result is dropped), then entries, recall, context, input, completion
  return to initial values; controlled slices get one `on*Change` each (B-07, B-08 — cancel before clearing).
- `dispose()`: aborts a running command and a pending completion, runs disposers once, and every later method is a
  no-op returning a neutral value. Two consoles on one page share nothing (C-08).

## 7. Vue package (`@dolusoft/command-console`)

### 7.1 `useCommandConsole(options)`

Takes the core options (refs or getters allowed for reactive ones), creates the console once, calls `setOptions` when
reactive options change, subscribes to the store into a `shallowRef` snapshot, and disposes on scope dispose. Returns
`{ console, state }` (`state` is a readonly `ShallowRef<ConsoleState>`). No DOM work: usable with a fully custom
template.

### 7.2 `<CommandConsole>`

Props: every core option except `features` defaults to `allFeatures`, plus `labels?: Partial<ConsoleLabels>`,
`autofocus?: boolean` (default false), `entries`/`recall`/`context` for `v-model:entries` etc. (controlled when
bound). Events: `update:entries`, `update:recall`, `update:context`, `close` (the `close` effect; replaces the
`exitRequested` store flag, D-13), `submit` (`{ line: string | null, inputId }`, `line` null when sensitive). Slots:
`block` (`{ block, entry }`, used for `custom` blocks and as an override for any type), `prompt` (`{ prompt }`),
`busy` (`{ running }`), `completions` (`{ session, select }`). Expose: `focus()`, `run(line)`, `cancel()`,
`reset()`, `clear()`, `console` (the core instance).

### 7.3 DOM (listed in `contract/dom.ts`; P6)

```
div.cc-console [data-busy] [data-context-depth]
├─ div.cc-log  role="log" aria-live="polite" aria-relevant="additions" [aria-busy]
│  └─ div.cc-entry  data-kind="input|output"  data-tone  data-status  [data-redacted]
│     ├─ (input)  span.cc-prompt + span.cc-line (+ span.cc-cancelled)
│     └─ (output) one element per block, .cc-block data-type="text|json|table|list|message|custom"
│        text → pre · json → pre (JSON.stringify(value, null, 2)) · table → table/thead/th scope=col/tbody
│        list → ul/li · message → div · custom → slot `block`, fallback pre of JSON
├─ ul.cc-completions role="listbox" (only while a session is open)
│  └─ li.cc-completion role="option" aria-selected
└─ div.cc-input-line
   ├─ span.cc-prompt
   └─ input.cc-input type="text" role="combobox" aria-expanded aria-controls aria-activedescendant
                     aria-label=labels.input autocomplete="off" autocapitalize="off" spellcheck="false"
                     [readonly while running]
```

All text is escaped (Vue text interpolation; no `v-html` anywhere, enforced by lint, S-08).

### 7.4 Focus, selection, scroll

- `autofocus` focuses the input on mount. After each submit the input keeps focus (B-32).
- A click in the log focuses the input unless the document selection is non-empty (B-33), so selecting output keeps
  working.
- Scroll (Q-08): the log sticks to the bottom while the user is at the bottom (within 2 px) and after the user's own
  submit; when the user has scrolled up, new output does not move the view. One `ResizeObserver` on the log content,
  disconnected on unmount; its callback does nothing after unmount (D-04: no global error filter needed).
- No listener on `window` or `document` (D-07).

### 7.5 Labels

`input` ('Command'), `redacted` ('(input hidden)'), `cancelledMarker` ('^C'), `completions` ('Suggestions'),
`busy` ('Running…'), `messages: { 'command-not-found': (p) => \`${p.name}: command not found\`, 'command-failed':
'The command failed.', 'unterminated-quote': 'Unterminated quote.', interrupted: 'Interrupted.' }`.

## 8. Mapping to today's behavior (acceptance)

| Today | 1.0 | Rule |
| --- | --- | --- |
| B-02 size from outside | no size set; fills what the consumer's CSS gives | C-46 |
| B-04 initial screen | `initialState.entries`, no spacer (Q-01) | C-24 |
| B-05 prompt per mode, frozen per line | context frames; prompt snapshot in the entry | C-26, C-27 |
| B-07/B-08 cleanup on unmount and access loss | `reset()` / `dispose()`, cancel first | C-07, C-08, C-18 |
| B-09 native editing, Enter submits, trim | native input; keydown Enter; trimmed request | C-09 |
| B-10 Ctrl+C copy vs cancel | selection → native copy; else cancel line/command | C-15, C-16, C-52 |
| B-11 continuation, backslash stripping | dropped (Q-02); `\` literal | C-10 |
| B-12 recall | unique, newest-wins, draft kept, limit | C-19..C-23 |
| B-13 `set` not in recall | redaction before recording | C-31 |
| B-14 clear recall | `clear-recall` effect / `clearRecall()` | C-23 |
| B-16/B-17 completion | §6.5 (Q-04 shell-like) | C-37..C-43 |
| B-18 parsing | quoting, tabs separate (Q-05) | C-10, C-11 |
| B-19 handler arguments | `CommandRequest` | C-12 |
| B-20 lookup, not found | `Map`, message code | C-13 |
| B-21 `set` echo hidden | redaction before dispatch | C-30 |
| B-22 permission per run | `beforeRun` | C-14 |
| B-23 async, no prompt while waiting | `running`, read-only input, always restored | C-16, C-17 |
| B-24..B-28 output kinds | structured blocks, no HTML (Q-06) | C-28, C-29 |
| B-29 clear | `clear` effect then output | C-25 |
| B-30 overlay | consumer; `busy` slot and `data-busy` (Q-07) | C-44 |
| B-32/B-33 focus, selection | §7.4 | C-51 |
| B-34 scroll | stick when at bottom (Q-08) | C-44 |
| B-36 `exit` | `close` effect / event (D-13) | C-25 |
| D-01..D-03 | ESM, `vue` peer, own `.d.ts` | C-49 |
| S-01..S-04 | redaction on every path | C-30..C-36 |
| S-06 | `command-failed` without error text | C-34 |

B-01, B-06, B-15, B-31, B-35..B-39 and the masking (S-05) are consumer behavior and stay tested in frontendx.

## 9. Contract rules (become `contract/rules.md`)

Numbering is final for 1.0; later rules append. Each rule gets at least one test titled with its ID (P12).

- **C-01 Plain console.** `createConsole({ commands })` works with the core features only; optional feature methods
  are absent from the instance and its type.
- **C-02 Feature defaults.** Options are merged from feature defaults, then the given options; a later `setOptions`
  replaces options without losing defaults.
- **C-03 Inputs never mutated.** Options, `initialState`, controlled state, commands and their results are never
  written; deep-frozen inputs work through every action.
- **C-04 Controlled slices.** With `state.entries` (resp. `recall`, `context`) given, the console reads it from
  options, reports each change once per action through `onEntriesChange` (resp. …) with an updater, and draws what
  the consumer passes back, including a rejection (no change).
- **C-05 One notification per action.** Subscribers are notified once per action; nothing is notified or called on
  creation.
- **C-06 JSON state.** Every entry, block, request, result and frame the console produces survives a JSON round trip.
- **C-07 Dispose.** `dispose()` aborts running work, runs disposers once, and makes every later call a no-op.
- **C-08 Isolation.** Two consoles share no state, ids or timers; disposing one does not affect the other.
- **C-09 Submit.** Enter ends the line: an input entry with the current prompt and trimmed text, input cleared. An
  empty line adds an empty input entry and nothing else.
- **C-10 Tokenizer.** Whitespace (tabs included) separates; quotes group; escapes only inside `"…"`; `\` literal
  outside; nothing dropped; `quoteArgument` round-trips.
- **C-11 Unterminated quote.** Gives an error entry `unterminated-quote` with the index; nothing runs.
- **C-12 Request.** A handler gets one `CommandRequest` with `name`, `command`, `args`, `rest`, `line`, `context`.
- **C-13 Lookup.** Names and aliases are matched exactly as own entries; `toString`, `constructor`, `__proto__` and
  dotted names are unknown commands; unknown gives `command-not-found` with the first token only.
- **C-14 beforeRun.** Runs per submit after redaction and before the handler; `false` stops silently; a result is
  applied in place of the handler's.
- **C-15 Cancel line.** Ctrl+C without a selection and without a running command ends the line as `cancelled`,
  clears the input and records nothing; with a selection it is not handled.
- **C-16 Running state.** While a handler is pending `running` is set and Enter, Tab and recall do nothing; Ctrl+C
  aborts the signal and appends `interrupted`; the input is usable again in every outcome.
- **C-17 Late results dropped.** A result, effect or `write` after cancel, reset or dispose changes nothing.
- **C-18 Errors.** A throw or rejection calls `onError` and appends `formatError`'s result or `command-failed`
  without the error's text; the console keeps working.
- **C-19 Recall order.** Recall keeps unique lines oldest → newest; re-recording moves a line to the newest.
- **C-20 Recall browsing.** ArrowUp from the draft shows the newest and stops at the oldest; ArrowDown past the
  newest restores the draft.
- **C-21 Recall filter.** `shouldRecord` and sensitivity run before insertion; empty and cancelled lines are not
  recorded; unknown and failing lines are.
- **C-22 Recall limit.** `recallLimit` drops the oldest.
- **C-23 Clear recall.** `clearRecall()` and the `clear-recall` effect empty the list and end browsing in one action.
- **C-24 Initial entries.** `initialState.entries` is the first screen; no other entry is added on creation.
- **C-25 Effects.** Effects apply in order before the result's output; `clear` empties the entries, `close` calls
  `onClose` (Vue: `close` event); an effect without its feature is ignored.
- **C-26 Context stack.** `push-context`/`pop-context`/`reset-context` change the stack; popping at the root does
  nothing; requests carry the frames.
- **C-27 Prompt snapshot.** An input entry keeps the prompt it was ended with; the next prompt follows the top frame.
- **C-28 Results.** A string, a block array and a result object give the same entries for the same content; `void`
  gives no output entry.
- **C-29 Write while running.** `write()` appends output entries in call order before the final result.
- **C-30 Redacted submit.** A sensitive line gives an input entry with `text: null`, `redacted: true`, before
  anything runs.
- **C-31 Redacted recall.** A sensitive line is never in `recall` in any outcome.
- **C-32 Redacted cancel.** A sensitive line ended with Ctrl+C is redacted.
- **C-33 Redacted failures.** Parse error, unknown command, `beforeRun` refusal and handler failure of a sensitive
  line leave no trace of the line (not even the first token in `command-not-found`; the name is replaced by `null`).
- **C-34 No error text.** The default error entry carries no part of the error message.
- **C-35 No callback leak.** `submit` event, `onError` and every `on*Change` receive no sensitive text; only the
  handler's request carries it.
- **C-36 State sweep.** After every path of C-30..C-35 the JSON of the whole state and of every callback argument
  does not contain the secret.
- **C-37 Name completion.** Tab on the first token completes visible names and aliases.
- **C-38 Argument completion.** Tab on a later token asks the command's `complete` with `args`, `prefix`, `index`,
  `context`; no `complete` gives no candidates.
- **C-39 No candidates.** The input does not change.
- **C-40 One candidate.** The token is replaced (quoted when needed) and a space added unless `final: false` or the
  token is not the last.
- **C-41 Several candidates.** The longest common prefix is inserted when longer; the list opens; Tab/Shift+Tab cycle
  with wrap; text outside the span is kept; Escape restores the original token.
- **C-42 Async completion.** Pending state; a stale or rejected provider changes nothing.
- **C-43 Completion closes.** Any other edit closes the session and keeps the text; Enter submits as is.
- **C-44 Busy and scroll (Vue).** `data-busy`/`aria-busy` while running; the log sticks to the bottom only while at
  the bottom and after the user's submit; `scrollTop` is the only style-related write.
- **C-45 DOM contract (Vue).** The rendered DOM carries only the classes and attributes of `contract/dom.ts`, each
  on the element it is listed for.
- **C-46 No styles (Vue).** No element has a `style` attribute; no size or `overflow` is set.
- **C-47 Labels (Vue).** Every text comes from `labels`; no literal `aria-label` in a `.vue` file; message codes render
  through `labels.messages`.
- **C-48 Accessibility (Vue).** axe-core finds no violation; the log is `role="log"`; the input has a name; the
  completion list is a `listbox` tied to the input.
- **C-49 Packaging.** ESM only, own `.d.ts`, `vue` a peer, no alias or `optimizeDeps` needed by a consumer (D-01..D-03),
  checked by the pack-install test.
- **C-50 No transport, no storage.** No package reads or writes storage or the network.
- **C-51 Focus (Vue).** `autofocus` focuses on mount; a click in the log focuses the input unless text is selected.
- **C-52 Keys scoped (Vue).** Keys are handled on the input only; after unmount no listener remains; Ctrl+C with a
  selection is not prevented.
- **C-53 Key bindings.** `keyBindings` replaces or unbinds chords per action; IME composition is never handled.
- **C-54 Help helper.** `createHelpCommand` lists visible commands as a table block with usage and summary.
- **C-55 maxEntries.** Appending beyond `maxEntries` drops the oldest in the same change.

## 10. Decisions (become `docs/decisions/`)

Format as in Query Table: `NNNN-kebab-title.md`, `# NNNN Title`, `Status:` line, Context / Decision / Consequences /
Trade-off; the index rule "a record is not edited to change its decision; a new record supersedes it".

- **0001 Three packages and an engine of our own.** protocol → core → vue; TanStack v9's feature shape copied, no
  TanStack dependency (there is no TanStack console); a store of ~40 lines instead of `@tanstack/store`.
- **0002 Features and the shared contract.** Core features always present; recall, completion, context, redaction
  opt-in; features talk only through `shared/` (§3.3).
- **0003 State ownership.** `entries`, `recall`, `context` controllable; everything else internal; the library never
  persists anything (S-03).
- **0004 Composable and component.** `useCommandConsole` headless, `CommandConsole` on top of it; extension order slot,
  event, prop, method.
- **0005 Output is structured blocks, never HTML.** text/json/table/list/message/custom; custom through a slot; no
  `v-html` (S-08). Consequence for frontendx: highlight.js colouring of `show` moves into a `block` slot.
- **0006 Sensitive lines.** Redaction is a feature with a predicate, applied on every path that ends a line, before
  anything else sees the line (P16, S-01..S-04, S-07).
- **0007 Line syntax.** Shell-like quoting, `\` literal outside double quotes, no continuation (Q-02, Q-05, D-10).
- **0008 npm as the only distribution channel.** Trusted publishing behind the `release` environment; a GitHub Release
  with generated notes and no asset.
- **0009 Release versions.** Never a major; next minor or patch of the latest `v*` tag; the first release is `1.0.0`
  and the version check accepts it when no `v*` tag exists.
- **0010 CI on GitHub-hosted runners.** The repository is public: hosted minutes are free, and a self-hosted runner on
  a public repository would run code from fork pull requests on our network. `ubuntu-latest`, no OS matrix, no cron.

## 11. Tooling, checks, CI and release

Copied from Query Table and adapted (the survey's COPY/ADAPT verdicts):

- pnpm workspace, Node ≥ 22.18, TypeScript strict, Vite library mode per package (ESM, `dist/`), declarations by
  `tsc`, api-extractor reports in `etc/`.
- Vitest projects: `unit` (happy-dom; core + Vue unit + repo specs, coverage thresholds 90/90/90/90 on `packages/*/src`)
  and `browser` (Playwright Chromium; DOM contract, focus, selection, scroll, axe). No `measure` project in 1.0.
- ESLint 10 flat config with the layer rule, the storage/network ban, `vue/no-v-html: error`, a ban on `window` and
  `document` listeners in `packages/command-console/src` except `ownerDocument.getSelection`.
- Scripts: `gen-contract.mjs` (`CONTRACT.md` from `rules.md`, `dom.ts`, `contract.ts`, the component meta and the
  exports), `check-deps`, `check-no-css` + `check-css-leak`, `consumer-size` + `package-size`, `pack-install-test`
  (installs the three tarballs into a fresh Vite app without alias and builds it), `check-release-version` (with the
  first-release case), `check-pr-body`, `check-commit-trailers` (no AI co-author trailers), `test-browser.mjs`.
- `tests/repo`: `contract-traceability.spec.ts` + `test-names.ts` (sanity floor lowered to the 1.0 counts),
  `package-manifest.spec.ts`, `eslint-layers.spec.ts`, `no-css-leak.spec.ts`, `package-readme.spec.ts` (every package
  has `README.md` and `LICENSE` in its tarball).
- CI (`ci.yml`): jobs `checks` (lint, typecheck, contract:check, api:check, deps, knip, unit + coverage, build,
  no-css, sizes, pack-install), `browser`, then `verify` (requires both). `pr-body.yml` checks the PR template.
- Release (`release.yml`): on tag `v*`: version check, CI, pack the three tarballs, `npm` job behind the `release`
  environment publishing in order protocol → core → vue with `--provenance --access public`, then a GitHub Release.
  The first publish of the three new names is manual (trusted publishing is configured on an existing package); see
  the handover.
- Language: code, comments, docs, issues in English; commit messages and PR bodies in Turkish, PR template
  Belirti/Değişiklik/Doğrulama/ADR etkisi + `İlkeler:` / `Katman:` lines (as in Query Table).
- MIT license (as Query Table).

## 12. Test strategy

- Core: one spec file per feature in `packages/command-console-core/tests/`, a `describe('C-nn …')` per rule, fake
  commands, no DOM. Async rules with deferred promises, never timers.
- Protocol: tokenizer table tests plus a property test (random strings: tokenize ∘ quote round trip; no character
  dropped).
- Vue unit (happy-dom): props → core options, events, slots, labels, expose.
- Vue browser (Chromium): DOM contract collector rooted at `.cc-console`, keyboard through real key events, selection
  + Ctrl+C copy, click-to-focus with a selection, scroll stickiness, axe in light and dark color schemes (no skin, so
  only structure and names are scanned), listener leak check after unmount.
- Security sweep (C-36): a matrix of paths × a secret, serialising state and callback arguments.
- A frontendx-shaped fixture (in `tests/fixtures/`, not shipped): `show`/`config`/`set`/`end`/`exit`/`help`
  implemented with fake data, used by the browser tests to replay the B-items end to end.

## 13. Where the parts go after acceptance

§2 → `PRINCIPLES.md`; §3–§7 → `README.md` (usage) and package READMEs; §9 → `contract/rules.md`; §7.3 →
`contract/dom.ts`; §10 → `docs/decisions/`; §11 → `CONTRIBUTING.md` and `AGENTS.md`; this file is deleted.

## 14. Handover items (outside the code)

- GitHub settings: `release` environment (reviewers as Query Table, tags `v*`), branch protection on `main` (`verify`,
  `pr-body`, code owner review), CODEOWNERS.
- npm: first publish of the three names by hand, then a trusted publisher per package.
- frontendx migration (dolusoft/frontendx#1812): replace `vue-command`, remove the `vue` alias, the `optimizeDeps`
  entry, `types/vue-command.d.ts` and the `entry-client.ts` error filter; port commands to `CommandDefinition`; move
  the `set` regex to `isSensitive` (case-insensitive); render `show` with highlight.js in the `block` slot; key the
  overlay on `running`.
