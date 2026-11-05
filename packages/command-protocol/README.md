# @dolusoft/command-protocol

The JSON types of [Command Console](https://github.com/dolusoft/command-console), its line tokenizer, and the pure
functions over command input schemas, option lines and the envelope. No dependencies, no framework, no DOM.

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
  `null` when redacted, `redacted`, `status: 'submitted' | 'cancelled'`, optional `actor`: `'user'`, `'assistant'` or
  `'external-agent'`, a label for the history and never a permission) or an `OutputEntry` (`id`,
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
  `interrupted`, `invalid-args` (`{ path, reason }`: the first error of a command's options, `reason` an
  `InputErrorCode`) and `operation-failed` (`{ code }`: an `ErrorCode`, for an operation that ended without running its
  command). For a sensitive line `name`, `index` and `path` are `null`.
- **Commands**: `CommandSpec` is the JSON part of a command (`name`, `aliases`, `summary`, `usage`, `hidden`,
  `sensitive: boolean | { fromArg }`, `input` (its input schema, below), `danger: 'read' | 'change' | 'irreversible'`).
  `CommandResponse` is what a command may return (`output`, `tone`, `quiet`, `effects`, `summary`, a short result
  of at most 200 characters for the caller of an operation, and `data`, a JSON result for that caller that is never
  drawn, at most `dataMaxBytes` (32768) bytes as UTF-8 JSON).
- **Outcomes** (`CommandOutcome`): `{ status: 'ok', summary?, data? }` or
  `{ status: 'error', code: ErrorCode, message?, line? }`, how an operation ended for its caller; `line` comes only
  with `not-allowed`, the line of a `change` command the user may type. `ErrorCode` is `invalid-args`, `unknown-command`, `not-allowed`,
  `target-not-found`, `id-conflict`, `unsupported-version`, `too-large`, `busy`, `timeout`, `failed`,
  `connection-lost` or `cancelled`.
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

## Input schemas

A command's `input` is a small subset of JSON Schema. The root is `type: 'object'`; a node is one of:

| `type`              | Keywords besides `description` and `default` |
| ------------------- | -------------------------------------------- |
| `string`            | `enum`, `minLength`, `maxLength`, `pattern`  |
| `number`, `integer` | `enum`, `minimum`, `maximum`                 |
| `boolean`           | none                                         |
| `array`             | `items` (required), `maxItems`; no `default` |
| `object`            | `properties`, `required`                     |

`checkInputSchema(schema)` throws a `TypeError` naming the path for anything else: another keyword, a keyword on a
type it does not apply to, a property name that does not match `^[A-Za-z][A-Za-z0-9_-]*$`, a `pattern` that does
not compile with the `u` flag, a `required` name that is not a property, a `default` the node rejects, or objects and
arrays nested deeper than the input limits allow. Nothing is ignored.

`validateInput(schema, value)` returns `{ ok: true, value }` with a new value (an optional field missing from an
object takes its `default`, an absent optional array is `[]`) or `{ ok: false, errors }` with every error as
`{ path, code }`: `path` is `ip`, `filter.ip`, `tags[2]` or `''` for the root, and the value is never in it. The codes
are `type` (an `integer` wants a whole number), `required`, `additional` (a field not in `properties`), `limit` and
the name of the failed keyword. Lengths count code points; a `pattern` is not anchored.

Every value is held to `inputLimits` whatever its schema allows: strings of at most 1000 code points
(`maxTextLength`), arrays of at most 50 items (`maxArrayLength`), objects and arrays at most 3 deep, the root object
being 1 (`maxDepth`). Beyond them the code is `limit`.

### Option lines

A command with a schema is written `name --field value …`. `parseOptions(args, schema)` takes the token values after
the name and returns what `validateInput` returns:

```ts
import {
  formatCommandLine,
  type InputSchema,
  parseOptions,
  tokenize
} from '@dolusoft/command-protocol'

const schema: InputSchema = {
  type: 'object',
  properties: {
    ip: { type: 'string' },
    limit: { type: 'integer', default: 100 },
    verbose: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } }
  },
  required: ['ip']
}

const args = tokenize('search --ip 10.0.0.5 --verbose --tags a --tags b')
  .tokens.slice(1)
  .map(t => t.value)
parseOptions(args, schema)
// { ok: true, value: { ip: '10.0.0.5', limit: 100, verbose: true, tags: ['a', 'b'] } }

formatCommandLine('search', { ip: '10.0.0.5', tags: [] }, schema)
// 'search --ip 10.0.0.5 --limit 100'
```

A value converts to its field's type: a number as JSON writes it, an object (or an array item that is an object or
an array) as JSON text, a string as is even when it starts with `--`. A boolean field alone is `true` and also takes
`true` or `false`. An array field repeats its name; an absent one is `[]`. An unknown name, or a token that is not a
name, is `additional`; a name without its value, or a second value of a field that is not an array, is `type`.

`formatCommandLine(command, value, schema)` writes the canonical line: the fields of the validated value in the order
of `properties`, every token through `quoteArgument`, `true` as the bare `--name` and `false` as `--name false`. Its
tokens after the name read back with `parseOptions` to the same value. A value the schema rejects throws.

## Envelope

An `Envelope` carries one request between the tabs of a user; the consumer's transport moves it, the protocol only
describes and checks it:

```json
{
  "v": 1,
  "id": "3f0c6c1e-6d1b-4a8e-9b7e-2a4c1f2d9e10",
  "kind": "request",
  "actor": "user",
  "from": { "tab": "t-5b21" },
  "target": { "tab": "t-5b21", "view": "v-91c0" },
  "command": "dataview.search",
  "args": { "ip": "10.0.0.5", "from": "2026-11-04T18:40:00Z" }
}
```

`parseEnvelope(raw)` reads what came from the transport and never changes it. It returns `{ ok: true, envelope }`
with a new envelope that holds only the known fields, or `{ ok: false, code }`: `unsupported-version` for a plain
object whose `v` is a number other than 1, `too-large` when its UTF-8 JSON is over `envelopeMaxBytes` (16384,
measured on the raw value), `invalid` for a missing or mistyped field, another `kind`, or `args` that is not a JSON
object within the input limits. A `null` `target.view`, which a typed transport may write back, is no view and is
left out. `envelopeBytes(envelope)` is the UTF-8 length of its JSON, for a sender to measure before it sends.

## License

MIT, see [LICENSE.md](./LICENSE.md).
