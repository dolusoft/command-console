import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The `PR body` workflow pipes the messages of a pull request's commits into
// scripts/check-commit-trailers.mjs; an AI co-author trailer fails it.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const script = join(root, 'scripts', 'check-commit-trailers.mjs')

const check = (messages: string) =>
  spawnSync(process.execPath, [script], { input: messages, encoding: 'utf8' })
    .status

describe('commit trailer check', () => {
  it('fails on an Anthropic or OpenAI co-author trailer, in any case', () => {
    expect(
      check('Fix\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n')
    ).toBe(1)
    expect(
      check('Fix\n\nco-authored-by: Codex (gpt-6-astra) <noreply@openai.com>')
    ).toBe(1)
  })

  it('passes a message without trailers and a human co-author', () => {
    expect(check('Fix\n\nBody text.\n')).toBe(0)
    expect(
      check('Fix\n\nCo-authored-by: Someone <someone@example.com>\n')
    ).toBe(0)
    expect(check('')).toBe(0)
  })

  it('does not count the address mentioned outside a trailer', () => {
    expect(check('Docs: mail noreply@anthropic.com is not a person\n')).toBe(0)
  })
})
