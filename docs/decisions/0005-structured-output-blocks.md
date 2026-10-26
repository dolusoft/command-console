# 0005 Output is structured blocks, never HTML

Status: Accepted (2026-10-26)

## Context

The frontendx console renders command output as HTML strings, including highlighted JSON from highlight.js. HTML output is an injection risk (S-08), it cannot be checked against a DOM contract, and a screen reader gets whatever markup the command produced.

## Decision

A command returns structured blocks: `text`, `json`, `table`, `list`, `message` and `custom`. The Vue package renders each with native elements (`pre`, `table` with `th scope="col"`, `ul`/`li`, `div`) and escapes all text through Vue interpolation. `v-html` is an ESLint error (`vue/no-v-html`). A `block-<type>` slot replaces the rendering of one block type; a `custom` block without a slot renders a `pre` of its JSON.

## Consequences

- Output is JSON (P4, C-06): it can be stored, compared and sent over a wire.
- For frontendx: the highlight.js colouring of `show` moves into a `block-json` (or `block-custom`) slot, where the consumer owns the markup.

## Trade-off

A command that wants rich output declares a block type and a slot instead of returning markup. That is more ceremony than a string of HTML, and it is the price of never rendering markup the library did not build.
