// A small seeded generator for property tests: the same seed gives the same
// cases on every run and machine, so a failure is reproducible from its seed.

/** A random source returning numbers in [0, 1). */
export type Random = () => number

/** mulberry32: a 32-bit seeded generator, good enough for test cases. */
function seeded(seed: number): Random {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** An integer in [min, max]. */
export function integer(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1))
}

/** One item of `items`. */
function pick<T>(random: Random, items: readonly T[]): T {
  return items[integer(random, 0, items.length - 1)]
}

/**
 * Characters the line syntax cares about, weighted towards them: quotes,
 * backslashes and several kinds of whitespace, plus letters, a non-ASCII
 * letter, a surrogate pair and a non-breaking space.
 */
const syntaxAlphabet: readonly string[] = [
  "'",
  "'",
  '"',
  '"',
  '\\',
  '\\',
  ' ',
  ' ',
  '\t',
  '\n',
  ' ',
  'a',
  'b',
  'z',
  'A',
  '0',
  '.',
  '-',
  '=',
  ':',
  'é',
  'ş',
  '😀'
]

/** A string of up to `maxLength` picks from `alphabet`. */
export function text(
  random: Random,
  maxLength: number,
  alphabet: readonly string[] = syntaxAlphabet
): string {
  const length = integer(random, 0, maxLength)
  let result = ''
  for (let i = 0; i < length; i++) {
    result += pick(random, alphabet)
  }
  return result
}

/** Runs `check` on `count` cases made by `make` from one seeded source. */
export function forAll<T>(
  seed: number,
  count: number,
  make: (random: Random) => T,
  check: (value: T) => void
): void {
  const random = seeded(seed)
  for (let i = 0; i < count; i++) {
    const value = make(random)
    try {
      check(value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `case ${i} of seed ${seed} failed for ${JSON.stringify(value)}: ${message}`,
        { cause: error }
      )
    }
  }
}
