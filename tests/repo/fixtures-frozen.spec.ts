import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

// scripts/check-fixtures-frozen.mjs against a fake archive and a fake `gh`:
// no network.

interface Script {
  compareFile: (published: unknown, current: unknown, file: string) => string[]
  checkArchive: (archive: string, currentDir: string) => string[]
  checkFrozen: (
    root: string,
    run: (command: string, args: string[], options?: unknown) => string,
    log: (text: string) => void
  ) => string[]
  NetworkError: new (message: string) => Error
}

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'check-fixtures-frozen.mjs'
)
const { compareFile, checkArchive, checkFrozen, NetworkError } = (await import(
  /* @vite-ignore */ script
)) as Script

const dirs: string[] = []
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'frozen-spec-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** Writes `files` (path → JSON) under `root/fixtures/remote/`. */
const tree = (root: string, files: Record<string, unknown>) => {
  for (const [path, value] of Object.entries(files)) {
    const full = join(root, 'fixtures', 'remote', path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, JSON.stringify(value, null, 2))
  }
  return root
}

/** A `remote-fixtures-1.7.0.tar.gz` of `files`, as release.yml packs it. */
const archive = (files: Record<string, unknown>) => {
  const root = tree(temp(), files)
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'remote-contract.md'), '# Remote\n')
  const out = join(temp(), 'remote-fixtures-1.7.0.tar.gz')
  execFileSync('tar', [
    '-czf',
    out,
    '-C',
    root,
    'fixtures/remote',
    'docs/remote-contract.md'
  ])
  return out
}

const published = {
  'valid/replies.json': [
    { name: 'a', envelope: { v: 1 }, read: { v: 1 } },
    { name: 'b', envelope: { v: 2 }, read: { v: 2 } }
  ],
  'error-class.json': [{ code: 'busy', class: 'not-run' }],
  'command-name.json': {
    commands: [{ name: 'search' }],
    rows: [{ name: 'plain', input: { line: 'search' } }]
  }
}

describe('C-114 Frozen fixtures', () => {
  it('passes when every published example is still there, more added', () => {
    const current = tree(temp(), {
      ...published,
      'valid/replies.json': [
        ...published['valid/replies.json'],
        { name: 'c', envelope: {}, read: {} }
      ],
      'valid/new.json': [{ name: 'x' }]
    })
    expect(
      checkArchive(archive(published), join(current, 'fixtures', 'remote'))
    ).toEqual([])
  })

  it('fails on a changed, a removed example and a removed file', () => {
    const current = tree(temp(), {
      'valid/replies.json': [{ name: 'a', envelope: { v: 9 }, read: { v: 1 } }],
      'command-name.json': {
        commands: [{ name: 'search' }],
        rows: []
      }
    })
    expect(
      checkArchive(archive(published), join(current, 'fixtures', 'remote'))
    ).toEqual([
      'command-name.json rows: example "plain" was removed.',
      'error-class.json: was removed.',
      'valid/replies.json: example "a" was changed.',
      'valid/replies.json: example "b" was removed.'
    ])
  })

  it('finds an item without a name by its content, and keeps an object’s keys', () => {
    expect(
      compareFile(
        [{ code: 'busy', class: 'not-run' }],
        [{ code: 'busy', class: 'failed' }],
        'error-class.json'
      )
    ).toEqual([
      'error-class.json: the item {"code":"busy","class":"not-run"} was changed or removed.'
    ])
    expect(compareFile({ a: 1, b: [] }, { b: [] }, 'x.json')).toEqual([
      'x.json: "a" was removed.'
    ])
    expect(compareFile({ a: 1 }, { a: 2, c: 3 }, 'x.json')).toEqual([
      'x.json: "a" was changed.'
    ])
  })

  it('passes without a release or without the asset, and fails loudly when GitHub cannot be read', () => {
    const logs: string[] = []
    const root = tree(temp(), published)
    const noRelease = () => {
      throw Object.assign(new Error('Command failed'), {
        stderr: 'release not found'
      })
    }
    expect(checkFrozen(root, noRelease, text => logs.push(text))).toEqual([])
    const noAsset = () => JSON.stringify({ tagName: 'v1.6.1', assets: [] })
    expect(checkFrozen(root, noAsset, text => logs.push(text))).toEqual([])
    expect(logs).toHaveLength(2)
    const offline = () => {
      throw Object.assign(new Error('Command failed'), {
        stderr: 'error connecting to api.github.com'
      })
    }
    expect(() => checkFrozen(root, offline, () => undefined)).toThrow(
      NetworkError
    )
  })

  it('downloads the latest archive and compares it', () => {
    const packed = archive(published)
    const root = tree(temp(), {
      ...published,
      'valid/replies.json': [published['valid/replies.json'][0]]
    })
    const calls: string[][] = []
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args])
      if (command === 'gh' && args[1] === 'view') {
        return JSON.stringify({
          tagName: 'v1.7.0',
          assets: [
            { name: 'notes.txt' },
            { name: 'remote-fixtures-1.7.0.tar.gz' }
          ]
        })
      }
      if (command === 'gh' && args[1] === 'download') {
        copyFileSync(packed, join(args[args.indexOf('--dir') + 1], args[4]))
        return ''
      }
      return execFileSync(command, args, { encoding: 'utf8' })
    }
    expect(checkFrozen(root, run, () => undefined)).toEqual([
      'valid/replies.json: example "b" was removed.'
    ])
    expect(calls[1].slice(0, 6)).toEqual([
      'gh',
      'release',
      'download',
      'v1.7.0',
      '--pattern',
      'remote-fixtures-1.7.0.tar.gz'
    ])
  })
})
