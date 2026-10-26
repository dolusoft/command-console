// The API report of every published TypeScript entry (api-extractor): each
// `api-extractor*.json` of a package writes one `etc/<name>.api.md`, the
// reviewed public surface of that entry in `dist/types`. A change to the
// public API shows up as a diff of that file.
//
//   node scripts/api-report.mjs           fails when a report is out of date
//   node scripts/api-report.mjs --local   rewrites the reports
//
// Reads `dist/`; run `pnpm build` first (`api:check` checks it is fresh).
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { Extractor, ExtractorConfig } from '@microsoft/api-extractor'

const root = join(import.meta.dirname, '..')
const local = process.argv.includes('--local')

const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => join(root, 'packages', entry.name))

/** `api-extractor.json` and `api-extractor.<entry>.json` of each package. */
const configs = packages.flatMap(dir =>
  readdirSync(dir)
    .filter(file => /^api-extractor(\..+)?\.json$/.test(file))
    .sort()
    .map(file => ({ dir, file }))
)

let failed = false
for (const { dir, file } of configs) {
  const config = ExtractorConfig.loadFileAndPrepare(join(dir, file))
  if (local) {
    mkdirSync(config.reportFolder, { recursive: true })
  }
  const result = Extractor.invoke(config, {
    localBuild: local,
    showVerboseMessages: false
  })
  const name = `${config.packageJson?.name ?? dir} (${file})`
  if (result.succeeded) {
    console.log(
      `api-report: ${name} ${result.apiReportChanged ? 'updated' : 'unchanged'}`
    )
    continue
  }
  failed = true
  console.error(
    `api-report: ${name} failed (${result.errorCount} errors, ${result.warningCount} warnings)${
      result.apiReportChanged
        ? ' - the API changed; review it and run pnpm api:update'
        : ''
    }`
  )
}

if (failed) {
  process.exit(1)
}
