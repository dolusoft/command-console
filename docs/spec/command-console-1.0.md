# Command Console 1.0 — specification

Status: draft v3, final (2026-10-26). v1 and v2 were each reviewed by an independent reviewer (25 and 20 findings,
all accepted after verification; the change logs are §15 and §16). Its parts move into the repository's real
documents (§13) and this file is deleted in the same change.

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
| `@dolusoft/command-protocol` | JSON types of entries, output blocks, command specs, responses, effects, frames; the line tokenizer | none |
| `@dolusoft/command-console-core` | the console engine (`createConsole`), its features, the `shared/` contract | the protocol |
| `@dolusoft/command-console` | `useCommandConsole` and the `CommandConsole` component | core, protocol; `vue` peer |

First consumer: the settings console of `dolusoft/frontendx` (dolusoft/frontendx#1812). Everything that is Gecko
(`show`, `config`, `set`, masking of config values, permission checks, the config store, the loading overlay, the
welcome banner text, the help text) stays in frontendx.

### 1.1 Out of scope for 1.0

- A demo, playground or documentation site. The repository ships the library, its tests and its generated contract.
- Multi-line input and backslash line continuation (Q-02: dropped; a `\` is an ordinary character).
- Reverse incremental search (Ctrl+R) (Q-03: can come in a minor release as a recall action).
- Persisted recall. The library never writes storage (P1); a consumer that persists recall does it from the
  controlled `recall` state, which never holds a sensitive line (S-03).
- Raw HTML output (Q-06: output is structured blocks; ADR 0005).
- A public plugin API. The engine is feature-shaped inside, but 1.0 exports a fixed set of features; third-party
  features can come later (ADR 0002).
- A help command helper. The consumer builds help from `console.getCommands()` (it owns the text anyway).
- Virtualised scrollback (`maxEntries` bounds it), typing ahead while a command runs, window chrome (B-03).
- Asynchronous completion providers, configurable key bindings and a custom candidate matcher. Each can come in a
  minor release; the frontendx console needs none of them (its candidates are in memory).

## 2. Principles (become `PRINCIPLES.md`)

Each principle names the check that holds it. They are Query Table's P1–P15 carried over to a console, plus P16.

**P1 The console renders; the consumer supplies the commands.** The library parses, dispatches and renders; what a
command means, which data it reads and where it sends it is the consumer's. No `fetch`, `XMLHttpRequest`,
`WebSocket`, `EventSource`, `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie` in any `src/`.
Check: ESLint restricted globals/properties over every package's `src/`; C-50.

**P2 Lasting state can be controlled; internal state is short-lived.** `entries`, `recall` and `context` can be owned
by the consumer (§3.4) or left to the console. The input text, the recall cursor and draft, the completion session
and the running command are internal and die with the line, the run or the console. The console never mutates
objects it was given. Check: C-03, C-04; tests with deeply frozen inputs.

**P3 Every state change is defined.** An action is one synchronous step (§3.3). Each action makes a specified, ordered
set of changes, notifies subscribers at most once, and calls each controlled slice's `on*Change` at most once.
Nothing changes and nothing is called on creation. Check: C-05 and the per-action rules.

**P4 The protocol is plain JSON.** Entries, blocks, specs, responses, effects and frames are JSON values: finite
numbers only, no `undefined`, and they survive `JSON.parse(JSON.stringify(x))` unchanged. Functions (handlers,
completion providers, predicates) live in core options, never in protocol types. Check: C-06; `pnpm api:check`.

**P5 No CSS, no styling props.** The packages ship no stylesheet, no `<style>`, no inline style, no `@keyframes`. The
only style-related write is `scrollTop` on the log element (C-58). The rule covers the elements the library renders;
slot content is the consumer's (§7.3). Check: `pnpm check:package` (no `.css` in `dist/` or the tarball), the CSS leak
scan, C-46.

**P6 The DOM is public API.** The classes (`cc-*`), `data-*` attributes and ids listed in `contract/dom.ts` are the only
hooks a skin may select, and every element the library renders carries only listed hooks. Check: C-45.

**P7 Native semantics first; no hardcoded text.** Native elements (`input`, `ul`/`li`, `table`/`th scope="col"`,
`pre`) before ARIA. Core writes no human text: it produces message codes (§5.4), and the Vue package renders every
text from the `labels` prop, with English defaults. Check: C-47, C-48.

**P8 Size is a budget, per consumer fixture.** Measured as a consumer pays it: a built app importing the package by
name minus the same app without it, minified + gzipped. Fixtures: protocol, core with core features, core with all
features, the composable, the component. A budget is the last measure + 5%; a deliberate growth raises it in the same
change with a one-line reason. Check: `pnpm check:package-size`, `pnpm check:size`.

**P9 One small, typed surface per package.** Every published entry has a reviewed api-extractor report. New surface is
a minor, fixes are patches, never a major (ADR 0009). The three packages share one version. Check: `pnpm api:check`,
`tests/repo/package-manifest.spec.ts`.

**P10 Extension order: slot, event, prop, method; inside, feature first.** Publicly: a slot when the consumer draws,
an event when it reacts, a prop when the console needs data, a method only for an action that is not state. Inside:
behavior goes into a core feature first, Vue code last. Check: review; every prop, event, slot and method rests on a
C-rule (contract generator cross-check).

**P11 Dependencies are few and layered.** Protocol: none. Core: the protocol. Vue: core, protocol, `vue` as the only
peer (`^3.5`). No runtime dependency without an ADR. Check: `package-manifest.spec.ts`, `pnpm check:deps`, `pnpm knip`.

**P12 Rule, test, code and generated docs move together.** A behavior change starts as a rule in `contract/rules.md`,
gets a test titled with the rule ID that asserts it, then code, then the regenerated `CONTRACT.md`. Check:
`tests/repo/contract-traceability.spec.ts`, `pnpm contract:check`.

**P13 Page layout is out of scope.** Panels, tabs, overlays, toasts, loaders and the console's size belong to the
consumer. The console sets no size and no `overflow`; the consumer's CSS makes `.cc-log` scroll. The console writes a
scroll position only to keep the newest output in view (C-58). Check: review; C-46.

**P14 Layers point one way.** protocol → core → vue. Inside core, an optional feature imports only `shared/`, the
store and the protocol; never another feature. Check: the ESLint `layers/boundaries` rule (copied from Query Table,
tested in `tests/repo/eslint-layers.spec.ts`), `pnpm check:deps`.

**P15 The core holds the console; there is no second copy.** The Vue package keeps no console state of its own: it
renders the core's state and forwards DOM events to core actions. Vue-side state is DOM-bound only (element refs, the
"stuck to bottom" flag, the input element's key). Check: review; the composable test that drives the console only
through core actions and asserts the DOM.

**P16 A sensitive line leaves no trace in what the library keeps or hands out.** Scope: everything the library
creates or passes on after a sensitive line ends — `entries`, `recall`, the recall draft, the completion session,
message parameters, every callback and event argument, the rendered DOM and its accessibility tree, and the input
element that held the line. The exceptions are explicit: the live input while the user types it, the `CommandRequest`
given to the matched command's own `run`, and the safe argument positions given to its `complete` (§6.8). What a
command outputs, what its own errors carry, and what the consumer puts into controlled state, is the consumer's.
Check: C-30..C-36, C-54, C-69, the leak matrix (§12).

Not guaranteed, because the library cannot reach it: the IME's own history, the operating system's keyboard
suggestions, the speech and braille history of a screen reader that read the line while it was typed, the operating
system clipboard history, and browser form restore and autofill. The last is mitigated by rendering the input outside
any form, without a `name`, with `autocomplete="off"` (C-69).

## 3. Architecture

### 3.1 Repository tree

```
command-console/
├─ packages/
│  ├─ command-protocol/
│  │  ├─ src/
│  │  │  ├─ index.ts
│  │  │  ├─ json.ts                 JsonValue, JsonPrimitive, isJsonValue (finite numbers)
│  │  │  ├─ entry.ts                ConsoleEntry, InputEntry, OutputEntry
│  │  │  ├─ block.ts                OutputBlock, MessageCode
│  │  │  ├─ command.ts              CommandSpec, CommandResponse, ConsoleEffect
│  │  │  ├─ context.ts              ContextFrame
│  │  │  └─ syntax/                 tokenize.ts, quote.ts
│  │  ├─ etc/command-protocol.api.md
│  │  └─ README.md  LICENSE  package.json  tsconfig.json  vite.config.ts
│  ├─ command-console-core/
│  │  ├─ src/
│  │  │  ├─ index.ts
│  │  │  ├─ core/
│  │  │  │  ├─ console/             constructConsole.ts, consoleFeature.ts, console.types.ts, console.utils.ts
│  │  │  │  ├─ entries/             entriesFeature.ts, entries.types.ts, entries.utils.ts
│  │  │  │  ├─ input/               inputFeature.ts, input.types.ts, input.utils.ts
│  │  │  │  └─ dispatch/            dispatchFeature.ts, dispatch.types.ts, dispatch.utils.ts, sensitivity.ts
│  │  │  ├─ features/
│  │  │  │  ├─ recall/              recallFeature.ts, recall.types.ts, recall.utils.ts
│  │  │  │  ├─ completion/          completionFeature.ts, completion.types.ts, completion.utils.ts
│  │  │  │  └─ context/             contextFeature.ts, context.types.ts, context.utils.ts
│  │  │  ├─ shared/                 registry.ts, hooks.ts, effects.ts, keys.ts, lifecycle.ts, index.ts
│  │  │  ├─ store/                  createStore.ts, action.ts (action boundary, slice updates)
│  │  │  └─ helpers/                consoleFeatures.ts, coreFeatures.ts, allFeatures.ts
│  │  ├─ tests/                     feature-level specs, one describe per C-rule
│  │  ├─ etc/command-console-core.api.md
│  │  └─ README.md  LICENSE  package.json  tsconfig.json  vite.config.ts
│  └─ command-console/
│     ├─ src/
│     │  ├─ index.ts
│     │  ├─ use-command-console.ts
│     │  ├─ command-console.vue
│     │  ├─ parts/                  entry-view.ts, block-view.ts, completions-view.ts (render functions)
│     │  ├─ dom/                    scroll.ts, selection.ts, keys.ts (KeyboardEvent → KeyInput), focus.ts
│     │  ├─ labels.ts               ConsoleLabels + English defaults
│     │  └─ contract.ts             ConsoleProps, ConsoleEmits, ConsoleSlots, ConsoleExpose (+ JSDoc)
│     ├─ etc/command-console.api.md
│     └─ README.md  LICENSE  package.json  tsconfig.json  vite.config.ts
├─ contract/                        rules.md (§9), dom.ts (§7.3)
├─ docs/decisions/                  0001…0010 + README.md index (§10)
├─ tests/
│  ├─ contract/unit/                Vue-level unit specs (happy-dom)
│  ├─ contract/browser/             Vue-level browser specs (Playwright Chromium)
│  ├─ repo/                         traceability, manifests, layers, no-css, readme …
│  ├─ fixtures/                     consumer-size apps; the frontendx-shaped command set
│  └─ support/                      dom-collector.ts, leak-matrix.ts, helpers
├─ scripts/                         copied/adapted from Query Table (§11)
├─ .github/                         ci.yml, pr-body.yml, release.yml; CODEOWNERS; PR template
├─ PRINCIPLES.md  CONTRACT.md (generated)  README.md  CONTRIBUTING.md  AGENTS.md  CLAUDE.md  LICENSE
└─ package.json  pnpm-workspace.yaml  tsconfig*.json  vitest.config.ts  eslint.config.js  knip.json  .prettierrc …
```

### 3.2 The engine (TanStack v9 shape, no TanStack dependency)

TanStack Table v9 is the model: an instance assembled from features, each feature a plain object, options merged from
feature defaults, state either internal or controlled. There is no TanStack console, so the engine is ours and small
(ADR 0001).

```ts
// internal in 1.0: not exported (ADR 0002)
interface ConsoleFeature {
  name: 'console' | 'entries' | 'input' | 'dispatch' | 'recall' | 'completion' | 'context'
  getInitialState?(initial: InitialState): Partial<ConsoleState>
  getDefaultOptions?(): Partial<ConsoleOptions>
  constructConsoleAPIs?(console: Console): void   // assigns its methods onto the instance
  init?(console: Console): void                   // registers shared/ hooks, effects, key actions
}

// exported
interface OptionalFeatures { recallFeature: RecallFeature; completionFeature: CompletionFeature; contextFeature: ContextFeature }
export const recallFeature, completionFeature, contextFeature
export function consoleFeatures<T extends Partial<OptionalFeatures>>(features: T): T
export function createConsole<T extends Partial<OptionalFeatures> = {}>(options: ConsoleOptions<T>): Console<T>
```

- The four core features (`console`, `entries`, `input`, `dispatch`) are always present. `options.features` is an
  object keyed by `recallFeature` / `completionFeature` / `contextFeature` (the only key set, used by the types and the
  runtime alike). The instance type is computed from a fixed feature → API map, as TanStack v9 computes its table
  type; the type parameter defaults to `{}` so a console created without `features` has no optional methods (verified:
  without the default, `T` infers as its constraint and every optional method type-checks). Negative type tests
  (`@ts-expect-error`) hold it (C-01).
- Features are constructed in a fixed order (console, entries, input, dispatch, recall, completion, context). This and
  "no feature overwrites another's method" are internal invariants tested inside `src/`, not contract rules.
- `setOptions(updater)` replaces options; it cannot change the feature set (a different set throws) and validates
  commands again (§5.1).

### 3.3 Actions and notification

An **action** is one synchronous step that starts from one trigger: a key handled by `handleKey`, a method call, the
settling of a promise (`beforeRun`, a command's run), or a `write()` call. A command run is therefore several actions:
its start, each asynchronous `write()`, and its end (fulfil, reject or cancel).

**Nesting.** A method call or `write()` made while an action is open (synchronously from `run`, `beforeRun`, a
callback, or a subscriber) joins that action: its changes go to the same working copy, in call order, and are
committed with it. A synchronous return of `beforeRun` or `run` continues in the same action. So `run(r, ctx) {
ctx.write('a'); ctx.write('b'); return 'c' }` is one action: one notification, input entry then `a`, `b`, `c` (C-60).

Inside an action, every change goes to a working copy of the state. At the end of the outermost action:

1. each controlled slice that changed gets exactly one `on<Slice>Change(updater)` call; the updater composes every
   change of the action, in order, onto the value it is given (so two `write()`s or two effects in one action are
   never lost, C-04);
2. internal slices are committed;
3. subscribers are notified once.

**Base of a controlled slice.** An action starts from the value the console last reported for the slice, until either
`setOptions` delivers a new `state[slice]` (that value wins, whether it accepts, rejects or edits the report) or the
microtask after the report runs (one `Promise.resolve().then`, the only scheduling core ever does); after that the
base is `options.state[slice]` again. So two actions in one tick never lose each other's changes, and a consumer that
ignores a report gets its own value back on the next tick (same model as Query Table ADR 0004).

Callbacks (`on*Change`, `onClose`, `onError`) are called after the commit; an exception in one is caught, reported
through `onError` (or rethrown asynchronously when `onError` is the thrower), and does not stop the remaining
callbacks or the action's cleanup.

### 3.4 Controlled slices

`entries`, `recall` and `context` are controlled when `options.state[slice]` is defined. The console then reads the
slice from options, never writes it, and reports changes through `on<Slice>Change(updater: Updater<T>)` (`T | (old:
T) => T`). `state.x` wins over `initialState.x` when both are given.

The Vue component emits plain values for `v-model` (`update:entries` etc.). It resolves each updater against its own
`lastEmitted[slice]` if set, else the prop, and clears `lastEmitted[slice]` when the prop changes; so a second action
in the same tick builds on the first one's emitted value, not on a prop the parent has not re-rendered yet.

An external change of `recall` ends recall browsing. An external change of `context` counts as a context change for
§6.7 when the sequence of frame ids differs (`frames.map(f => f.id)`); a new array with the same ids is not a change.

### 3.5 `shared/` — how features talk (ADR 0002)

Optional features never import each other or the core feature folders. What one needs from another goes through a
per-console record in `shared/` (a `WeakMap` keyed by the instance, dropped on dispose, as in Query Table):

| Hook | Registered by | Called by | Purpose |
| --- | --- | --- | --- |
| `onLineSubmitted(line)` | recall | dispatch | recall records; never called for a sensitive, empty or cancelled line |
| `onLineCleared()` | recall, completion | dispatch (every end of a line), `reset` | drop the draft, cursor, session |
| `promptProvider` | context | dispatch | the prompt string for the next input entry |
| `contextSnapshot` / `contextRevision` | context | dispatch, completion | frames for a request; change detection (by id sequence) |
| `effectHandlers[type]` | each feature for its effects | dispatch | applies one `ConsoleEffect` |
| `keyActions[name]` | each feature for its keys | `handleKey` | the key map (§6.6) |
| `commandLookup` | dispatch | completion | resolve a name, list visible specs, sensitivity |
| `disposers` | every feature | `dispose` | cleanup, once |

## 4. Protocol (`@dolusoft/command-protocol`)

All types are JSON (P4). Ids are strings. An optional field that has no value is absent, never `undefined`.

```ts
type JsonPrimitive = string | number | boolean | null          // numbers finite
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

type ConsoleEntry = InputEntry | OutputEntry

interface InputEntry {
  id: string
  kind: 'input'
  prompt: string                 // the prompt when the line ended (B-05, D-17)
  text: string | null            // null when redacted
  redacted: boolean
  status: 'submitted' | 'cancelled'
}

interface OutputEntry {
  id: string
  kind: 'output'
  tone: 'default' | 'error' | 'notice'
  blocks: OutputBlock[]
  inputId?: string               // the input entry this output answers
  quiet?: true                   // not announced by the live region (long output such as a whole config)
}

type OutputBlock =
  | { type: 'text'; text: string }
  | { type: 'json'; value: JsonValue }
  | { type: 'table'; columns: { key: string; label: string }[]; rows: Record<string, JsonPrimitive>[] }
  | { type: 'list'; items: string[] }
  | { type: 'message'; code: MessageCode; params?: Record<string, JsonPrimitive> } // library-made; text from labels
  | { type: 'custom'; kind: string; data?: JsonValue }

type MessageCode =
  | 'command-not-found'          // params: { name: string | null } (null when the line is sensitive)
  | 'command-failed'             // no params: the error text is never shown (S-06)
  | 'unterminated-quote'         // params: { index: number | null } (null when the line is sensitive)
  | 'interrupted'                // a running command was cancelled

interface CommandSpec {
  name: string                   // non-empty, no whitespace, no quote characters
  aliases?: string[]
  summary?: string
  usage?: string
  hidden?: boolean               // not listed by getCommands, not completed by name
  sensitive?: boolean | { fromArg: number } // true ≡ { fromArg: 0 }: arguments at and after fromArg are secret
}

interface CommandResponse {
  output?: string | OutputBlock[]  // a string is one text block
  tone?: OutputEntry['tone']       // default 'default'
  quiet?: true                     // copied to the output entry
  effects?: ConsoleEffect[]
}

type ConsoleEffect =
  | { type: 'clear' }                         // entries ← []
  | { type: 'close' }                         // ask the consumer to close the console
  | { type: 'push-context'; frame: ContextFrame }
  | { type: 'pop-context'; count?: number }   // default 1; stops at the root
  | { type: 'reset-context' }
  | { type: 'clear-recall' }

interface ContextFrame { id: string; prompt: string; data?: JsonValue }
```

Core-only types (functions or values that are not JSON) are in §5.1.

### 4.1 Line syntax (Q-05, D-10; ADR 0007)

```ts
function tokenize(line: string): TokenizeResult
type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; tokens: Token[]; error: { code: 'unterminated-quote'; index: number } }
interface Token { value: string; start: number; end: number; quoted: boolean; open: boolean }
function quoteArgument(value: string): string
```

- Separators are runs of whitespace (`\s`, so tabs too). `start`/`end` are UTF-16 offsets into `line`, `end`
  exclusive, covering the raw text of the token including its quotes.
- `'…'` groups literally. `"…"` groups; inside it `\"` and `\\` are the only escapes. Outside quotes `\` is an ordinary
  character, so `C:\data` stays `C:\data`. Adjacent parts join one token (`a"b c"d` → `ab cd`). `""` and `''` give an
  empty token.
- An unclosed quote gives `ok: false` with the index of the opening quote. The tokens are still returned (tolerant):
  the last one has `open: true` and runs to the end of the line. Dispatch refuses an `ok: false` line; completion uses
  the tolerant tokens. Nothing is ever dropped silently.
- `quoteArgument(value)` returns the shortest form that tokenizes back to `value` (bare, else `'…'`, else `"…"` with
  escapes).

## 5. Core (`@dolusoft/command-console-core`)

### 5.1 Options and command definitions

```ts
interface ConsoleOptions<TFeatures> {
  features?: TFeatures
  commands: CommandDefinition[]
  prompt?: string                                   // root prompt, default '>'
  initialState?: { entries?: ConsoleEntry[]; recall?: string[]; context?: ContextFrame[] }
  state?: { entries?: ConsoleEntry[]; recall?: string[]; context?: ContextFrame[] }
  onEntriesChange?(updater: Updater<ConsoleEntry[]>): void
  onRecallChange?(updater: Updater<string[]>): void
  onContextChange?(updater: Updater<ContextFrame[]>): void
  createId?(): string                               // default: per-instance counter, see §6.9
  maxEntries?: number                               // drop the oldest beyond this; default unbounded
  beforeRun?(info: RunInfo, signal: AbortSignal): BeforeRunResult | Promise<BeforeRunResult>
  onError?(error: unknown, info: RunInfo): void
  formatError?(error: unknown, info: RunInfo): CommandResponse
  onClose?(): void                                  // the 'close' effect
  isSensitive?(line: string): boolean               // extra predicate, OR-ed with command sensitivity (§6.8)
  recallLimit?: number                              // recall, default 100
  shouldRecord?(line: string): boolean              // recall, default () => true
}

// undefined: go on; false: stop silently; a response: handled exactly like a fulfilled run (effects, then output)
type BeforeRunResult = undefined | false | CommandResponse

interface RunInfo {                                 // never contains arguments or the line
  runId: string
  inputId: string
  name: string | null                               // as typed; null when sensitive
  command: string                                   // the canonical name
  sensitive: boolean
  context: ContextFrame[]
}

interface CommandDefinition extends CommandSpec {
  run(request: CommandRequest, run: RunContext): CommandReturn | Promise<CommandReturn>
  complete?(request: CompletionRequest): CompletionResult  // synchronous in 1.0; async providers can come in a minor
}
type CommandReturn = void | string | OutputBlock[] | CommandResponse

interface CommandRequest {
  name: string                   // the name as typed (an alias stays an alias)
  command: string                // the canonical name
  args: string[]                 // tokens after the name, quotes removed
  rest: string                   // the raw text after the name and the whitespace that follows it
  line: string                   // the whole line, trimmed
  context: ContextFrame[]        // snapshot at submit, bottom → top, root excluded
}

interface RunContext {
  runId: string
  inputId: string
  signal: AbortSignal            // aborted on cancel, reset, dispose and a context change by someone else (§6.7)
  write(output: string | OutputBlock[], tone?: OutputEntry['tone']): void // joins an open action, else its own; no-op once the run ended
}

interface CompletionRequest {
  command: string | null         // null while completing the command name
  args: string[]                 // the complete arguments before the one being completed (only safe positions)
  prefix: string                 // typed part of the token at the caret, quotes removed
  index: number                  // argument index being completed, 0-based; -1 for the name
  context: ContextFrame[]
}
// candidates are filtered by the library: case-insensitive startsWith(prefix); final: append a space (default true)
type CompletionResult = string[] | { candidates: string[]; final?: boolean }
```

`onError` and `formatError` receive the error exactly as the command threw it. The library never adds the line, its
tokens or the request to an error; the error object itself is the command's (an HTTP client error may carry a request
body), so masking it is the consumer's (P16).

