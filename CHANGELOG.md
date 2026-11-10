# Changelog

The release notes of a version are on its GitHub Release. This file names what a consumer must change.

## 1.8.0

The CLI approval level: the user binds the CLI from the tab with one line and chooses whether a change that touches
the server asks for approval. Nothing is removed; a consumer that does nothing keeps working, with one card for every
server change as before.

- **New: `effect` on a `change` command** (C-115): `'screen'` (only what the user sees) or `'server'`, the default.
  A screen change never opens an approval card. Declare `effect: 'screen'` on navigation, filter and layout
  commands; any other value throws at registration. The capabilities carry it for every change (feature `effect`).
- **New: the approval level of a binding** (C-116): `RemoteBinding.level` is `'ask-server'` (default) or
  `'never-ask'`; at `never-ask` a server change runs with no card. `console.setRemoteLevel(level)` changes it while
  bound, and `state.remote.level` shows it. `RemoteLevel` is exported from the core and the Vue package.
- **Changed: a remote change runs, `--dry-run` previews it** (C-117, feature `dry-run`). A change with `confirm` runs
  with its confirm field `true` whatever the CLI sends; `--dry-run` runs its preview. `--dry-run` on a change without
  `confirm` is `invalid-args`. A preview's `finished` no longer suggests the line with the confirm field, and a
  `not-allowed` suggestion leaves the field out. The remote help text says
  `Makes the change; with --dry-run it shows the preview.` Nothing for a consumer to change.
- **New: `finished.approval`** (C-118, feature `approval`): `'card'` or `'none'` for a change that ran, so an agent
  can tell the user what ran without their approval.
- **New in the Vue package: the "Connect CLI" row** (C-119). Set `attachable` to show it; the user picks a level and
  presses start, the panel emits `attach-remote` with the level, and the shell creates the code and gives it back as
  `attach-code` (`{ code, expiresAt }`). The panel shows `gecko attach <code>` with a copy button and a countdown;
  `null` hides it. New `RemoteLabels`: `attach`, `attachAgain`, `levelLegend`, `levelAskServer`, `levelNeverAsk`,
  `neverAskWarning`, `attachCode`, `attachLine`, `copy`, `copied`, `attachWarning`, `expiresIn`, `expired`, with
  English defaults; a translated shell adds them to its `labels.remote`. The bound row shows the level.
- **Deprecated: the `pairing` prop, the `pair` event and `PairingRequest`.** They still work; the attach row replaces
  them.

## 1.7.2

- **Fixed: a `CommandError` thrown or rejected by a command's approval `plan` reaches the CLI with its code and
  message** (C-99), as one thrown by `run` does (C-86, C-89). It was a bare `failed`. Any other error the plan throws
  stays `failed` without a message. Nothing for a consumer to change.

## 1.7.1

- **Changed: an `unknown-command` message of the remote entry names no near command** (C-111). It is
  `unknown command: <name>`; the nearest name is in `suggest` only, so the CLI prints it once. Nothing for a
  consumer to change.
- **Changed: a change the user rejected in the browser is not suggested again** (C-111). Its `finished` carries no
  `suggest`; an approval that expired or was dropped, and a `beforeRun` refusal, still suggest the canonical argv.
  Nothing for a consumer to change.

## 1.7.0

The CLI isolation (ADR 0015, ADR 0016): the tab reads the CLI's argv and writes what the CLI prints (suggestions,
help, error class). The remote contract is [docs/remote-contract.md](docs/remote-contract.md); it does not speak the
1.6 shapes, so a CLI and a shell of 1.6 do not work with 1.7.0.

**Breaking for the remote entry** (no compatibility path):

- `help-request` carries `argv`, `want` and `width`; its old `input` object is gone. `help-result` carries `status`,
  `text` or `result`, and `code`, `class`, `message`, `suggest`, `next`, `help` on an error.
- A remote `finished` no longer carries `outcome.line`; `suggest` (argv) takes its place. The local
  `CommandOutcome.line` of `request()` stays.
- The `capabilities` reply (and `CapabilitiesReply`) is gone, and so is `commands[].confirm`: the list is published
  to the hub instead of sent.
- **The shell must provide `RemoteBinding.publishCapabilities({ revision, parts })`**; `attachRemote` throws without
  it. It hands `parts` to the hub's `PublishCapabilities` as they are. `minCli` is an optional binding field.
- `RemoteBinding.status` is called as `status({ command })`; give `dataAgeMs` only for the command it concerns.

**New in the core:**

- `cli-request.argv` is run without being made a line; the command name is found by name or alias with the ASCII
  case ignored and must be written plain (C-106, C-112).
- `received` carries `change` and `viewRelevant` (C-110). `viewRelevant` is `true` when the request names a view or
  the command declares **`usesView: true`** (new optional field of `CommandDefinition`; also of
  `NamespaceDefinition`, where it applies to the namespace's commands unless a command sets its own). The active view
  alone no longer counts.
- Every remote error carries `class` (C-105). `finished` carries `suggest`, `next` and `help` (C-111): the nearest
  name of an unknown command, the `--field` form of bare words, a preview's argv with its confirm field set, the next
  page, the command to ask help for.
- **The core answers `help-request`** (C-113): text wrapped to the CLI's width or the agent `help` JSON, paged, with
  the nearest name of an unknown one. A shell that answered `help-request` itself (frontendx `cliHelp.ts`) drops that
  code and lets the gate deliver it. An unreadable `help-request` gets a `help-result` error.
- The capabilities are published in one to three parts with a `revision` (C-97, C-108).

**New in the protocol:** `argv` on `cli-request` (C-106); `ErrorClass`, `errorClassOf` (C-105);
`CapabilitiesPayload`, `capabilitiesParts`, `readCapabilitiesParts`, `remoteFeatures`, `remoteEnvelopes`,
`remoteArgvMaxItems` (C-108); `formatCommandArgv`; `refusedCliRequest` also reads a `help-request` and returns its
`kind`; `fixtures/remote/` (C-109).

**Release:** each GitHub Release attaches `remote-fixtures-<version>.tar.gz`, and CI keeps published fixture
examples unchanged (C-114).

The protocol changes in detail:

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
