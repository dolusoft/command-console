# 0006 Sensitive lines

Status: Accepted (2026-10-26)

## Context

The frontendx `set` command takes configuration values, some of them secrets. Today a regex keeps `set` lines out of the recall list, but the line still reaches the scrollback, the completion list and the browser's undo history, and a quoted or differently cased command name slips past the regex (S-01 to S-04).

## Decision

- Sensitivity is declared on the command spec: `sensitive: true`, or `sensitive: { fromArg: k }` where the argument positions before `k` are safe. An optional `isSensitive` predicate marks more lines; a throwing predicate counts as a match.
- It is computed from the tokens: the first token resolves case-insensitively, quotes removed, to a command.
- Redaction is core. On every way a line ends (submit, cancel, parse error, unknown command, refusal, failure, interrupt) a sensitive line becomes an input entry with `text: null` and `redacted: true` before anything else sees the line. It never enters recall or the recall draft; messages carry `null` for the name or index; callbacks get `RunInfo`, never arguments or the line (P16).
- Completion calls no provider and opens no session at an unsafe position; safe positions get only the arguments before `fromArg`.
- The Vue package replaces the input element after a sensitive line ends, after `reset()` and after a programmatic clear of a non-empty input, renders it outside any form and without a `name`, with autocomplete, autocorrect, autocapitalize and spellcheck off.

## Consequences

- The leak matrix (C-36) checks every path: state, callback and event arguments, the DOM, the accessibility tree and the input element.
- The command's own `run` receives the full request; what it outputs is the consumer's.

## Trade-off

What the library cannot reach is not guaranteed and is listed in P16 (the IME, keyboard suggestions, screen reader history, the clipboard history, form restore). Declaring sensitivity on the command means a consumer must mark its commands; in exchange the decision no longer depends on a pattern over raw text.