Command validation, at creation and at every `setOptions`: names and aliases are non-empty, contain no whitespace or
quote, and are unique across all names and aliases; `fromArg` is a non-negative integer. A violation throws (C-56).

### 5.2 State

```ts
interface ConsoleState {
  entries: ConsoleEntry[]
  input: { value: string; caret: number; revision: number } // revision changes when the element must be replaced (§7.4)
  running: { runId: string; command: string; inputId: string; phase: 'authorizing' | 'running' } | null
  recall: string[]                                  // oldest → newest
  recallCursor: number | null
  recallDraft: string | null
  completion: CompletionSession | null
  context: ContextFrame[]
}
interface CompletionSession {
  status: 'open' | 'none'
  candidates: string[]                              // filtered, deduplicated, provider order
  final: boolean
  active: number                                    // -1: none selected
  span: { start: number; end: number }              // the token's raw span in input.value, updated after each write
  original: string                                  // the token's raw text before the session
}
```

`initialState` accepts only `entries`, `recall` and `context`; every other slice starts empty.

Instance methods (core features):

- `getState`, `subscribe`, `setOptions`, `reset`, `dispose`, `setInput(value, caret?)`, `appendEntries`,
  `clearEntries`, `getPrompt()`, `isSensitive(line)`.
- `getCommands()`: the specs that are not `hidden`, in registration order, each with its aliases.
- `submit(): Promise<boolean>`: ends the live input as Enter does; resolves `true` after the run's end action (or at
  once when nothing runs: empty line, parse error, unknown command), `false` without doing anything when a run exists.
