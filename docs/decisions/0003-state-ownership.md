# 0003 State ownership

Status: Accepted (2026-10-26)

## Context

A consumer may want to keep the scrollback across a remount, persist the recall list or drive the context stack from its own store. Two owners of one state drift apart, so the console must be able to give a slice away entirely. At the same time the input text, the recall cursor or a completion session belong to one line and should not burden the consumer.

## Decision

- `entries`, `recall` and `context` are controllable: when `options.state[slice]` is given, the console reads the slice from options, never writes it, and reports each action's changes through one `on<Slice>Change(updater)` call whose updater composes every change of the action (after Query Table ADR 0004). `state` wins over `initialState`.
- The base of an action is the value last reported, until `setOptions` delivers a new one or the microtask after the report runs; two actions in one tick never lose each other's changes (C-61).
- Everything else is internal and short-lived: the input text, the recall cursor and draft, the completion session, the running command.
- The library persists nothing (P1, S-03). A consumer that persists recall does it from the controlled `recall` state, which never holds a sensitive line (C-31).
- The Vue component exposes the three slices as `v-model:entries`, `v-model:recall` and `v-model:context`.

## Consequences

- Nothing changes and nothing is called on creation (P3, C-24); an uncontrolled console needs no wiring.
- The console never mutates objects it was given (C-03).

## Trade-off

Composed updaters and the "last reported value" base are more machinery than a plain `v-model`, but without them two actions in one tick, or a run that writes twice, lose output.
