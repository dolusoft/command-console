import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { agentTools, createConsole } from '@dolusoft/command-console-core'

// ADR 0013: the skill is the agent tools' guide for agents that read skills;
// a browser agent reads only the tool descriptions. The two say the same
// rules, and the skill stays thin: what a command is, `help` says.

const file = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
  'command-console',
  'SKILL.md'
)
const skill = readFileSync(file, 'utf8')
const tools = agentTools(createConsole({ commands: [] }), {
  context: () => null
})

describe('Agent skill', () => {
  it('is an Agent Skills file: a name and a description in its front matter', () => {
    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(skill)
    expect(front).not.toBeNull()
    const fields = Object.fromEntries(
      front![1].split(/\r?\n/).map(line => {
        const at = line.indexOf(':')
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
      })
    )
    expect(fields.name).toBe('command-console')
    expect(fields.description.length).toBeGreaterThan(40)
    expect(fields.description.length).toBeLessThanOrEqual(1024)
  })

  it('stays thin and names no command of a consumer', () => {
    expect(new TextEncoder().encode(skill).length).toBeLessThanOrEqual(4096)
    expect(skill).not.toMatch(/\b(dataview|syslogs|updater|bfs)\b/)
  })

  it('names every agent tool', () => {
    for (const tool of tools) {
      expect(skill).toContain(`\`${tool.name}\``)
    }
  })

  it('says the rules the tool descriptions say', () => {
    const [, help, run] = tools
    expect(help.description).toContain('change only the user can run')
    expect(run.description).toContain('suggest its line to the user')
    expect(run.description).toContain('never runs as a command')
    expect(skill).toContain(
      'Only the user runs it, by typing it in the terminal'
    )
    expect(skill).toContain('give the user that line')
    expect(skill).toContain('never runs from the console')
    expect(skill).toContain('do not send them to `run`')
  })

  it('C-95 says, as the tools do, that a change with confirm runs first as its preview', () => {
    const [, help, run] = tools
    expect(help.description).toContain('runs as its preview without that field')
    expect(run.description).toContain(
      'runs first as a preview, without its confirm field'
    )
    expect(skill).toContain(
      'runs first as a preview, without its confirm field'
    )
  })

  it('has a CLI part: help first, --json, --line -, stdout, exit codes 4 and 5', () => {
    for (const text of [
      '`gecko help`',
      '`--json`',
      '`--line -`',
      '`stdout` carries only the result',
      'Exit code 4',
      'retry is safe',
      'Exit code 5',
      'do not retry, ask the user'
    ]) {
      expect(skill).toContain(text)
    }
  })
})
