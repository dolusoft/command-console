# 0001 Three packages and an engine of our own

Status: Accepted (2026-10-26)

## Context

The first consumer, the settings console of `dolusoft/frontendx`, is built on `vue-command`. It needs a `vue` alias, an `optimizeDeps` entry, its own type declarations and an error filter at start-up, and it mixes the console's behavior (keys, recall, completion, dispatch) with the product's commands and texts. Query Table solved the same split for tables: a JSON protocol, a framework-free core and a thin Vue package (its ADR 0002), with the core assembled from features in the shape of TanStack Table v9.

There is no TanStack console. A console engine is small: a state of a few slices, a dozen actions, and a key map.

## Decision

Three packages, versioned together and published under `@dolusoft`:

- `@dolusoft/command-protocol`: the JSON types of entries, output blocks, command specs, responses, effects and context frames, and the line tokenizer. No dependency.
- `@dolusoft/command-console-core`: the engine (`createConsole`), its features and the `shared/` contract. Depends on the protocol only.
- `@dolusoft/command-console`: `useCommandConsole` and `<CommandConsole>`. Depends on the core and the protocol; `vue` is its only peer.

Layers point one way: protocol → core → vue (P14). The engine copies TanStack v9's shape (an instance assembled from plain feature objects, options merged from feature defaults, state either internal or controlled) without depending on TanStack: a store of a few dozen lines with an explicit action boundary.

## Consequences

- A consumer without Vue (a test, a server that answers with console responses, another framework) can use the protocol or the core alone.
- The core is DOM-free and timer-free: it sees `KeyInput`, never a DOM event; the Vue package maps DOM events to core actions (P15).
- The dependency allow-list per package is checked by `pnpm check:deps`, and the layers by the ESLint `layers/boundaries` rule (`scripts/eslint-layers.mjs`).

## Trade-off

Three packages cost three manifests, three API reports and a release that publishes in order. One package would be simpler to release but would tie the engine to Vue. The engine of our own is code we maintain; a dependency on a general state library would be more code than the engine itself (P8, P11).
