# 0015 CLI isolation: argv, suggestions and capabilities in the tab

Status: Accepted (2026-11-10)

Extends [ADR 0014](0014-remote-entry.md).

## Context

With 1.6 the desktop CLI still knew lines: it joined the shell's argv into one line, guessed near command names,
turned bare words into `--field value`, built the "to run it" line of a preview and the next page of a paged result,
and kept a table of error codes for its exit code. Each of these copies a rule the tab already owns (the commands,
their schemas, their aliases, what is sensitive), and each drifts when a command changes. The CLI is being rewritten
(the gecko-cli Rust migration specification, §4 and §5), and the rewrite should not carry that knowledge.

The capabilities were a reply sent through the binding like any other. A long command list did not fit in one
envelope, and the hub could not give the list to a CLI that connects after the tab.

## Decision

- **The CLI does not read lines.** A `cli-request` carries `argv` or `line`. `argv` is never joined: its first item is
  the command and the rest are the option tokens as they are. A `line` keeps its 1.6 reading for the options.
- **One name rule on both sides.** The command is the first part, found by exact name or alias with the ASCII case
  ignored. In a line its name ends at the first ECMAScript `WhiteSpace` or `LineTerminator`, raw (a quoted or
  escaped name is refused), and every name must match `^[A-Za-z][A-Za-z0-9._-]*$`. The local tokenizer already
  separates on exactly that set (`\s`); it was measured, not changed. The local terminal and `request()` keep their
  exact, case-sensitive lookup. `fixtures/remote/command-name.json` is run against `attachRemote`.
- **The tab writes what the CLI prints.** `finished` carries `class` on every error, and argv the CLI prints with its
  own quoting and prefix, never runs: `suggest` (nearest name of an unknown command, positional fix, a preview with its
  confirm field `true`, the canonical argv of a refused change), `next` (a page's `nextCursor` into the command's
  `cursor` field) and `help` (the command of an `invalid-args`). `outcome.line` does not go to the CLI. A sensitive
  request's refusal carries no message and no hint (P16).
- **`received` speaks for the request.** `change` comes from the normalized input; `viewRelevant` is `true` when the
  command runs in a view (the request's, else the active view on accept). No command declares a view of its own, so
  this is the narrowest criterion the code supports. `status({ command })` lets the shell give a data age for the
  command it concerns only.
- **The capabilities are published, not sent.** `RemoteBinding.publishCapabilities({ revision, parts })` hands the
  hub the list in one to three parts of at most 16 KB; the hub keeps it whole and gives it to any CLI. `revision`
  is a hash of the commands and the sensitive names (FNV-1a, no clock, no randomness). A list that does not fit makes
  `attachRemote` throw. `minCli` comes from the binding.
- **No compatibility path.** The 1.6 `capabilities` reply and its `confirm` field are gone; no live environment
  speaks the old form.

## Consequences

- The shell (frontendx) implements `publishCapabilities` against the hub, passes `minCli` when it has one and answers
  `status({ command })` per command. Its own help, suggestion and class code can go once `help-request` is handled
  by the core (the next step of 1.7.0).
- Rules C-97, C-98, C-100 and C-110 to C-112 describe the behavior; `formatCommandArgv` is the one canonical argv.
- Changing the name rule, the near-name rule or the meaning of `viewRelevant` is a change of the remote contract.
