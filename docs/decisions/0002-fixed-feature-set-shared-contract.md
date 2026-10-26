# 0002 A fixed feature set and the shared contract

Status: Accepted (2026-10-26)

## Context

Recall, completion and a context stack are what make a console pleasant, but not every console needs them, and each costs bytes (P8). A public plugin API would let third parties add features, but it freezes the engine's internals before the first release has shown which internals are right.

## Decision

- The core features `console`, `entries`, `input` and `dispatch` are always present.
- `recallFeature`, `completionFeature` and `contextFeature` are opt-in through `options.features`, so a console that does not use them does not ship them. `consoleFeatures()` keeps the object's type; the instance type is computed from a fixed feature → API map, and a console created without features has no optional method in its type (C-01).
- The feature interface is internal in 1.0: it is not exported. Third-party features can come in a minor release.
- Optional features never import each other or the core feature folders at runtime. What one needs from another goes through a per-console record in `shared/` (hooks, effect handlers, key actions, command lookup, disposers), kept in a `WeakMap` keyed by the instance and dropped on dispose.

## Consequences

- Features are constructed in a fixed order (console, entries, input, dispatch, recall, completion, context); that order and "no feature overwrites another's method" are internal invariants tested inside `src/`.
- The ESLint `layers/boundaries` rule holds the fence (P14): a feature in `features/<name>/` imports only its own files, `shared/`, the store and the protocol; `shared/` imports only itself and the store; `core/` never imports a feature. A feature and `shared/` may import `core/` for types only, since the instance and state types a feature implements against live there and erase at build.

## Trade-off

A fixed set means a consumer who wants another feature waits for a minor release or wraps the console. In exchange the engine can change its internals until the feature interface is proven.
