# Changelog

The release notes of a version are on its GitHub Release. This file names what a consumer must change.

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
