// Pure helpers of the recall feature (README: Recall).

/** The default of `options.recallLimit`. */
export const defaultRecallLimit = 100

/**
 * The most lines recall keeps: a non-negative integer, `Infinity` allowed.
 * Anything else falls back to the default.
 */
export const limitOf = (limit: number | undefined): number => {
  if (limit === undefined || Number.isNaN(limit)) {
    return defaultRecallLimit
  }
  return limit === Infinity ? limit : Math.max(0, Math.floor(limit))
}

/**
 * `recall` with `line` recorded: an equal line already present moves to the
 * newest position, and the oldest lines beyond `limit` are dropped. Returns
 * `recall` itself when nothing changes; never mutates it.
 */
export const recordLine = (
  recall: readonly string[],
  line: string,
  limit: number
): string[] => {
  if (recall.length > 0 && recall[recall.length - 1] === line) {
    return recall.length > limit
      ? recall.slice(recall.length - limit)
      : (recall as string[])
  }
  const next = [...recall.filter(old => old !== line), line]
  return next.length > limit ? next.slice(next.length - limit) : next
}
