# 0017 Separate CLI reception from local relay dispatch

Status: Proposed (2026-11-15; code-owner review required)

Extends [ADR 0012](0012-envelope-and-gate.md) and [ADR 0014](0014-remote-entry.md).

## Context

A consumer may receive CLI commands while its local terminal runs without a relay. In 1.9.0 `gate` enables
both: `attachRemote` needs it, but it also sends every described local command through an echo round trip.
Providing a loopback gate changes the production transport policy; creating a second console splits the state
(P15). A command that checks permission in `run` also needs to return `not-allowed`, which the protocol already
supports, instead of having its `CommandError` reduced to `failed`.

## Decision

- Add `ConsoleOptions.cliGate?: Pick<ConsoleGate, 'subscribe' | 'schedule'>` (C-120). The name identifies the
  entry it serves, alongside `gate`; the type reuses the existing transport methods without requiring outbound
  envelopes or a tab id. `now` remains the consumer's clock. No runtime dependency or transport is added.
- Only `gate` enables local relay dispatch. An explicit `cliGate` receives CLI messages and owns approval
  timers; it never processes local echoes. CLI messages delivered on `gate` are ignored with the explicit option.
- The explicit subscription lasts from attach to detach or dispose. Replacing a binding replaces its
  subscription. `suspendRemote` drops a waiting approval and keeps the binding and subscription; reconnecting
  with the same `bindingId` needs no reattachment, as with `gate`. A late callback from an ended subscription
  cannot reach the old binding or one attached later. Unsubscribe errors are reported to `onError` without
  interrupting cleanup or binding replacement. The relay subscription remains available for local echoes.
- Without `cliGate`, keep the 1.9.0 shared gate behavior, including its subscription lifecycle. Both transport
  options remain fixed for the console's life. This opt-in addition is the next minor, 1.10.0 (ADR 0009).
- Extend the command-owned codes of C-86 with `not-allowed`: permission can change between the initial check
  and a command's actual work. The same code and bounded message reach `request`, WebMCP and remote results;
  `plan` errors follow `run` errors as C-99 already requires. A command-owned permission denial suggests no retry;
  an expired or dropped approval keeps its suggestion (C-111). Other hooks still fail as before.

## Consequences

The consumer can pass only `cliGate` to receive CLI work and keep local commands local, both gates to relay local
work separately, or just `gate` to keep its existing behavior. The command error API report and C-86 change;
the receive option, C-120, its tests, generated contract, READMEs and changelog move together (P9, P12).
The remote wire format and frozen fixtures do not change: `not-allowed` already has the `denied` class.

## Trade-off

Two explicit options can create two subscriptions even when they reference the same transport object. Each has
one role and one lifetime, so detach does not interrupt local echo processing. The legacy path retains a shared
subscription to avoid requiring existing consumers to change their reconnection code.
