# 0004 Composable and component

Status: Accepted (2026-10-26)

## Context

Most consumers want a console they can drop into a panel and skin with CSS. Some want their own markup around the same behavior. A component alone forces the first; a composable alone makes every consumer rebuild the DOM, its ARIA wiring and its focus rules.

## Decision

- `useCommandConsole(options)` is headless: it creates the console once, passes reactive option changes to `setOptions`, mirrors every notification into a readonly `shallowRef` and disposes the console with its effect scope. It does no DOM work (C-68).
- `<CommandConsole>` is built on it and renders the DOM of `contract/dom.ts` with no stylesheet (P5, P6). It always uses all optional features.
- The component grows in this order (P10): a slot when the consumer draws, an event when it reacts, a prop when the console needs data, a method only for an action that is not state. Inside, behavior goes into a core feature first and into Vue code last.

## Consequences

- Every prop, event, slot and exposed member rests on a rule, and the generated `CONTRACT.md` cross-checks the component against `src/contract.ts` (`pnpm contract:check`).
- The Vue package keeps no console state of its own (P15): DOM-bound state only.

## Trade-off

Two entry points are two surfaces to keep stable. The composable is the smaller of the two and the one the component is tested through, so its surface stays narrow.