- `run(line): Promise<boolean>`: replaces the live input with `line` and submits it (the line-end cleanup applies to
  whatever the user had typed); same result as `submit()`.
- `cancel()`: the running command, else the live line (§6.2).
- `handleKey(input: KeyInput): boolean`: true when handled, so the adapter prevents the default.

Optional features add `recallPrevious`, `recallNext`, `clearRecall` (recall); `complete`, `completeNext`,
`completePrevious`, `acceptCompletion`, `closeCompletion` (completion); `pushContext`, `popContext`, `resetContext`
(context).

`KeyInput = { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; isComposing:
boolean; selection: 'none' | 'input' | 'document' }`. The adapter builds it; core never sees a DOM event.

### 5.3 Sensitivity

`sensitive(line)` is computed once when a line ends, from the tolerant tokens:

1. If the first token, compared case-insensitively, equals the name or an alias of a command with `sensitive`, the
   line is sensitive. Quotes do not matter (`"set"`, `'set'`, `s"et"` all resolve to `set`).
2. Else if `options.isSensitive?.(line)` returns true, it is sensitive.
3. If the predicate throws, the line is treated as sensitive.

The comparison is case-insensitive even though lookup is case-sensitive, so `Set Password x` is redacted and then
reported as an unknown command with `name: null` (S-04).

