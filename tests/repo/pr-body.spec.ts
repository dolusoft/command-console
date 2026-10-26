import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The `PR body` workflow runs scripts/check-pr-body.mjs on the body of every
// pull request; the template asks for the two lines it checks.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const script = join(root, 'scripts', 'check-pr-body.mjs')

const check = (body: string) =>
  spawnSync(process.execPath, [script], {
    env: { ...process.env, PR_BODY: body },
    encoding: 'utf8'
  }).status

describe('pull request body check', () => {
  it('passes a body with an İlkeler and a Katman line', () => {
    expect(
      check('## Değişiklik\n\nİlkeler: P3, P12\nKatman: vue, test\n')
    ).toBe(0)
    expect(check('İlkeler: yok\nKatman: repo')).toBe(0)
  })

  it('fails without either line, or with an empty one', () => {
    expect(check('Katman: vue')).toBe(1)
    expect(check('İlkeler: P3')).toBe(1)
    expect(check('İlkeler:\nKatman: vue')).toBe(1)
    expect(check('')).toBe(1)
  })

  it('does not count label lines that sit inside a code fence', () => {
    expect(check('```\nİlkeler: P3\nKatman: vue\n```')).toBe(1)
    expect(check('~~~md\nİlkeler: P3\n~~~\nKatman: vue')).toBe(1)
    expect(check('```\nİlkeler: P3\nKatman: vue')).toBe(1)
    expect(check('```\nx\n```\nİlkeler: P3\nKatman: vue')).toBe(0)
  })

  it('fails on the unfilled template: its comments are no value', () => {
    const template = readFileSync(
      join(root, '.github', 'pull_request_template.md'),
      'utf8'
    )
    expect(template).toMatch(/^İlkeler:/m)
    expect(template).toMatch(/^Katman:/m)
    expect(check(template)).toBe(1)
  })
})
