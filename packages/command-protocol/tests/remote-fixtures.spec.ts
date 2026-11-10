import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  errorClassOf,
  isCliReply,
  parseCliMessage,
  readCapabilitiesParts,
  type ErrorCode
} from '@dolusoft/command-protocol'

// The examples of docs/remote-contract.md (C-109). `valid`, `invalid`,
// `future` and `error-class.json` run against the protocol; `sequence` and
// `command-name.json` describe the CLI and the core, so here only their form
// is checked.

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'remote'
)

type Example = Record<string, unknown> & { name: string }

const json = (path: string): unknown =>
  JSON.parse(readFileSync(join(root, path), 'utf8'))

const examples = (folder: string): { file: string; items: Example[] }[] =>
  readdirSync(join(root, folder))
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => ({
      file: `${folder}/${file}`,
      items: json(`${folder}/${file}`) as Example[]
    }))

const fromCli = (file: string) => !/replies|capabilities|tab-to-cli/.test(file)

describe('C-109 Remote fixtures', () => {
  it('error-class.json lists every error code once with its class', () => {
    const rows = json('error-class.json') as {
      code: ErrorCode
      class: string
    }[]
    expect(rows).toHaveLength(18)
    expect(new Set(rows.map(row => row.code)).size).toBe(18)
    for (const row of rows) {
      expect({ code: row.code, class: errorClassOf(row.code) }).toEqual(row)
    }
  })

  it('names every example once per file', () => {
    for (const folder of ['valid', 'invalid', 'future', 'sequence']) {
      for (const { file, items } of examples(folder)) {
        expect(Array.isArray(items), file).toBe(true)
        const names = items.map(item => item.name)
        expect(
          names.every(name => typeof name === 'string' && name !== ''),
          file
        ).toBe(true)
        expect(new Set(names).size, file).toBe(names.length)
      }
    }
  })

  it('accepts every valid example as read', () => {
    for (const { file, items } of examples('valid')) {
      for (const item of items) {
        const label = `${file}: ${item.name}`
        if ('parts' in item) {
          expect(readCapabilitiesParts(item.parts as unknown[]), label).toEqual(
            item.read
          )
        } else if (fromCli(file)) {
          expect(parseCliMessage(item.envelope), label).toEqual({
            ok: true,
            message: item.read
          })
        } else {
          expect(isCliReply(item.envelope), label).toBe(true)
          expect(item.read, label).toEqual(item.envelope)
        }
      }
    }
  })

  it('refuses every invalid example with its code', () => {
    for (const { file, items } of examples('invalid')) {
      for (const item of items) {
        const label = `${file}: ${item.name}`
        if ('parts' in item) {
          expect(
            readCapabilitiesParts(item.parts as unknown[]),
            label
          ).toBeUndefined()
        } else if (fromCli(file)) {
          expect(parseCliMessage(item.envelope), label).toEqual({
            ok: false,
            code: item.code
          })
        } else {
          expect(item.code, label).toBe('invalid')
          expect(isCliReply(item.envelope), label).toBe(false)
        }
      }
    }
  })

  it('reads a future example as it says: accepted and ignored, ignored, or by its default', () => {
    for (const { file, items } of examples('future')) {
      for (const item of items) {
        const label = `${file}: ${item.name}`
        const { expect: wanted, direction } = item
        if ('parts' in item) {
          const read = readCapabilitiesParts(item.parts as unknown[])
          if (wanted === 'accept-ignore') {
            expect(read, label).toEqual(item.read)
          } else {
            const defaults = (wanted as { default: Record<string, unknown> })
              .default
            for (const [path, value] of Object.entries(defaults)) {
              const found = path
                .split('.')
                .reduce<unknown>(
                  (at, key) => (at as Record<string, unknown>)[key],
                  read
                )
              expect(found, label).toEqual(value)
            }
          }
        } else if (direction === 'cli-to-tab') {
          const parsed = parseCliMessage(item.envelope)
          expect(parsed, label).toEqual(
            wanted === 'accept-ignore'
              ? { ok: true, message: item.read }
              : { ok: false, code: 'invalid' }
          )
        } else {
          // A reply the CLI reads: an unknown kind is ignored, the rest is
          // accepted and read by the documented default.
          expect(isCliReply(item.envelope), label).toBe(wanted !== 'ignore')
        }
      }
    }
  })

  it('gives each sequence a request, replies and an expected exit code and JSON', () => {
    for (const { file, items } of examples('sequence')) {
      for (const item of items) {
        const label = `${file}: ${item.name}`
        expect(['read', 'change'], label).toContain(item.danger)
        expect(parseCliMessage(item.request).ok, label).toBe(true)
        const replies = item.replies as Record<string, unknown>[]
        expect(Array.isArray(replies), label).toBe(true)
        for (const reply of replies) {
          expect(
            typeof reply.event === 'string'
              ? ['connection-lost', 'timeout', 'ctrl-c'].includes(reply.event)
              : isCliReply(reply),
            `${label}: ${JSON.stringify(reply).slice(0, 80)}`
          ).toBe(true)
        }
        const wanted = item.expect as {
          exitCode: unknown
          json: Record<string, unknown>
          absent?: unknown
        }
        expect([0, 1, 2, 3, 4, 5, 130], label).toContain(wanted.exitCode)
        expect(['ok', 'error', 'unknown', 'cancelled'], label).toContain(
          wanted.json.status
        )
        expect(typeof wanted.json.complete, label).toBe('boolean')
        if (wanted.absent !== undefined) {
          expect(Array.isArray(wanted.absent), label).toBe(true)
        }
      }
    }
  })

  it('gives each command-name row one input and an outcome on both sides', () => {
    const file = json('command-name.json') as {
      commands: { name: string; aliases: string[]; danger: string }[]
      rows: Example[]
    }
    expect(file.commands.length).toBeGreaterThan(0)
    const names = file.rows.map(row => row.name)
    expect(new Set(names).size).toBe(names.length)
    const one = (value: unknown, keys: string[]) =>
      typeof value === 'object' &&
      value !== null &&
      keys.filter(key => key in value).length === 1
    for (const row of file.rows) {
      expect(one(row.input, ['argv', 'line']), row.name).toBe(true)
      expect(one(row.cli, ['name', 'refuse']), row.name).toBe(true)
      expect(one(row.tab, ['name', 'refuse']), row.name).toBe(true)
      expect([undefined, true], row.name).toContain(row.sensitive)
    }
  })
})
