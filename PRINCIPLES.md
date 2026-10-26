# Principles

These are the boundaries of Command Console. A change that crosses one needs the principle changed first, in its own discussion and a decision record ([docs/decisions/](docs/decisions/README.md)). Each principle names the check that holds it; where the check is a review, it says so. They are Query Table's P1–P15 carried over to a console, plus P16.

The behavior rules (`C-nn`) are in [contract/rules.md](contract/rules.md); the generated contract is [CONTRACT.md](CONTRACT.md).

## P1 The console renders; the consumer supplies the commands

The library parses, dispatches and renders; what a command means, which data it reads and where it sends it is the consumer's. No `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie` in any `src/`.

Check: ESLint restricted globals/properties over every package's `src/`; C-50.

## P2 Lasting state can be controlled; internal state is short-lived

`entries`, `recall` and `context` can be owned by the consumer (ADR 0003, C-04) or left to the console. The input text, the recall cursor and draft, the completion session and the running command are internal and die with the line, the run or the console. The console never mutates objects it was given.

Check: C-03, C-04; tests with deeply frozen inputs.

## P3 Every state change is defined

An action is one synchronous step (C-05, C-60). Each action makes a specified, ordered set of changes, notifies subscribers at most once, and calls each controlled slice's `on*Change` at most once. Nothing changes and nothing is called on creation.

Check: C-05 and the per-action rules.

## P4 The protocol is plain JSON

Entries, blocks, specs, responses, effects and frames are JSON values: finite numbers only, no `undefined`, and they survive `JSON.parse(JSON.stringify(x))` unchanged. Functions (handlers, completion providers, predicates) live in core options, never in protocol types.

Check: C-06; `pnpm api:check`.

## P5 No CSS, no styling props

The packages ship no stylesheet, no `<style>`, no inline style, no `@keyframes`. The only style-related write is `scrollTop` on the log element (C-58). The rule covers the elements the library renders; slot content is the consumer's (`contract/dom.ts`).

Check: `pnpm check:package` (no `.css` in `dist/` or the tarball), the CSS leak scan, C-46.

## P6 The DOM is public API

The classes (`cc-*`), `data-*` attributes and ids listed in `contract/dom.ts` are the only hooks a skin may select, and every element the library renders carries only listed hooks.

Check: C-45.

## P7 Native semantics first; no hardcoded text

Native elements (`input`, `ul`/`li`, `table`/`th scope="col"`, `pre`) before ARIA. Core writes no human text: it produces message codes (C-47), and the Vue package renders every text from the `labels` prop, with English defaults.

Check: C-47, C-48.

## P8 Size is a budget, per consumer fixture

Measured as a consumer pays it: a built app importing the package by name minus the same app without it, minified + gzipped. Fixtures: protocol, core with core features, core with all features, the composable, the component. A budget is the last measure + 5%; a deliberate growth raises it in the same change with a one-line reason.

Check: `pnpm check:package-size`, `pnpm check:size`.

## P9 One small, typed surface per package

Every published entry has a reviewed api-extractor report. New surface is a minor, fixes are patches, never a major (ADR 0009). The three packages share one version.

Check: `pnpm api:check`, `tests/repo/package-manifest.spec.ts`.

## P10 Extension order: slot, event, prop, method; inside, feature first

Publicly: a slot when the consumer draws, an event when it reacts, a prop when the console needs data, a method only for an action that is not state. Inside: behavior goes into a core feature first, Vue code last.

Check: review; every prop, event, slot and method rests on a C-rule (contract generator cross-check).

## P11 Dependencies are few and layered

Protocol: none. Core: the protocol. Vue: core, protocol, `vue` as the only peer (`^3.5`). No runtime dependency without an ADR.

Check: `package-manifest.spec.ts`, `pnpm check:deps`, `pnpm knip`.

## P12 Rule, test, code and generated docs move together

A behavior change starts as a rule in `contract/rules.md`, gets a test titled with the rule ID that asserts it, then code, then the regenerated `CONTRACT.md`.

Check: `tests/repo/contract-traceability.spec.ts`, `pnpm contract:check`.

## P13 Page layout is out of scope

Panels, tabs, overlays, toasts, loaders and the console's size belong to the consumer. The console sets no size and no `overflow`; the consumer's CSS makes `.cc-log` scroll. The console writes a scroll position only to keep the newest output in view (C-58).

Check: review; C-46.

## P14 Layers point one way

protocol → core → vue. Inside core, an optional feature imports only `shared/`, the store and the protocol; never another feature.

Check: the ESLint `layers/boundaries` rule (copied from Query Table, tested in `tests/repo/eslint-layers.spec.ts`), `pnpm check:deps`.

## P15 The core holds the console; there is no second copy

The Vue package keeps no console state of its own: it renders the core's state and forwards DOM events to core actions. Vue-side state is DOM-bound only (element refs, the "stuck to bottom" flag, the input element's key).

Check: review; the composable test that drives the console only through core actions and asserts the DOM.

## P16 A sensitive line leaves no trace in what the library keeps or hands out

Scope: everything the library creates or passes on after a sensitive line ends — `entries`, `recall`, the recall draft, the completion session, message parameters, every callback and event argument, the rendered DOM and its accessibility tree, and the input element that held the line. The exceptions are explicit: the live input while the user types it, the `CommandRequest` given to the matched command's own `run`, and the safe argument positions given to its `complete` (ADR 0006, C-35). What a command outputs, what its own errors carry, and what the consumer puts into controlled state, is the consumer's.

Check: C-30..C-36, C-54, C-69, the leak matrix (C-36).

Not guaranteed, because the library cannot reach it: the IME's own history, the operating system's keyboard suggestions, the speech and braille history of a screen reader that read the line while it was typed, the operating system clipboard history, and browser form restore and autofill. The last is mitigated by rendering the input outside any form, without a `name`, with `autocomplete="off"` (C-69).
