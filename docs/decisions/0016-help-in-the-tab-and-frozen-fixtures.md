# 0016 Help in the tab and frozen fixtures

Status: Accepted (2026-11-10)

Extends [ADR 0015](0015-cli-isolation.md) and [ADR 0008](0008-npm-distribution.md).

## Context

After ADR 0015 the CLI still drew its own help: the shell (frontendx `cliHelp.ts`) ran the agent's `help` tool for a
`help-request` with a free `input` object, and the CLI turned the JSON into lines, guessed whether a word was a
command or a namespace, and wrote the "next page" line. That is the same line knowledge ADR 0015 took out of the CLI.

The remote contract is now read by two implementations that ship apart (the core on npm, the CLI as a binary). Its
fixtures are the examples both sides test against; a published example that changes later breaks the side that was
released against it, without a test failing on the side that changed it.

## Decision

- **The core answers `help-request`.** The remote entry handles it as it handles a `cli-request`: the stamp, the
  binding and a seen id are checked the same way, and an unreadable one with a readable id is answered with an error.
  It is answered while a command runs and never asks for approval. The `argv` after `help` is read in the tab: the
  target, `--cursor` and `--limit`. The content is the agent's `help` (the code is shared, `core/dispatch/help.ts`)
  over the commands the CLI may run. An unknown target gets the nearest name, as an unknown command does; a sensitive
  one gets nothing.
- **The tab writes the lines.** `want: 'text'` gives English lines wrapped to the CLI's width, with no colour, no
  control character and no CLI name, at most 12 KB as JSON; a page that does not fit gets fewer commands and a
  `next`. `want: 'json'` gives the tool's result. The CLI prints either as it is.
- **Published fixtures are frozen.** Each release attaches `fixtures/remote/` and `docs/remote-contract.md` as
  `remote-fixtures-<version>.tar.gz`. This is a GitHub Release asset, not a package: npm stays the only channel for
  the packages (ADR 0008). CI compares the folder with the latest release's archive on every pull request: an
  example may be added, never changed or removed. A download that fails fails the check, with a message to run it
  again; a release without the archive passes.

## Consequences

- The shell drops its own help handling (`cliHelp.ts`) and passes `help-request` messages to the gate like any other
  CLI message.
- The agent's `help` tool and the CLI's help cannot drift: one function makes both.
- Rules C-113 and C-114 describe the behavior. Changing a published fixture needs a new example with a new name, or
  a new envelope version (the gecko-cli Rust migration specification, §6).
- The CI check needs the network and the `gh` CLI; it is not part of `pnpm test`.
