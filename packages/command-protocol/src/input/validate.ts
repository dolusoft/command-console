import type { JsonValue } from '../json'
import {
  type ArrayInputSchema,
  inputLimits,
  type InputSchema,
  type InputSchemaNode,
  type NumberInputSchema,
  type StringInputSchema
} from './schema'

/**
 * Why a value failed: `type` (wrong type, or a fraction for an `integer`),
 * `required` (a required field is missing), `additional` (a field the schema
 * does not know), `limit` (beyond `inputLimits`), or the name of the keyword
 * that failed.
 */
export type InputErrorCode =
  | 'type'
  | 'required'
  | 'enum'
  | 'minimum'
  | 'maximum'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'maxItems'
  | 'additional'
  | 'limit'

/**
 * One error of an input value. `path` names the field (`ip`, `filter.ip`,
 * `tags[2]`; `''` for the root). It never carries the value, which may be a
 * secret.
 */
export interface InputError {
  path: string
  code: InputErrorCode
}

/** The checked copy of an input value, or every error found in it. */
export type InputResult =
  | { ok: true; value: Record<string, JsonValue> }
  | { ok: false; errors: InputError[] }

/**
 * Checks `value` against `schema` (one that `checkInputSchema` accepted) and
 * the input limits. Returns a new value, never the input: an optional field
 * missing from an object takes its `default`, an absent optional array is
 * `[]`. Every error is returned, not the first only.
 */
export function validateInput(
  schema: InputSchema,
  value: unknown
): InputResult {
  const errors: InputError[] = []
  const result = validateNode(schema, value, '', 1, errors)
  return errors.length === 0
    ? { ok: true, value: result as Record<string, JsonValue> }
    : { ok: false, errors }
}

/**
 * The copy of `value` checked against `node` at `depth` (the root object is
 * 1); errors are pushed to `errors`. On an error the copy is incomplete.
 */
export function validateNode(
  node: InputSchemaNode,
  value: unknown,
  path: string,
  depth: number,
  errors: InputError[]
): JsonValue {
  switch (node.type) {
    case 'string':
      return validateString(node, value, path, errors)
    case 'number':
    case 'integer':
      return validateNumber(node, value, path, errors)
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push({ path, code: 'type' })
        return null
      }
      return value
    case 'array':
      return validateArray(node, value, path, depth, errors)
    case 'object':
      return validateObject(node, value, path, depth, errors)
  }
}

/**
 * Sets an own, enumerable field, so that a name such as `__proto__` is a
 * field and never the prototype.
 */
export function define(
  target: Record<string, JsonValue>,
  name: string,
  value: JsonValue
): void {
  Object.defineProperty(target, name, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  })
}

/** The number of code points of `text`. */
export function codePoints(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    // A high surrogate followed by a low one is one code point.
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++
      }
    }
    count++
  }
  return count
}

/** Whether `value` is a plain object (prototype `Object.prototype` or null). */
export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validateString(
  node: StringInputSchema,
  value: unknown,
  path: string,
  errors: InputError[]
): JsonValue {
  if (typeof value !== 'string') {
    errors.push({ path, code: 'type' })
    return null
  }
  const length = codePoints(value)
  if (length > inputLimits.maxTextLength) {
    errors.push({ path, code: 'limit' })
    return null
  }
  if (node.enum !== undefined && !node.enum.includes(value)) {
    errors.push({ path, code: 'enum' })
  }
  if (node.minLength !== undefined && length < node.minLength) {
    errors.push({ path, code: 'minLength' })
  }
  if (node.maxLength !== undefined && length > node.maxLength) {
    errors.push({ path, code: 'maxLength' })
  }
  if (
    node.pattern !== undefined &&
    !new RegExp(node.pattern, 'u').test(value)
  ) {
    errors.push({ path, code: 'pattern' })
  }
  return value
}

function validateNumber(
  node: NumberInputSchema,
  value: unknown,
  path: string,
  errors: InputError[]
): JsonValue {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (node.type === 'integer' && !Number.isInteger(value))
  ) {
    errors.push({ path, code: 'type' })
    return null
  }
  if (node.enum !== undefined && !node.enum.includes(value)) {
    errors.push({ path, code: 'enum' })
  }
  if (node.minimum !== undefined && value < node.minimum) {
    errors.push({ path, code: 'minimum' })
  }
  if (node.maximum !== undefined && value > node.maximum) {
    errors.push({ path, code: 'maximum' })
  }
  return value
}

function validateArray(
  node: ArrayInputSchema,
  value: unknown,
  path: string,
  depth: number,
  errors: InputError[]
): JsonValue {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    errors.push({ path, code: 'type' })
    return null
  }
  const items = value as unknown[]
  if (
    depth > inputLimits.maxDepth ||
    items.length > inputLimits.maxArrayLength
  ) {
    errors.push({ path, code: 'limit' })
    return null
  }
  if (node.maxItems !== undefined && items.length > node.maxItems) {
    errors.push({ path, code: 'maxItems' })
  }
  const result: JsonValue[] = []
  for (let i = 0; i < items.length; i++) {
    // A hole reads as `undefined`, which no node accepts.
    result.push(
      validateNode(node.items, items[i], `${path}[${i}]`, depth + 1, errors)
    )
  }
  return result
}

function validateObject(
  node: InputSchema,
  value: unknown,
  path: string,
  depth: number,
  errors: InputError[]
): JsonValue {
  if (!isPlainObject(value)) {
    errors.push({ path, code: 'type' })
    return null
  }
  if (depth > inputLimits.maxDepth) {
    errors.push({ path, code: 'limit' })
    return null
  }
  const properties = node.properties ?? {}
  const result: Record<string, JsonValue> = {}
  for (const name of Object.keys(properties)) {
    const child = properties[name]
    const at = path === '' ? name : `${path}.${name}`
    if (Object.hasOwn(value, name)) {
      define(
        result,
        name,
        validateNode(child, value[name], at, depth + 1, errors)
      )
    } else if (node.required?.includes(name) === true) {
      errors.push({ path: at, code: 'required' })
    } else if (child.type === 'array') {
      define(result, name, [])
    } else if (child.default !== undefined) {
      // Validated as a value, so an object default is a new copy with its
      // own defaults filled.
      define(
        result,
        name,
        validateNode(child, child.default, at, depth + 1, errors)
      )
    }
  }
  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(properties, name)) {
      errors.push({
        path: path === '' ? name : `${path}.${name}`,
        code: 'additional'
      })
    }
  }
  return result
}