### 5.4 What core writes as text

Nothing. Library-made output is a `message` block with a code; the Vue package renders it with `labels` (P7). A
redacted input entry has `text: null`; the Vue package renders `labels.redacted`.

## 6. Behavior

### 6.1 Submit (Enter)

**Start action** (one action):

1. `line = input.value`. If `line.trim()` is empty: append an input entry with `text: ''`, run the line-end cleanup
   (step 4), stop. Nothing is recorded, nothing runs (B-12).
2. `sensitive = sensitive(line)` (§5.3).
3. Append the input entry: the current prompt, `text: sensitive ? null : line.trim()`, `redacted: sensitive`,
   `status: 'submitted'`.
4. Line-end cleanup (the same on every path that ends a line): clear the input, increment `input.revision` if the line
   was sensitive (§7.4), and call `onLineCleared` (recall drops cursor and draft, completion drops its session).
5. Unless `sensitive`, call `onLineSubmitted(line.trim())` (§6.3); this happens before tokenizing, so lines with an
   unterminated quote and unknown commands are recorded too.
6. Tokenize. `ok: false`: append an error output entry `unterminated-quote` (`index` null when sensitive). Stop.
7. Look up the first token exactly among registered names and aliases (`Map`, case-sensitive; a dot is an ordinary
   character, D-09). Unknown: error output entry `command-not-found` with `name` = the first token, or `null` when
   sensitive. Stop.
8. Create the run: `runId`, an `AbortController`, `running = { phase: 'authorizing' }` if `beforeRun` is given, else
   `'running'`, the context snapshot and revision. The input is read-only from here (§6.4).
9. If `beforeRun` is given, call it with `RunInfo` and the run's signal. A synchronous return continues in this
   action; a promise settles in its own action, guarded by the run id. `undefined` → step 10; `false` → end the run
   with no output; a response → end the run as a fulfil with that response (effects, then output). A throw or
   rejection → end the run as failed.
10. Set `phase: 'running'` and call `run(request, runContext)`. A synchronous return is handled as a fulfil in the
    same action.

**`write()`**: joins the open action if there is one, else is its own action (§3.3). If the run is still current it
appends an output entry (`inputId` set); otherwise it does nothing.

**End action** (fulfil, reject or cancel), guarded by the run id — a settle of a run that is no longer current does
nothing, calls nothing:

- Fulfil: normalise the return (`void` → nothing, string → one text block, array → blocks, response as is). Apply the
  effects in order (each through its feature's handler; an effect whose feature is absent is ignored; context effects
  are dropped if the context changed by someone else since the run started, §6.7), then append the output entry if
  there is output. Effects before output, so `clear` plus a banner leaves only the banner (B-29).
