/** A JSON leaf. Numbers are finite: `NaN` and the infinities are not JSON. */
export type JsonPrimitive = string | number | boolean | null

/**
 * A JSON value: a primitive, an array of values or a plain object of values.
 * Every protocol type is made of these (P4).
 */
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/**
 * Whether `value` is a JSON value that survives
 * `JSON.parse(JSON.stringify(value))` unchanged: strings, booleans, `null`,
 * finite numbers, dense arrays and plain objects (prototype `Object.prototype`
 * or `null`) of such values, without cycles. `undefined`, functions, symbols,
 * bigints, class instances (`Date`, `Map`, …), sparse arrays and non-finite
 * numbers are not. `-0` is accepted; it reads back as `0`.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  return check(value, [])
}

function check(value: unknown, path: object[]): boolean {
  if (value === null) {
    return true
  }
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true
    case 'number':
      return Number.isFinite(value)
    case 'object':
      break
    default:
      return false
  }
  const object = value
  if (path.includes(object)) {
    return false
  }
  path.push(object)
  const result = Array.isArray(object)
    ? checkArray(object as unknown[], path)
    : checkObject(object, path)
  path.pop()
  return result
}

function checkArray(array: unknown[], path: object[]): boolean {
  if (Object.getPrototypeOf(array) !== Array.prototype) {
    return false
  }
  for (let i = 0; i < array.length; i++) {
    if (!(i in array) || !check(array[i], path)) {
      return false
    }
  }
  return true
}

function checkObject(object: object, path: object[]): boolean {
  const prototype: unknown = Object.getPrototypeOf(object)
  if (prototype !== Object.prototype && prototype !== null) {
    return false
  }
  if (Object.getOwnPropertySymbols(object).length > 0) {
    return false
  }
  const record = object as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!check(record[key], path)) {
      return false
    }
  }
  return true
}
