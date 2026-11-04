# Changelog

The release notes of a version are on its GitHub Release. This file names what a consumer must change.

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
