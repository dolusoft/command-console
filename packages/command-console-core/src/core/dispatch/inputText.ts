// The words a caller of an operation reads when its input is refused (C-89),
// and the one repair the core makes before it checks an input (C-91). The
// text goes to the outcome only, never to the entries or the DOM (P7): the
// console still draws a message code.
import type {
  InputError,
  InputSchema,
  InputSchemaNode
} from '@dolusoft/command-protocol'

/** The longest `message` an outcome carries, in code points (C-89). */
const messageLimit = 300

/** The longest field name a message repeats, in code points. */
const nameLimit = 40

/** `text` cut to `limit` code points. */
const cut = (text: string, limit: number): string => {
  const points = Array.from(text)
  return points.length > limit
    ? `${points.slice(0, limit - 1).join('')}…`
    : text
}

/** `text` cut to `messageLimit` code points; `undefined` when empty. */
export const cutMessage = (text: string): string | undefined =>
  text === '' ? undefined : cut(text, messageLimit)

/** Whether `value` is a plain object, as `validateInput` wants one. */
const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** The node a path (`a`, `a.b`, `a[2]`) names, or `undefined`. */
const nodeAt = (
  schema: InputSchema,
  path: string
): InputSchemaNode | undefined => {
  let node: InputSchemaNode | undefined = schema
  for (const [, name, index] of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    if (index !== undefined) {
      node = node?.type === 'array' ? node.items : undefined
    } else if (node?.type === 'object' && node.properties) {
      node = Object.hasOwn(node.properties, name)
        ? node.properties[name]
        : undefined
    } else {
      node = undefined
    }
  }
  return node
}

/** The parent path and the last name of a path (`a.b` → `a`, `b`). */
const split = (path: string): [string, string] => {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? ['', path] : [path.slice(0, dot), path.slice(dot + 1)]
}

/** The type a node wants, as words (`array of string`). */
const typeOf = (node: InputSchemaNode | undefined): string => {
  if (node === undefined) {
    return 'another type'
  }
  return node.type === 'array' ? `array of ${typeOf(node.items)}` : node.type
}

/** The edit distance of two names (Levenshtein). */
const distance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return previous[b.length]
}

/** The known field within two edits of `name`, the nearest first. */
const nearest = (name: string, known: string[]): string | undefined => {
  let best: string | undefined
  let bestScore = Math.min(2, name.length >> 1) + 1
  for (const candidate of known) {
    const score = distance(name.toLowerCase(), candidate.toLowerCase())
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

/**
 * One error in words: the type wanted, the allowed values, an unknown field
 * with the nearest known one, else the failed keyword and its bound. The
 * value is never repeated (C-89).
 */
const describe = (schema: InputSchema, error: InputError): string => {
  const { path, code } = error
  const node = nodeAt(schema, path)
  const at = path === '' ? 'input' : path
  if (code === 'type') {
    return `${at}: expected ${typeOf(node)}`
  }
  if (code === 'additional') {
    if (path === '') {
      return 'unexpected argument: options are --name value'
    }
    const [parent, name] = split(path)
    const owner = nodeAt(schema, parent)
    const near = nearest(
      name,
      owner?.type === 'object' ? Object.keys(owner.properties ?? {}) : []
    )
    const field = `unknown field ${JSON.stringify(cut(path, nameLimit))}`
    return near === undefined
      ? field
      : `${field} (did you mean ${parent === '' ? near : `${parent}.${near}`}?)`
  }
  const bound =
    code === 'required' || code === 'limit'
      ? undefined
      : (node as Record<string, unknown> | undefined)?.[code]
  if (Array.isArray(bound)) {
    return `${at}: one of ${bound.join('|')}`
  }
  return bound === undefined
    ? `${at}: ${code}`
    : `${at}: ${code} ${JSON.stringify(bound)}`
}

/**
 * The errors of an input in words, joined by `; ` and cut to
 * `messageLimit` code points: which field, and what it wants (C-89).
 */
export const describeInputErrors = (
  schema: InputSchema,
  errors: readonly InputError[]
): string | undefined =>
  cutMessage([...new Set(errors.map(e => describe(schema, e)))].join('; '))

/**
 * `value` with a string given for a field whose schema is an array of
 * strings turned into a list of that one string (C-91), at any depth of
 * objects. Splitting the string is the command's own work (`normalize`).
 * Returns a copy when it changes something; other values stay as they are.
 */
export const listsFromText = (schema: InputSchema, value: unknown): unknown => {
  if (!isPlain(value) || schema.properties === undefined) {
    return value
  }
  let copy: Record<string, unknown> | undefined
  for (const name of Object.keys(schema.properties)) {
    if (!Object.hasOwn(value, name)) {
      continue
    }
    const node = schema.properties[name]
    const field = value[name]
    let next: unknown = field
    if (
      node.type === 'array' &&
      node.items.type === 'string' &&
      typeof field === 'string'
    ) {
      next = [field]
    } else if (node.type === 'object') {
      next = listsFromText(node, field)
    }
    if (next !== field) {
      copy ??= { ...value }
      Object.defineProperty(copy, name, {
        value: next,
        enumerable: true,
        writable: true,
        configurable: true
      })
    }
  }
  return copy ?? value
}
