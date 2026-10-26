// The budget check shared by `scripts/package-size.mjs` and
// `scripts/consumer-size.mjs` (P8). A budget file names, per fixture, the
// gzip cost measured when the budget was set (`measuredGzipBytes`), the
// budget (`maxGzipBytes`, that measure plus 5%) and an optional ceiling
// (`ceilingGzipBytes`).
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

/** Whether every fixture is within its budget; prints one line each. */
export const checkBudget = ({ tag, budgetFile, names, costs }) => {
  const budget = JSON.parse(readFileSync(budgetFile, 'utf8'))
  const shown = relative(process.cwd(), budgetFile)
  let ok = true
  for (const name of names) {
    const entry = budget.fixtures?.[name]
    if (typeof entry?.maxGzipBytes !== 'number') {
      console.error(
        `[${tag}] ${shown} has no numeric \`maxGzipBytes\` for ${name}.`
      )
      ok = false
      continue
    }
    if (
      typeof entry.ceilingGzipBytes === 'number' &&
      entry.maxGzipBytes > entry.ceilingGzipBytes
    ) {
      console.error(
        `[${tag}] the ${name} budget ${entry.maxGzipBytes} B is over its ceiling of ${entry.ceilingGzipBytes} B: raise both only for a deliberate growth, with its reason in the history (P8).`
      )
      ok = false
    }
    const cost = costs[name].gzipBytes
    if (cost > entry.maxGzipBytes) {
      console.error(
        `[${tag}] ${name} costs ${cost} B gzip, over its budget of ${entry.maxGzipBytes} B (measured ${entry.measuredGzipBytes} B when it was set). Shrink the build, or raise ${shown} on purpose with a line in its history (P8).`
      )
      ok = false
    } else {
      console.log(
        `[${tag}] ${name} within budget: ${cost} B gzip of ${entry.maxGzipBytes} B`
      )
    }
  }
  return ok
}

/** Prints a measure table: one row per label, bytes, gzip and brotli. */
export const printCosts = (tag, file, rows) => {
  console.log(`[${tag}] ${file}`)
  console.log('                  bytes     gzip   brotli')
  for (const [label, entry] of rows) {
    console.log(
      `${label.padEnd(15)} ${String(entry.bytes).padStart(8)} ${String(entry.gzipBytes).padStart(8)} ${String(entry.brotliBytes).padStart(8)}`
    )
  }
}
