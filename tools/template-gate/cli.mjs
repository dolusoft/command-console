#!/usr/bin/env node
// The template gate CLI.
//
//   node tools/template-gate/cli.mjs [paths...] [--config <file>] [--gates a,b] [--format text|json]
//
// Without paths it checks the `paths` of the config (tools/template-gate/config.json).
// Paths may be files or directories; files that are not .vue are skipped, so
// a list of staged files can be passed as is. Ignored paths stay ignored when
// named explicitly.
//
// Exit codes: 0 no finding, 1 findings, 2 an SFC that does not parse or a bad
// invocation or configuration.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { checkSfc, GateError, GATES } from './gate.mjs'

const fail = message => {
  process.stderr.write(`template-gate: ${message}\n`)
  process.exit(2)
}

let options
try {
  options = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      gates: { type: 'string' },
      format: { type: 'string', default: 'text' }
    }
  })
} catch (error) {
  fail(error.message)
}
const { values, positionals } = options

const cwd = process.cwd()
const configFile = resolve(
  values.config ?? join(import.meta.dirname, 'config.json')
)
let config
try {
  config = JSON.parse(readFileSync(configFile, 'utf8'))
} catch (error) {
  fail(`cannot read the config ${configFile}: ${error.message}`)
}
const root = resolve(import.meta.dirname, '..', '..')
const gates = values.gates ? values.gates.split(',') : config.gates
if (!Array.isArray(gates) || gates.length === 0) {
  fail('no gate selected')
}
const unknown = gates.filter(gate => !GATES.includes(gate))
if (unknown.length > 0) {
  fail(`unknown gate ${unknown.join(', ')}; known: ${GATES.join(', ')}`)
}
if (!['text', 'json'].includes(values.format)) {
  fail(`unknown format ${values.format}; use text or json`)
}

const ignoreSegments = new Set(config.ignoreSegments ?? [])
const ignorePaths = (config.ignorePaths ?? []).map(path => resolve(root, path))
const ignored = file =>
  file.split(sep).some(segment => ignoreSegments.has(segment)) ||
  ignorePaths.some(path => file === path || file.startsWith(path + sep))

const collect = (path, out) => {
  if (ignored(path)) {
    return
  }
  const stat = statSync(path)
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      collect(join(path, entry), out)
    }
  } else if (path.endsWith('.vue')) {
    out.push(path)
  }
}

const targets = positionals.length
  ? positionals.map(path => resolve(cwd, path))
  : config.paths.map(path => resolve(root, path))
const files = []
for (const target of targets) {
  if (!existsSync(target)) {
    // A configured folder may not exist yet; a named file must.
    if (positionals.length) {
      fail(`no such file or directory: ${target}`)
    }
    continue
  }
  collect(target, files)
}

const findings = []
for (const file of files.sort()) {
  const name = relative(cwd, file).split(sep).join('/')
  try {
    findings.push(...checkSfc(name, readFileSync(file, 'utf8'), gates))
  } catch (error) {
    if (error instanceof GateError) {
      fail(error.message)
    }
    throw error
  }
}

if (values.format === 'json') {
  process.stdout.write(
    `${JSON.stringify({ files: files.length, findings }, null, 2)}\n`
  )
} else {
  for (const finding of findings) {
    process.stdout.write(
      `${finding.file}:${finding.line}:${finding.column} ${finding.gate} ${finding.message}\n`
    )
  }
}
process.exitCode = findings.length > 0 ? 1 : 0
