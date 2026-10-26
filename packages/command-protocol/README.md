# @dolusoft/command-protocol

The JSON types of [Command Console](https://github.com/dolusoft/command-console) and its line tokenizer. No
dependencies, no framework, no DOM.

It holds:

- the entries of the scrollback (`ConsoleEntry`, `InputEntry`, `OutputEntry`) and their output blocks (`OutputBlock`,
  `MessageCode`, `MessageParams`);
- the JSON part of a command (`CommandSpec`), what it returns (`CommandResponse`), the changes it asks for
  (`ConsoleEffect`) and the context stack (`ContextFrame`);
- `JsonValue` and `isJsonValue`: every type above is plain JSON with finite numbers only;
- the line syntax: `tokenize` and `quoteArgument`.

Most consumers use it through `@dolusoft/command-console-core` or `@dolusoft/command-console`. Use it directly when a
server or a test builds console output, or to split a line the way the console does.

```sh
pnpm add @dolusoft/command-protocol
```

## Line syntax

Whitespace (tabs included) separates tokens. `'…'` groups literally. `"…"` groups, and inside it `\"` and `\\` are the
only escapes. Outside quotes `\` is an ordinary character, so `C:\data` stays `C:\data`. Adjacent parts join one token.

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

`quoteArgument(value)` returns the shortest of: the bare value, `'value'`, or `"value"` with escapes.

## License

MIT, see [LICENSE.md](./LICENSE.md).