- Reject or throw: call `onError(error, info)`; if `formatError` is given, handle its response as a fulfil (effects,
  then output, tone `error` unless it sets one), else append an error output entry `command-failed`. If `formatError`
  throws, the default entry is used. The error's text is never rendered by default (S-06, D-11).
- In every case, in a `finally`: clear `running` if it still names this run. The input is writable again; exactly one
  input exists at any time (D-08).

### 6.2 Cancel (Ctrl+C) and copy

- Running command (either phase): first mark the run as no longer current, then abort its signal (so a synchronous
  abort listener that calls `write()` finds the run ended), append a `notice` output entry `interrupted`, clear
  `running`. One action.
- No running command: append the input line as an input entry with `status: 'cancelled'` (redacted if sensitive; the
  Vue package renders `labels.cancelledMarker`, default `^C`, after it), then the line-end cleanup. Nothing is
  recorded (B-10). An empty input still ends as a cancelled empty line, as a shell does.
- Copy is never taken over: with a selection inside the input or a non-empty document selection inside the console
  root, `handleKey` returns false and the browser copies (D-07). Cmd+C on macOS is never bound.

### 6.3 Recall (ArrowUp / ArrowDown) — `recallFeature`

- `recall` is oldest → newest, unique: recording a line already present moves it to the newest position (B-12).
  `shouldRecord(line)` runs before insertion; a sensitive line never reaches `onLineSubmitted` (D-06).
- Unknown commands, parse errors and failures are recorded too (Q-15: shell-like). Empty and cancelled lines are not.
- `recallLimit` (default 100) drops the oldest.
- ArrowUp (no completion open): on the first press keep `recallDraft = input.value` — unless the input is sensitive,
  then the draft is `''` — and show the newest line; further presses go older and stop at the oldest. ArrowDown goes
  newer; past the newest it restores the draft and ends browsing. Any edit of the input ends browsing and keeps the
  edited text. Each recalled line is also written to the status element (§7.3), because a screen reader does not
  announce a scripted value change in a focused field.
- `clearRecall()` and the `clear-recall` effect empty the list and end browsing in one action.
- An external change of a controlled `recall` ends browsing.
- Without the feature ArrowUp/ArrowDown are not handled (native caret behavior).

### 6.4 Running commands

- `running` is set from the start action to the end action. While set the input is `readonly` (not `disabled`, so it
  keeps focus and receives Ctrl+C); Enter, Tab and recall keys do nothing.
- There is no timeout. Long work is the consumer's to bound; the signal is how the library asks it to stop. A
  cancelled command may still finish work on its side (a save that already reached the server is not undone); the
  console only stops listening.
- The Vue package renders a status element (§7.3) and the `busy` slot while running (Q-07).

### 6.5 Completion (Tab / Shift+Tab / arrows / Enter / Escape) — `completionFeature` (Q-04, D-12)

1. Tab with no session and a non-empty input: take the tolerant tokens of the input and the token whose raw span
   contains the caret (or an empty token at the caret when it follows whitespace). Token 0 → candidates are the
   visible names and aliases. A later token at argument index `i` → the matched command's `complete`, unless the
   position is not safe (below). No `complete`, an unknown command or an unsafe position give no candidates.
2. Safe positions: for a command with `sensitive: { fromArg: k }`, positions `i < k` are safe and `args` holds only
   arguments `< k`; positions `i ≥ k` are never completed, no provider is called and no session is created. For
   `sensitive: true` no argument position is safe. An `isSensitive` predicate match makes every position unsafe. So
   frontendx keeps `set <key>` completion (`fromArg: 1`) and never completes or ships a value.
3. Filter: keep candidates whose lowercase starts with the lowercase prefix; keep the provider's order; drop
   duplicates. Providers are synchronous; a throwing provider gives no candidates.
4. Zero candidates: `status: 'none'`; the input does not change (D-12). The session closes on the next key.
5. One candidate: write it into the span (quoting below) and close the quote; add a space if `final !== false` and the
   token was the last one; set the caret after it. Session closes.
6. Several: if the longest common prefix of the candidates (case of the candidates) is longer than the typed prefix,
   write it into the span without closing a quote. Open the session (`status: 'open'`, `active: -1`).
7. Quoting of written text: if the token was quoted or open, keep its opening quote character and escape for it; if it
   was bare and the text needs quoting (`quoteArgument(text) !== text`), open a `'` (or `"` when the text contains
   `'`). A closing quote is written only when a candidate is completed (steps 5, 8).
8. Open session: Tab / ArrowDown select the next candidate with wrap-around, Shift+Tab / ArrowUp the previous; each
   selection writes the candidate, closed, into the span and updates `span.end` and the caret. Enter with a selected
   candidate accepts it: the session closes and the space of step 5 is added; nothing is submitted. Enter with none
   selected submits. Escape restores `original` into the span and closes the session. Changes the session itself
   writes do not close it; any other edit or caret move closes it and keeps the text.
9. The candidate list is session state, never an entry: a Tab never freezes a line on screen (closes the S-04 leak of
   B-16).

### 6.6 Keys

`handleKey` maps a `KeyInput` to an action through a fixed key map (configurable bindings can come in a minor).
Modifiers match exactly (Ctrl+Shift+C is not Ctrl+C); `key` is compared case-insensitively for letters.

| Action | Chord | When |
| --- | --- | --- |
| `submit` / `acceptCompletion` | Enter | accept when a candidate is selected, else submit |
| `cancel` | Ctrl+C | no selection |
| `recallPrevious` / `recallNext` | ArrowUp / ArrowDown | no completion open |
| `completeNext` | Tab | input non-empty, or a session open |
| `completePrevious` | Shift+Tab | a session open |
| `selectNext` / `selectPrevious` | ArrowDown / ArrowUp | a session open |
| `closeCompletion` | Escape | a session open |

- Tab on an empty input and Shift+Tab without an open session are not handled, so the browser moves focus: the
  keyboard can always leave the console (no focus trap, WCAG 2.1.2). The input's description (`labels.inputDescription`,
  rendered as `aria-description`) says so. Escape without a session is not handled.
- Every other key (characters, Backspace, Delete, left/right, Home/End, selection, paste, Ctrl+A) is native input
  behavior (B-09).
- A key with `isComposing` is never handled (IME).
- Keys are listened to on the input element only, never on `window` or `document` (D-07).

### 6.7 Context — `contextFeature`

- `context` is a stack of frames, bottom → top, root implicit. The prompt of a new input entry is the top frame's
  `prompt`, or `options.prompt` at the root.
- Effects `push-context`, `pop-context`, `reset-context`; methods of the same names. Popping at the root does nothing.
- A run takes a snapshot of the frames and the context revision at its start. A command changes context only through
  its result's effects. If the context changes while the run is current by any other means (a context method call,
  including one made from inside the command, or an external change of controlled `context`, detected by the id
  sequence, §3.4), the run's signal is aborted and its context effects are dropped when it ends; its output still
  appears.
- The meaning of a frame (a config service, a section) is the consumer's (B-35, B-36). The consumer keeps one source
  of truth: frontendx derives its config path from `context` (or controls `context` from its store), never both.
- An input entry keeps the prompt it was ended with (B-05, D-17).

### 6.8 Redaction (in core)

- Sensitivity comes from the command spec first (`sensitive`), the predicate second (§5.3). frontendx: `set` gets
  `sensitive: { fromArg: 1 }`; no regex is needed.
