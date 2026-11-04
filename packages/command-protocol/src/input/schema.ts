import type { JsonValue } from '../json'

// The input schema of a command: a small subset of JSON Schema, checked by
// `checkInputSchema` and applied by `validateInput`. Every node is JSON (P4).

/** A string field. Lengths count code points. */
export interface StringInputSchema {
  type: 'string'
  description?: string
  /** The only values allowed. */
  enum?: string[]
  minLength?: number
  maxLength?: number
  /** A regular expression (compiled with the `u` flag), not anchored. */
  pattern?: string
  default?: string
}

/** A number field; `integer` wants a whole number. */
export interface NumberInputSchema {
  type: 'number' | 'integer'
  description?: string
  /** The only values allowed. */
  enum?: number[]
  minimum?: number
  maximum?: number
  default?: number
}

/** A boolean field. */
export interface BooleanInputSchema {
  type: 'boolean'
  description?: string
  default?: boolean
}

/**
 * An array field. It takes no `default`: an absent optional array is `[]`,
 * so a line, which cannot write an empty array, reads back the same.
 */
export interface ArrayInputSchema {
  type: 'array'
  description?: string
  /** The schema of every item. */
  items: InputSchemaNode
  maxItems?: number
}

/**
 * An object: the root of a command's input, or a field that holds one. A
 * field that is not in `properties` is refused.
 */
export interface InputSchema {
  type: 'object'
  description?: string
  /** The fields, in the order the canonical line writes them. */
  properties?: { [name: string]: InputSchemaNode }
  /** The fields that must be given; each is in `properties`. */
  required?: string[]
  default?: { [name: string]: JsonValue }
}

/** One node of an input schema. */
export type InputSchemaNode =
  | StringInputSchema
  | NumberInputSchema
  | BooleanInputSchema
  | ArrayInputSchema
  | InputSchema

/**
 * The limits every input value is held to, whatever its schema allows
 * (`limit` errors): a string's code points, an array's items, and how deep
 * objects and arrays nest (the root object is depth 1). The envelope's `args`
 * are held to them too.
 */
export const inputLimits: Readonly<{
  maxTextLength: number
  maxDepth: number
  maxArrayLength: number
}> = Object.freeze({ maxTextLength: 1000, maxDepth: 3, maxArrayLength: 50 })
