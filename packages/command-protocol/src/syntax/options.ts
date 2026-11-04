// The line form of a command with an input schema (C-73, C-74):
// `dataview.search --ip 10.0.0.5 --limit 50 --verbose --tags a --tags b`.

import type { InputSchema, InputSchemaNode } from '../input/schema'
import {
  define,
  type InputError,
  type InputResult,
  validateInput
} from '../input/validate'
import type { JsonValue } from '../json'
import { quoteArgument } from './quote'

// A number as JSON writes it (and `String(number)` gives it back).
const jsonNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

/**
 * Reads the tokens after the command name (`tokenize` values) into the
 * object `schema` describes. Each field is a `--name value` pair; the value
 * converts to the field's type: a number as JSON writes it, an object (or an
 * array item that is an object or an array) as JSON text, a string as is,
 * even when it starts with `--`. A boolean field alone is `true` and also
 * takes a following `true` or `false`. An array field repeats its name; an
 * absent one is `[]`. An unknown name, or a token that is not a name, is
 * `additional`; a name without its value, or a second value of a field that
 * is not an array, is `type`. The result is then checked by `validateInput`,
 * and its errors follow the line's.
 */
export function parseOptions(
  args: readonly string[],
  schema: InputSchema
): InputResult {
  const properties = schema.properties ?? {}
  const errors: InputError[] = []
  const value: Record<string, JsonValue> = {}
  let i = 0
  while (i < args.length) {
    const token = args[i++]
    if (!token.startsWith('--') || token === '--') {
      errors.push({ path: '', code: 'additional' })
      continue
    }
    const name = token.slice(2)
    if (!Object.hasOwn(properties, name)) {
      errors.push({ path: name, code: 'additional' })
      // The unknown name's value goes with it.
      if (i < args.length && !args[i].startsWith('--')) {
        i++
      }
      continue
    }
    const node = properties[name]
    let field: JsonValue
    if (node.type === 'boolean') {
      const next = args[i]
      field = next === 'false' ? false : true
      if (next === 'true' || next === 'false') {
        i++
      }
    } else if (i < args.length) {
      field = convert(node.type === 'array' ? node.items : node, args[i++])
    } else {
      errors.push({ path: name, code: 'type' })
      continue
    }
    if (node.type === 'array') {
      const list = Object.hasOwn(value, name)
        ? (value[name] as JsonValue[])
        : []
      list.push(field)
      define(value, name, list)
    } else if (Object.hasOwn(value, name)) {
      errors.push({ path: name, code: 'type' })
    } else {
      define(value, name, field)
    }
  }
  for (const name of Object.keys(properties)) {
    if (properties[name].type === 'array' && !Object.hasOwn(value, name)) {
      define(value, name, [])
    }
  }
  const result = validateInput(schema, value)
  if (errors.length === 0) {
    return result
  }
  return {
    ok: false,
    errors: result.ok ? errors : [...errors, ...result.errors]
  }
}

/**
 * The value of one token for `node`. A token that does not convert stays a
 * string, which `validateInput` then reports as a `type` error.
 */
function convert(node: InputSchemaNode, token: string): JsonValue {
  switch (node.type) {
    case 'number':
    case 'integer':
      return jsonNumber.test(token) ? Number(token) : token
    case 'boolean':
      return token === 'true' ? true : token === 'false' ? false : token
    case 'array':
    case 'object':
      try {
        return JSON.parse(token) as JsonValue
      } catch {
        return token
      }
    case 'string':
      return token
  }
}

/**
 * The token of one value: a string as is, anything else as JSON (for a
 * number or a boolean that is `String(value)`).
 */
function written(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * The canonical line of a command call: the command name, then each field
 * of the validated value (defaults filled) in the order of the schema's
 * `properties`, every token through `quoteArgument`. `true` is the bare
 * `--name`, `false` is `--name false`, an array repeats its name per item.
 * `parseOptions` reads its tokens after the first back to the validated
 * value. Throws a `TypeError` when `validateInput` rejects `value`.
 */
export function formatCommandLine(
  command: string,
  value: Record<string, JsonValue>,
  schema: InputSchema
): string {
  const checked = validateInput(schema, value)
  if (!checked.ok) {
    throw new TypeError(
      `formatCommandLine: the value does not match the schema (${checked.errors
        .map(e => `${e.code} at "${e.path}"`)
        .join(', ')})`
    )
  }
  const properties = schema.properties ?? {}
  const parts = [quoteArgument(command)]
  for (const name of Object.keys(properties)) {
    if (!Object.hasOwn(checked.value, name)) {
      continue
    }
    const node = properties[name]
    const field = checked.value[name]
    const option = quoteArgument(`--${name}`)
    if (node.type === 'boolean') {
      parts.push(field === true ? option : `${option} false`)
    } else if (node.type === 'array') {
      for (const item of field as JsonValue[]) {
        parts.push(option, quoteArgument(written(item)))
      }
    } else {
      parts.push(option, quoteArgument(written(field)))
    }
  }
  return parts.join(' ')
}
