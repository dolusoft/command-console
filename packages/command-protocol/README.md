# @dolusoft/command-protocol

The JSON types of [Command Console](https://github.com/dolusoft/command-console) and its line tokenizer. No
dependencies, no framework, no DOM.

```sh
pnpm add @dolusoft/command-protocol
```

Most consumers use it through `@dolusoft/command-console` (which re-exports its types) or
`@dolusoft/command-console-core`. Use it directly when a server or a test builds console output, or to split a line the way the console does.

## Types

Every type here is plain JSON: finite numbers only, no `undefined` (an optional field without a value is absent), and
a value survives `JSON.parse(JSON.stringify(x))` unchanged. `JsonValue`, `JsonPrimitive` and `isJsonValue` describe and
check it. Functions (a command's `run` and `complete`, callbacks) live in the core, never here.

- **Entries** of the scrollback: `ConsoleEntry` is an `InputEntry` (`id`, `prompt` when the line ended, `text` or
  `null` when redacted, `redacted`, `status: 'submitted' | 'cancelled'`) or an `OutputEntry` (`id`,
  `tone: 'default' | 'error' | 'notice'`, `blocks`, optional `inputId` of the line it answers, optional `quiet: true`
  for output a live region should not read out).
- **Blocks** of an output entry (`OutputBlock`), never HTML:

  | Block     | Fields                                                               |
  | --------- | -------------------------------------------------------------------- |
  | `text`    | `text`                                                               |
  | `json`    | `value: JsonValue`                                                   |
  | `table`   | `columns: { key, label }[]`, `rows: Record<string, JsonPrimitive>[]` |
  | `list`    | `items: string[]`                                                    |
  | `message` | `code: MessageCode`, `params?` (made by the library)                 |
  | `custom`  | `kind`, `data?: JsonValue` (drawn by the consumer)                   |

- **Messages** (`MessageCode`, `MessageParams`): the library writes no text, only codes. `command-not-found`
  (`{ name }`), `command-failed` (no params: the error's text is never shown), `unterminated-quote` (`{ index }`),
  `interrupted`. For a sensitive line `name` and `index` are `null`.
- **Commands**: `CommandSpec` is the JSON part of a command (`name`, `aliases`, `summary`, `usage`, `hidden`,
  `sensitive: boolean | { fromArg }`). `CommandResponse` is what a command may return (`output`, `tone`, `quiet`,
  `effects`).
- **Effects** (`ConsoleEffect`): `clear`, `close`, `push-context` (`frame`), `pop-context` (`count?`, default 1),
  `reset-context`, `clear-recall`. They apply in order, before the response's output.
- **Context frames** (`ContextFrame`): `{ id, prompt, data? }`. The top frame's `prompt` is the prompt of the next line.

## Line syntax

Whitespace (tabs included) separates tokens. `'…'` groups literally. `"…"` groups, and inside it `\"` and `\\` are the
only escapes. Outside quotes `\` is an ordinary character, so `C:\data` stays `C:\data`. Adjacent parts join one token
(`a"b c"d` is `ab cd`); `''` and `""` give an empty token. There is no line continuation.

```ts
import { quoteArgument, tokenize } from '@dolusoft/command-protocol'

tokenize(`set title "Hello \\"world\\""`).tokens.map(t => t.value)
// ['set', 'title', 'Hello "world"']

const result = tokenize(`set title 'Hello`)
// result.ok === false, result.error: { code: 'unterminated-quote', index: 10 }
// result.tokens still holds the tolerant tokens; the last one has open: true

const args = ['set', 'path', 'C:\\Program Files']
const line = args.map(quoteArgument).join(' ')
// "set path 'C:\\Program Files'", which tokenizes back to the same three values
```

Each `Token` has its `value` (quotes removed), `start` and `end` (UTF-16 offsets into the line, `end` exclusive,
covering the raw text including its quotes), `quoted` and `open`. An unclosed quote gives `ok: false` with the index of
the opening quote, and the tokens are still returned: the last one is `open` and runs to the end of the line. The
console refuses such a line; completion works on the tolerant tokens. Nothing is ever dropped.

`quoteArgument(value)` returns the shortest of: the bare value, `'value'`, or `"value"` with escapes; it always
tokenizes back to `value`.

## License

MIT, see [LICENSE.md](./LICENSE.md).
