# Changelog

The release notes of a version are on its GitHub Release. This file names what a consumer must change.

## 1.7.0 (in progress)

The remote contract of the CLI isolation ([docs/remote-contract.md](docs/remote-contract.md)). It does not speak the
1.6 shapes.

- **Changed in the protocol:** `cli-request` takes `argv` or `line` (C-106); `received` adds `change` and
  `viewRelevant`; an error `outcome` carries `class` (`ErrorClass`, `errorClassOf`; C-105) and no longer `line`;
  `finished` adds `suggest`, `next` and `help`. **New:** `help-request` and `help-result` (C-107),
  `CapabilitiesPayload`, `capabilitiesParts`, `readCapabilitiesParts`, `remoteFeatures`, `remoteEnvelopes`,
  `remoteArgvMaxItems` (C-108), and `fixtures/remote/` (C-109). **Removed:** `CapabilitiesReply` and
  `RemoteCommandSpec.confirm`. A CLI that reads replies reads `class` for its exit code.

## 1.6.1

Two fixes of the remote entry.

- **Fixed: the preview decision reads the normalized input** (C-95). A command whose `normalize` sets its `confirm`
  field is the change for the CLI (an approval plan) and for the agent (`not-allowed` with its line), no longer a
  preview that runs at once. `normalize` is called once per request. Nothing for a consumer to change.
- **Fixed: a CLI request the tab cannot read gets an answer** (C-98). When its id and origin can be read it ends with
  `finished` (`invalid-args`, `unsupported-version` or `too-large`) instead of silence. **New in the protocol:**
  `refusedCliRequest(raw)` (C-96).

## 1.6.0

The remote entry of a desktop CLI (ADR 0014).

- **New: `attachRemote(binding)`, `detachRemote()`, `suspendRemote()`, `approve(id)`, `reject(id)`** in the core,
  with the `now` option, `state.remote` and a command's `plan(input, signal)` (C-97 to C-101). The protocol gains
  the remote envelopes (`parseCliMessage`, `CliReply`, `chunkData`, `joinChunks`, `isCliReply`; C-96).
- **New: `CommandSpec.confirm: { field }`** (C-95). A `change` command that declares it runs its preview as `read`
  when the field is not `true`. **Changed:** for such a command, the agent's `run` without the field now runs the
  preview instead of answering `not-allowed`. Commands without `confirm` are unchanged.
- **Changed: types that grow.** `ConsoleState.remote` (`null` without a binding), `RunningCommand.phase` adds
  `approving`, `Actor` adds `cli`, `ErrorCode` adds `expired`, `clock-skew`, `not-delivered`, `tab-unreachable`,
  `gone` and `unknown-outcome`. A consumer that compares the whole state, or switches over every phase, actor or code
  without a default, adds them.
- **New in the component:** `.cc-remote`, `.cc-approval`, `.cc-pairing`, the `pairing` prop, the `detach-remote`
  and `pair` events, `labels.remote`, `labels.formatTime` and `labels.actors.cli` (C-102 to C-104).

## 1.5.0

- **New: an agent skill in `@dolusoft/command-console-core`.** `skills/command-console/SKILL.md` (Agent Skills
  format) says how an agent works with `context`, `help` and `run` (ADR 0013). Nothing for a consumer to change; to
  use it, copy it into the agent's skills directory.

## 1.4.1

- **Changed: `run` of `help` or `context`.** Refused as `not-allowed` or `unknown-command`, the agent's `run` tool
  said only the user could run it; its `message` now says to call the `help` or `context` tool instead (C-83). The
  code stays. Nothing for a consumer to change.

## 1.4.0

Which namespace, and why not (ADR 0012, second addendum of 2026-11-05).

- **Changed: the `not-allowed` outcome of `request()` and the `run` tool.** It was `{ status: 'error', code }`; before
  the line is accepted it is now `{ status: 'error', code: 'not-allowed', message, line? }`. `message` says why (a
  `change` command only the user runs, an `irreversible` one never runs, a command not open to agents, a sensitive
  line, another actor). `line` comes with a `change` command whose options match and whose line is not sensitive:
  its canonical line, before `normalize`, for the agent to suggest to the user (C-93). `CommandOutcome` gains
  `line?`. A `beforeRun` refusal stays `{ status: 'error', code: 'not-allowed' }`. A consumer that compares a
  `not-allowed` outcome whole compares `code`.
- **Changed: the agent's `help` without `command`.** `namespaces` items are `{ name, count, summary? }` (C-94).
- **Changed: the descriptions of the `help` and `run` tools.** They say what `danger` means and give the outcome as
  `{ status: "error", code, message?, line? }`.
- New console option `namespaces: [{ name, summary? }]` (summary a string or a function, read when used) and method
  `getNamespaces()`; a consumer registers one line per namespace so the agent can pick the module, and its own `help`
  command can show the same text. Names are validated (no whitespace, quotes or dot; given once).

## 1.3.0

What an agent reads back (ADR 0012, addendum of 2026-11-05).

- **Changed: the output of the agent's `help` without `command`.** It was an array of `{ name, summary, danger }`; it
  is now `{ namespaces: [{ name, count }], commands: [{ name, summary, danger }], nextCursor? }`, one page of at most
  `limit` commands (30 by default, 100 at most, 8 KB of JSON). `prefix` keeps one namespace, `cursor` takes the
  `nextCursor` of the previous page (C-92). A consumer that reads this output reads `commands`.
- An `error` outcome may carry `message`: the schema's refusal in words, or the message of a `CommandError` thrown by
  the command's `run` (C-89). Other errors give none.
- `request({ command })` and the `run` tool take a command without `args` (`{}`).
- A command's `summary` may be a function, called each time a spec is made: `summary: () => t('help.rows')` (C-90).
- A string given where the schema wants an array of strings becomes a list of that one string before the check
  (C-91); splitting it stays the command's `normalize`.
