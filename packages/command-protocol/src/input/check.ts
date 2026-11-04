import { inputLimits, type InputSchema, type InputSchemaNode } from './schema'
import { type InputError, isPlainObject, validateNode } from './validate'

type NodeType = InputSchemaNode['type']

/** The keywords each type takes; every other keyword throws. */
const keywords: Record<NodeType, readonly string[]> = {
  string: [
    'type',
    'description',
    'default',
    'enum',
    'minLength',
    'maxLength',
    'pattern'
  ],
  number: ['type', 'description', 'default', 'enum', 'minimum', 'maximum'],
  integer: ['type', 'description', 'default', 'enum', 'minimum', 'maximum'],
  boolean: ['type', 'description', 'default'],
  array: ['type', 'description', 'items', 'maxItems'],
  object: ['type', 'description', 'default', 'properties', 'required']
}

const propertyName = /^[A-Za-z][A-Za-z0-9_-]*$/

/**
 * Throws a `TypeError` unless `schema` is an input schema of the subset: a
 * root of `type: 'object'`; per type only its keywords; property names that
 * match `^[A-Za-z][A-Za-z0-9_-]*$`; a `pattern` that compiles with the `u`
 * flag; `required` names that are properties; containers no deeper than
 * `inputLimits.maxDepth`; a `default` the node accepts, and none on an array.
 * The message names the path of the node. Nothing is ignored. Called when a
 * command is registered.
 */
export function checkInputSchema(
  schema: unknown
): asserts schema is InputSchema {
  if (!isPlainObject(schema) || schema.type !== 'object') {
    throw new TypeError(
      'Input schema: the root must be an object schema ({ type: "object" })'
    )
  }
  checkNode(schema, '', 1)
}

function fail(path: string, problem: string): never {
  throw new TypeError(
    `Input schema at ${path === '' ? 'the root' : `"${path}"`}: ${problem}`
  )
}

function checkNode(node: unknown, path: string, depth: number): void {
  if (!isPlainObject(node)) {
    fail(path, 'a node must be a plain object')
  }
  const type = node.type
  if (typeof type !== 'string' || !Object.hasOwn(keywords, type)) {
    fail(path, `"type" must be one of ${Object.keys(keywords).join(', ')}`)
  }
  const nodeType = type as NodeType
  const allowed = keywords[nodeType]
  for (const key of Object.keys(node)) {
    if (!allowed.includes(key)) {
      const known = Object.values(keywords).some(list => list.includes(key))
      fail(
        path,
        known
          ? `the keyword "${key}" does not apply to type "${nodeType}"`
          : `the keyword "${key}" is not supported`
      )
    }
  }
  if (node.description !== undefined && typeof node.description !== 'string') {
    fail(path, '"description" must be a string')
  }
  switch (nodeType) {
    case 'string':
      checkString(node, path)
      break
    case 'number':
    case 'integer':
      checkNumber(node, path, nodeType === 'integer')
      break
    case 'boolean':
      break
    case 'array':
      checkArray(node, path, depth)
      break
    case 'object':
      checkObject(node, path, depth)
      break
  }
  if (node.default !== undefined) {
    const errors: InputError[] = []
    validateNode(
      node as unknown as InputSchemaNode,
      node.default,
      path,
      depth,
      errors
    )
    if (errors.length > 0) {
      fail(
        path,
        `the "default" does not match the node (${errors[0].code} at "${errors[0].path}")`
      )
    }
  }
}

function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function checkCount(
  node: Record<string, unknown>,
  key: string,
  path: string
): void {
  if (node[key] !== undefined && !isCount(node[key])) {
    fail(path, `"${key}" must be a whole number of at least 0`)
  }
}

function checkEnum(
  node: Record<string, unknown>,
  path: string,
  accepts: (item: unknown) => boolean
): void {
  if (node.enum === undefined) {
    return
  }
  if (
    !Array.isArray(node.enum) ||
    node.enum.length === 0 ||
    !node.enum.every(accepts)
  ) {
    fail(path, '"enum" must be a non-empty list of values of the node\'s type')
  }
}

function checkString(node: Record<string, unknown>, path: string): void {
  checkCount(node, 'minLength', path)
  checkCount(node, 'maxLength', path)
  if (
    node.minLength !== undefined &&
    node.maxLength !== undefined &&
    (node.minLength as number) > (node.maxLength as number)
  ) {
    fail(path, '"minLength" is above "maxLength"')
  }
  checkEnum(node, path, item => typeof item === 'string')
  if (node.pattern !== undefined) {
    if (typeof node.pattern !== 'string') {
      fail(path, '"pattern" must be a string')
    }
    try {
      new RegExp(node.pattern, 'u')
    } catch {
      fail(path, '"pattern" is not a valid regular expression (u flag)')
    }
  }
}

function checkNumber(
  node: Record<string, unknown>,
  path: string,
  integer: boolean
): void {
  for (const key of ['minimum', 'maximum']) {
    if (
      node[key] !== undefined &&
      !(typeof node[key] === 'number' && Number.isFinite(node[key]))
    ) {
      fail(path, `"${key}" must be a finite number`)
    }
  }
  if (
    node.minimum !== undefined &&
    node.maximum !== undefined &&
    (node.minimum as number) > (node.maximum as number)
  ) {
    fail(path, '"minimum" is above "maximum"')
  }
  checkEnum(
    node,
    path,
    item =>
      typeof item === 'number' &&
      Number.isFinite(item) &&
      (!integer || Number.isInteger(item))
  )
}

function checkDepth(path: string, depth: number): void {
  if (depth > inputLimits.maxDepth) {
    fail(path, `objects and arrays nest deeper than ${inputLimits.maxDepth}`)
  }
}

function checkArray(
  node: Record<string, unknown>,
  path: string,
  depth: number
): void {
  checkDepth(path, depth)
  checkCount(node, 'maxItems', path)
  if (node.items === undefined) {
    fail(path, 'an array needs "items"')
  }
  checkNode(node.items, `${path}[]`, depth + 1)
}

function checkObject(
  node: Record<string, unknown>,
  path: string,
  depth: number
): void {
  checkDepth(path, depth)
  const properties = node.properties ?? {}
  if (!isPlainObject(properties)) {
    fail(path, '"properties" must be an object')
  }
  for (const name of Object.keys(properties)) {
    const at = path === '' ? name : `${path}.${name}`
    if (!propertyName.test(name)) {
      fail(at, `the property name must match ${String(propertyName)}`)
    }
    checkNode(properties[name], at, depth + 1)
  }
  const required = node.required ?? []
  if (!Array.isArray(required)) {
    fail(path, '"required" must be a list of property names')
  }
  const seen = new Set<unknown>()
  for (const name of required as unknown[]) {
    if (
      typeof name !== 'string' ||
      !Object.hasOwn(properties, name) ||
      seen.has(name)
    ) {
      fail(
        path,
        `"required" names "${String(name)}", which is not a property or is listed twice`
      )
    }
    seen.add(name)
  }
}