- Applied on every path that ends a line: submit, cancel, parse error, unknown command, `beforeRun` refusal, failure,
  interrupt.
- A redacted input entry contains nothing of the line. Messages carry `null` instead of the name or index. `RunInfo`
  never carries arguments or the line, for any command. The `submit` event carries `{ inputId, sensitive }` only.
- `input.revision` is incremented after a sensitive line ends, on `reset()` when the input was not empty, and on any
  programmatic clear of a non-empty input (`setInput('')`, `run(line)`). The Vue package keys the input element by it,
  so the element that held the text is discarded together with its undo history. (Chromium already drops the undo
  stack on a programmatic `value` write; Firefox keeps it, which the replacement is for. The browser tests run in
  Chromium and therefore assert element identity, §12.)
- The input is never inside a `<form>` and has no `name`, and keeps `autocomplete="off"`, `autocorrect="off"`,
  `autocapitalize="off"`, `spellcheck="false"`: browsers store autofill entries only on form submission.
- The command's `run` receives the full request; what it outputs is the consumer's responsibility (masking stays in
  frontendx, S-05).

### 6.9 Entries

- Ids: the default `createId` is a per-instance counter (`c1`, `c2`, …) that skips ids already present in `entries`.
  `appendEntries` with an id already present throws. Ids are unique within a console; the Vue package derives DOM ids
  from `useId()`, not from entry ids, so two consoles never collide (C-08).
- `maxEntries` drops the oldest entries after an append, in the same action.
- The `clear` effect and `clearEntries()` set entries to `[]`. There is no "banner after clear": the command returns its
  banner as output after the effect (B-29).
- `initialState.entries` seeds the first screen (B-04; Q-01: no spacer line).

### 6.10 Lifecycle

- Nothing runs and no callback is called on creation (P3).
- `reset()` (one action): ends the running run as cancelled without an `interrupted` entry (invalidate, then abort),
  closes completion, then entries, recall, context and input return to their initial values (`input.revision`
  incremented when the input was not empty); each controlled slice gets one `on*Change` (B-07, B-08: cancel before
  clearing).
- `dispose()`: ends the running run (invalidate, then abort), runs disposers once (an
  exception in one does not stop the others), clears the internal state, and every later method is a no-op. The
  composable drops its snapshot at the same time. Two consoles share nothing (C-08).

## 7. Vue package (`@dolusoft/command-console`)

### 7.1 `useCommandConsole(options)`

Takes the core options (each may be a ref or getter), creates the console once, calls `setOptions` when reactive
options change, mirrors the store into a `shallowRef` snapshot and disposes on scope dispose. Returns `{ console, state
}` (`state`: readonly `ShallowRef<ConsoleState>`). No DOM work: usable with a fully custom template. It is generic
over the features like `createConsole`.

### 7.2 `<CommandConsole>`

- Props: the core options except `features` and `state` (the component always uses all optional features, and its
  `console` is typed with all of them), `labels?: DeepPartial<ConsoleLabels>` (merged one level deep, so overriding
  `messages.interrupted` keeps the other messages), `autofocus?: boolean` (default false), and `entries` / `recall` /
  `context` for `v-model:*` (controlled when bound, §3.4).
- Events: `update:entries`, `update:recall`, `update:context` (resolved values), `close` (the `close` effect; replaces
  the `exitRequested` flag, D-13), `submit` (`{ inputId, sensitive }`).
- Slots (P10):
  - `block-text`, `block-json`, `block-table`, `block-list`, `block-message`, `block-custom` (`{ block, entry }`): each
    replaces the rendering of one block type only, inside `.cc-block`; the other types keep the default rendering.
    `custom` blocks without a slot render a `pre` of their JSON.
  - `prompt` (`{ prompt }`), inside each `span.cc-prompt`.
  - `busy` (`{ running }`), inside `.cc-status` while a run exists.
  - `completion` (`{ candidate, index, active }`), inside each `li.cc-completion`; the `ul`, `li`, their ids and the
    ARIA wiring stay the library's.
- Expose: `focus()`, `run(line)`, `cancel()`, `reset()`, `clear()`, `console`, `state` (readonly `ShallowRef`, for a
  consumer that keys its overlay on `running`).

### 7.3 DOM (listed in `contract/dom.ts`; P6)

```
div.cc-console [data-busy] data-context-depth=<frames.length>
├─ div.cc-log  role="log" aria-label=labels.log            (the scroll container)
│  └─ div.cc-entries                                        (observed by the ResizeObserver)
│     └─ div.cc-entry  data-kind="input|output" data-tone data-status [data-redacted] [aria-live="off" when quiet]
│        ├─ (input)  span.cc-prompt + span.cc-line (+ span.cc-cancelled)
│        └─ (output) one element per block: .cc-block data-type="text|json|table|list|message|custom"
│           text → pre · json → pre (JSON.stringify(value, null, 2)) · table → table/thead/th scope=col/tbody
│           list → ul/li · message → div · custom → pre of the JSON; each replaceable by its `block-<type>` slot
├─ div.cc-status role="status"           (labels.busy while running, the recalled line after recall, else empty)
├─ ul.cc-completions role="listbox" id=<listId> aria-label=labels.completions   (only while a session is open)
│  └─ li.cc-completion role="option" id=<listId>-<n> aria-selected   (`completion` slot inside)
└─ div.cc-input-line                     (never a <form>)
   ├─ span.cc-prompt
   └─ input.cc-input type="text" role="combobox" aria-autocomplete="list" aria-expanded
                     aria-controls=<listId> (only while open) aria-activedescendant (only while a candidate is selected)
                     aria-label=labels.input aria-description=labels.inputDescription  (no `name` attribute)
                     autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                     [readonly while running]
```

- `role="log"` is an implicit polite live region; there is no `aria-busy` on it, so progress written with `write()` is
  announced as it comes. The running state is announced by the status element.
- Ids come from Vue's `useId()` (SSR-safe, unique per console).
- All text is escaped (Vue interpolation; no `v-html`, enforced by lint, S-08).
- The DOM and style contract (C-45, C-46) covers the elements the library renders. Slot content is the consumer's and
  is excluded by the collector (it stops at slot boundaries, marked during tests).

### 7.4 Focus, selection, scroll, input element

- `autofocus` focuses the input on mount. After each submit the input keeps focus (B-32).
- A click in the log focuses the input unless the document selection is non-empty (B-33) or the click target is inside
  an interactive element (`a`, `button`, `input`, `select`, `textarea`, `[tabindex]`, `[contenteditable]`).
- Scroll (Q-08): the log sticks to the bottom while the user is within 2 px of it, and always after the user's own
  submit; when the user has scrolled up, new output does not move the view. One `ResizeObserver` on `div.cc-entries`,
  disconnected on unmount; its callback does nothing after unmount (D-04).
- The input element is keyed by `input.revision` (§6.10). When it is replaced, the new element gets focus only if the
  old one had it, and the caret goes to the end.
- No listener on `window` or `document` (D-07).

### 7.5 Labels

