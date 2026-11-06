# 0014 The remote entry of a desktop CLI

Status: Accepted (2026-11-07)

## Context

The user, or an agent on the user's computer (Claude Code, Codex), types `gecko <line>` in the operating system's
terminal. The line must run in the user's Gecko tab as the web terminal runs it today, opening its screens there, and
its result must come back to the CLI. The design is the
[desktop CLI specification](https://github.com/dolusoft/frontend-v2-design/blob/main/design/desktop-cli.md) (third
draft, 2026-11-07); it is built on ADR 0012. The hub stamps every message of a CLI (`origin`, `stampedAt`,
`expiresAt`) and routes it to the one browser connection of its binding; the tab answers through a new hub method.

Today's `request()` sends its own envelope and waits for its echo (C-82); a CLI request does not fit that model: it
reaches one tab only, already stamped, and needs no echo. And the agent path knew the danger of a command, not of a
call: the preview of `tasks.stop --id 8812`, which changes nothing, was refused like the change.

## Decision

- **The protocol gets the remote envelopes.** `cli-request` and `cancel` from the CLI (`parseCliMessage`), and the
  replies `capabilities`, `received`, `awaiting-approval`, `chunk`, `finished`, `cancelled-before-start` and
  `cancel-requested` (`CliReply`). Sizes are measured on the UTF-8 JSON, every envelope within `envelopeMaxBytes`; a
  result's `data` travels as its JSON text in at most three chunks. `ErrorCode` gains the codes of the remote path:
  `expired`, `clock-skew`, `not-delivered`, `tab-unreachable`, `gone`, `unknown-outcome`. `Actor` gains `cli`, a
  label for the history; permission follows the hub's stamp and the binding, never the actor.
- **A call's danger comes from the command (`confirm`).** `CommandSpec.confirm: { field }` names the boolean field
  that turns a preview into the change. A call whose field is not `true` runs as `read`, for the CLI and for the
  agent's `run` tool alike; the convention "the preview arm sends no changing request" becomes testable.
- **The core gets a remote entry, separate from `request()`.** `attachRemote(binding)` takes the consumer's binding
  (its ids, when it was approved, `send` for the replies) and subscribes to the gate at once: a bound tab that never
  sent an envelope still hears its CLI (C-78 widens). The accept path checks the stamp with the `now` option (the
  core still reads no clock), remembers the ids it saw, refuses while a run exists (no queue), and then takes the
  agent's path: the CLI counts as an agent, so it gets the same masks and limits and never the terminal's blocks.
- **The approval plan is its own hook, not `beforeRun`.** `beforeRun` gets no input (C-33). A command's
  `plan(input, signal)` gives the targets and a preview; the console holds the plan in `state.remote.approval` for
  two minutes through `gate.schedule`, refuses an approval in its first second, keeps one plan at a time, and runs the
  plan's input once. A rejection, the timer, a suspended or ended binding and a cancel drop it.
- **The Vue package draws it.** A CLI line is marked like an agent's (C-85). `.cc-remote` shows the bound CLI with a
  "Disconnect" button that emits an event (the hub call is the consumer's, P1); `.cc-approval` shows the plan, "from
  the CLI" and when the binding was approved, never the computer name the CLI declares; `.cc-pairing` asks the
  pairing question from the server's facts.

## Consequences

- A consumer without `attachRemote` has the 1.5 console; `state.remote` is `null`. The 1.x line only adds (ADR 0009).
- `ConsoleState` gains `remote`, `RunningCommand.phase` gains `approving`: code that compares the whole state, or
  switches over every phase, sees them.
- The hub, the device login, the binding page and the CLI itself live outside this repository (`gecko-project-backend`,
  `frontendx`, `gecko-cli`).

## Trade-off

The tab cannot tell a late request from a clock that runs ahead: both are past `expiresAt`, and both are `expired`
(the message names both). Only a stamp more than 30 s ahead of the tab is `clock-skew`. A result's `data` whose
escaped JSON does not fit in three 16 KB chunks is `too-large`, even under `dataMaxBytes`: a fixed bound keeps the
CLI's check simple.
