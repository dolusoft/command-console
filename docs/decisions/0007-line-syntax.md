# 0007 Line syntax

Status: Accepted (2026-10-26)

## Context

The frontendx console splits lines on spaces, strips backslashes, supports a line continuation and lets each command strip its own quotes (B-11, B-18, D-10). Paths with spaces and Windows paths with backslashes are hard to type, and the handlers disagree about quoting.

## Decision

- Shell-like quoting: whitespace (tabs included) separates tokens; single quotes group literally; double quotes group with escapes inside them only; a backslash outside double quotes is an ordinary character (Q-05).
- No line continuation and no multi-line input (Q-02).
- The tokenizer keeps the raw span of every token and drops no character; `quoteArgument` round-trips with it (C-10).
- An unterminated quote gives the `unterminated-quote` message and runs nothing; a tolerant mode of the tokenizer marks the open token, so completion works inside an open quote (C-11, C-43).

## Consequences

- Handlers receive arguments with grouping quotes removed: in frontendx the `set` handler's own quote stripping goes.
- A Windows path is typed as is outside double quotes.

## Trade-off

The syntax is not a full shell: no variables, no globbing, no pipes. A console whose commands are JavaScript functions does not need them, and each would be a second language to learn.