`input` ('Command'), `inputDescription` ('Enter runs the command. Tab completes; on an empty line it leaves the
console.'), `log` ('Console output'), `redacted` ('(input hidden)'), `cancelledMarker` ('^C'),
`completions` ('Suggestions'), `busy` ('Running…'), `messages`: `command-not-found` (`(p) => p.name === null ?
'command not found' : \`${p.name}: command not found\``), `command-failed` ('The command failed.'),
`unterminated-quote` ('Unterminated quote.'), `interrupted` ('Interrupted.').

## 8. Mapping to today's behavior (acceptance)

| Today | 1.0 | Rule |
| --- | --- | --- |
| B-02 size from outside | no size set; fills what the consumer's CSS gives | C-46 |
| B-04 initial screen | `initialState.entries`, no spacer (Q-01) | C-24 |
| B-05 prompt per mode, frozen per line | context frames; prompt snapshot | C-26, C-27 |
| B-07/B-08 cleanup on unmount and access loss | `reset()` / `dispose()`, cancel first | C-07, C-08, C-18 |
| B-09 native editing, Enter submits, trim | native input; keydown Enter; trimmed request | C-09 |
| B-10 Ctrl+C copy vs cancel | selection → native copy; else cancel | C-15, C-52, C-57 |
| B-11 continuation, backslash stripping | dropped (Q-02); `\` literal | C-10 |
| B-12 recall | unique, newest-wins, draft kept, limit | C-19..C-23 |
| B-13 `set` not in recall | command sensitivity | C-31 |
| B-14 clear recall | `clear-recall` effect / `clearRecall()` | C-23 |
| B-16/B-17 completion | §6.5 (Q-04 shell-like), `set <key>` kept by safe positions | C-37..C-43 |
| B-18 parsing | quoting, tabs separate (Q-05) | C-10, C-11 |
| B-19 handler arguments | `CommandRequest` | C-12 |
| B-20 lookup, not found | `Map`, message code | C-13 |
| B-21 `set` echo hidden | redaction before anything else | C-30 |
| B-22 permission per run | `beforeRun` with `RunInfo` | C-14 |
| B-23 async, no prompt while waiting | `running`, read-only input, always restored | C-16, C-17 |
| B-24..B-28 output kinds | structured blocks, no HTML (Q-06) | C-28, C-29 |
| B-29 clear | `clear` effect then output | C-25 |
| B-30 overlay | consumer; `running` + its own load state (Q-07) | C-44, C-68 |
| B-32/B-33 focus, selection | §7.4 | C-51, C-59 |
| B-34 scroll | stick when at bottom (Q-08) | C-58 |
| B-36 `exit` | `close` effect / event (D-13) | C-25 |
| D-01..D-03 | ESM, `vue` peer, own `.d.ts` | C-49 |
| S-01..S-04 | redaction on every path | C-30..C-36, C-54, C-64, C-69 |
| S-06 | `command-failed` without error text | C-34 |

B-01, B-06, B-15, B-31, B-35..B-39 and the masking (S-05) are consumer behavior and stay tested in frontendx.

## 9. Contract rules (become `contract/rules.md`)

Each rule is written as it will stand in `contract/rules.md`: a `### C-nn Title` heading and its text. Numbers are
final for 1.0; later rules append, and a withdrawn number is never reused. Each rule gets at least one test titled
with its ID (P12). Rules marked (Vue) are tested in the Vue package, the others in core or protocol.

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

`void`, a string, a block array and a response give the specified entries; same content, same entries.

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

The candidate is written into the token's span with the quoting of §6.5 and its quote closed, and a space is added
unless `final: false` or the token is not the last; the caret follows it.

### C-41 Several candidates

The longest common prefix is written when longer than the typed prefix, without closing a quote; the list opens;
Tab/ArrowDown and Shift+Tab/ArrowUp select with wrap and write the candidate into the span; text outside the span is
kept; Enter on a selection accepts it as C-40 does and submits nothing; Escape restores the original token.

### C-42 (withdrawn)

Async completion is not in 1.0 (§1.1).

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

ESM only, own `.d.ts`, `vue` a peer, no alias or `optimizeDeps` needed by a consumer, `README.md` and `LICENSE` in
every tarball (pack-install test).

### C-50 No transport, no storage

No package reads or writes storage or the network.

### C-51 Focus (Vue)

`autofocus` focuses on mount; a click in the log focuses the input unless text is selected or the target is
interactive.

### C-52 Keys scoped (Vue)

Keys are handled on the input only; no listener remains after unmount; Ctrl+C with a selection is not prevented.

### C-53 Key map

The fixed key map of §6.6 applies with exact modifiers; a key with `isComposing` is never handled.

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

## 10. Decisions (become `docs/decisions/`)

Format as in Query Table: `NNNN-kebab-title.md`, `# NNNN Title`, `Status:` line, Context / Decision / Consequences /
Trade-off; the index rule "a record is not edited to change its decision; a new record supersedes it".

- **0001 Three packages and an engine of our own.** protocol → core → vue; TanStack v9's feature shape copied, no
  TanStack dependency; a store of a few dozen lines with an explicit action boundary.
- **0002 A fixed feature set and the shared contract.** Core features always present; recall, completion, context
  opt-in for size; the feature interface is internal in 1.0; optional features talk only through `shared/`.
- **0003 State ownership.** `entries`, `recall`, `context` controllable with composed updaters per action (after Query
  Table ADR 0004); everything else internal; the library persists nothing (S-03).
- **0004 Composable and component.** `useCommandConsole` headless, `CommandConsole` on top; extension order slot,
  event, prop, method.
- **0005 Output is structured blocks, never HTML.** text/json/table/list/message/custom; custom through a slot; no
  `v-html` (S-08). Consequence for frontendx: highlight.js colouring of `show` moves into a `block` slot.
- **0006 Sensitive lines.** Sensitivity is declared on the command (`sensitive`, with safe argument positions) and
  computed from the tokens, with an optional predicate; redaction is core, applied on every line ending before anything
  else sees the line; callbacks get `RunInfo`, never arguments (P16).
- **0007 Line syntax.** Shell-like quoting, `\` literal outside double quotes, tolerant tokens for completion, no
  continuation (Q-02, Q-05, D-10).
- **0008 npm as the only distribution channel.** Trusted publishing behind the `release` environment; a GitHub Release
  with generated notes and no asset.
- **0009 Release versions.** Never a major; next minor or patch of the latest `v*` tag; the first release is `1.0.0`,
  accepted by the version check when no `v*` tag exists.
- **0010 CI on GitHub-hosted runners.** The repository is public: hosted minutes are free, and a self-hosted runner on a
  public repository would run fork pull requests' code on our network. `ubuntu-latest`, no OS matrix, no cron.

## 11. Tooling, checks, CI and release

Copied from Query Table and adapted:

- pnpm workspace, Node ≥ 22.18, TypeScript strict, Vite library mode per package (ESM, `dist/`), declarations by
  `tsc`, api-extractor reports in `etc/`.
- Vitest projects: `unit` (happy-dom; core, Vue unit and repo specs; coverage thresholds 90/90/90/90 on
  `packages/*/src`) and `browser` (Playwright Chromium; DOM contract, keys, focus, selection, scroll, undo, axe).
- ESLint 10 flat config: the layer rule, the storage/network ban, `vue/no-v-html: error`, no `addEventListener` on
  `window` or `document` in `packages/command-console/src`.
- Scripts: `gen-contract.mjs`, `check-deps`, `check-no-css` + `check-css-leak`, `consumer-size` + `package-size`,
  `pack-install-test` (the three tarballs into a fresh Vite app without alias, then build), `check-release-version`
  (first-release case), `check-pr-body`, `check-commit-trailers` (no AI co-author trailers), `test-browser.mjs`.
- `tests/repo`: `contract-traceability.spec.ts` + `test-names.ts` (sanity floor set to the 1.0 counts),
  `package-manifest.spec.ts`, `eslint-layers.spec.ts`, `no-css-leak.spec.ts`.
- CI (`ci.yml`), `checks` job in dependency order: install → lint → typecheck → unit + coverage (includes traceability)
  → **build** → `api:check`, `contract:check`, `check:deps`, `knip`, no-css, sizes, pack-install (everything that reads
  `dist/` after the build). `browser` job in parallel; `verify` requires both. `pr-body.yml` checks the PR template.
- Release (`release.yml`): on tag `v*`: version check, CI, pack the three tarballs, `npm` job behind the `release`
  environment publishing protocol → core → vue with `--provenance --access public`, then a GitHub Release. The first
  publish of the three names is manual (handover).
- Order of work: the tooling (workspace, configs, scripts, `tests/repo`, CI, an empty package per layer) lands first as
  its own pull request, green on empty packages; the package code follows in later pull requests. The tooling is
  budgeted as a piece of work of its own, not as a side task of the first package.
- Language: code, comments, docs, issues in English; commit messages and PR bodies in Turkish, PR template
  Belirti/Değişiklik/Doğrulama/ADR etkisi + `İlkeler:` / `Katman:` lines (as in Query Table). MIT license.

## 12. Test strategy

- Core: one spec file per feature in `packages/command-console-core/tests/`, a `describe('C-nn …')` per rule, fake
  commands, no DOM; async rules with deferred promises, never timers.
- Protocol: tokenizer table tests plus a property test (random strings: tokenize ∘ quote round trip; no character
  dropped; spans cover the raw text).
- Vue unit (happy-dom): props → core options, events, slots, labels, expose, `v-model` resolution.
- Vue browser (Chromium): DOM contract collector rooted at `.cc-console` (stopping at slot boundaries), keyboard
  through real key events, selection + Ctrl+C copy, click-to-focus, scroll stickiness, input replacement after a
  sensitive line (C-54: element identity and empty value are the assertion; `execCommand('undo')` is a secondary check,
  since Chromium already drops the undo stack on a programmatic write and the replacement exists for Firefox), focus
  exit by Tab/Shift+Tab, axe with the list closed and open, listener leak check after unmount.
- Same-tick updates (C-61) and nested actions (C-60) are tested in core with a fake controlled consumer and in Vue
  through `v-model` with two synchronous actions in one tick.
- Leak matrix (C-36): `tests/support/leak-matrix.ts` wraps every callback and event to check its arguments when it is
  called (updaters executed against the current value, `Error` own properties and `message` read explicitly), checks
  the state after every action, and in the browser the DOM text, attribute values, the input's `value` and the
  accessibility tree (Playwright `ariaSnapshot`), for each path listed in C-36.
- A frontendx-shaped fixture (`tests/fixtures/`, not shipped): `show`, `config`, `set` (`sensitive: { fromArg: 1 }`),
  `end`, `exit`, `help`, `clear` with fake data, used to replay the B-items end to end.

## 13. Where the parts go after acceptance

§2 → `PRINCIPLES.md`; §3–§7 → `README.md` (usage) and package READMEs; §9 → `contract/rules.md`; §7.3 →
`contract/dom.ts`; §10 → `docs/decisions/`; §11 → `CONTRIBUTING.md` and `AGENTS.md`; this file is deleted.

## 14. Handover items (outside the code)

- GitHub settings: `release` environment (reviewers as Query Table, tags `v*`), branch protection on `main` (`verify`,
  `pr-body`, code owner review), CODEOWNERS.
- npm: first publish of the three names by hand, then a trusted publisher per package.
- frontendx migration (dolusoft/frontendx#1812):
  - remove `vue-command`, the `vue` alias, the `optimizeDeps` entry, `types/vue-command.d.ts` and the `entry-client.ts`
    error filter;
  - port commands to `CommandDefinition`; `set` gets `sensitive: { fromArg: 1 }` and its `complete` for the key; the
    regex and the sync recall watcher go;
  - remove the `set` handler's own quote stripping: the tokenizer already removes grouping quotes, so `set Key "abc"`
    reaches the handler as `abc`, and a literal `"abc"` is typed as `set Key '"abc"'`; test both, plus empty values,
    spaces and Windows paths, at the handler;
  - pass `run.signal` into the config store's save and load calls; after an abort or a context change the store must not
    write `tempChanges` or the path; document that `end` cancelled after the request was sent may still have saved;
  - one source of truth for the config path (derive it from `context` or control `context` from the store);
  - overlay = the console's `running` (read from the component's exposed `state`) or the store's own initial load
    (`loadConfigs` on mount is not a console command);
    test first open, remount with loaded data, and a command while loading;
  - render `show` with highlight.js in the `block-json` (or `block-custom`) slot; build help from `getCommands()`;
  - `beforeRun` for the read/write permission check.

## 15. Changes from v1 (review 1)

All 25 findings were checked against the spec and the frontendx code and accepted. Main changes: sensitivity moved
from a regex to the command spec, resolved from the tokens (quote and case bypasses closed), with safe completion
positions; callbacks get `RunInfo` without arguments; a common line-end cleanup clears draft and session; the input
element is replaced after a sensitive line; P16 scoped to what the library keeps and hands out; actions defined as
synchronous steps with composed updaters for controlled slices; `beforeRun` inside the run lock with a signal and an
explicit `undefined` = go on; run ids invalidated before abort, guarded `finally` cleanup; context snapshot and
revision; tolerant tokens and span/caret rules for completion; combobox keys (arrows, Enter accepts, no focus trap);
named log without `aria-busy`, a status element, ids from `useId()`; id collisions handled; slot content outside the
DOM contract; the feature interface internal and the help helper dropped; JSON response separated from the core return
shorthand; duplicate names rejected; build before `api:check` in CI; migration items for the frontendx consumer.

## 16. Changes from v2 (review 2)

All 20 findings were checked and accepted, together with the reviewer's list of cuts. Cut from 1.0: asynchronous
completion, `keyBindings` and `matchCandidate` (§1.1; C-42 withdrawn, C-53 now the fixed key map). Engine: nested
method calls and `write()` join the open action (C-60); the base of a controlled slice is the last reported value until
`setOptions` delivers a new one or a microtask passes, and the Vue component resolves updaters against what it last
emitted (C-61); `state` wins over `initialState`; an external context change is detected by the frame id sequence and
aborts the run (C-62); `createConsole`'s feature generic defaults to `{}`. Behavior: `onLineSubmitted` records parse
errors too; `beforeRun` and `formatError` responses are handled as a fulfil; completion filters case-insensitively,
keeps the token's quote character, closes a quote only on a completed candidate and adds the space when a selection is
accepted with Enter; the session's own writes do not close it; a recalled line is announced by the status element; the
input has a description that tells how Tab leaves it. Security: the input element is replaced after any programmatic
clear of a non-empty input and on `reset()`, and the test asserts element identity (Chromium already drops the undo
stack); no `<form>` and no `name` on the input; P16 lists what it cannot guarantee; errors built by a command are the
command's. API: `submit()` / `run(line)` resolve a boolean, `getCommands()` defined, `state` exposed by the component,
per-type block slots and a `completion` slot, `labels.messages` merged, quiet entries not announced, `div.cc-entries`
observed for scroll. §9 is written in the `### C-nn` form of `contract/rules.md`, with C-13, C-16, C-44 and C-52 split
(C-56 to C-59) and new rules C-60 to C-69. The tooling is its own first pull request.
