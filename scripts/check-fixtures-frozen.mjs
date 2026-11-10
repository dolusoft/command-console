// Fails when a published remote fixture was changed or removed (C-114, ADR
// 0016): a published example is never changed, only added.
//
// The latest published GitHub Release carries `remote-fixtures-<version>.tar.gz`
// (release.yml packs `fixtures/remote/` and `docs/remote-contract.md`). This
// script downloads it with the `gh` CLI, unpacks it with `tar` and compares
// every JSON file of its `fixtures/remote/` with the working tree:
//
//   - every file of the archive still exists;
//   - in an array, an item with a string `name` is found by that name and is
//     deeply equal; an item without one is found by being deeply equal;
//   - a top-level object keeps every key; an array value is compared as
//     above, any other value must be deeply equal.
//
// New files, new examples and new keys pass. A release without the asset, or
// no release at all, passes. A failure to reach GitHub fails with a message
// that says to run the check again: it never passes in silence.
//
// Needs `gh` (with GH_TOKEN in CI) and `tar`; no dependency.
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

/** The asset name of a release's fixture archive. */
export const assetPattern = /^remote-fixtures-.+\.tar\.gz$/u

const isPlainObject = value =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const named = item => isPlainObject(item) && typeof item.name === 'string'

/** The JSON files under `dir`, as paths relative to it with `/`. */
const jsonFiles = dir => {
  const found = []
  const walk = current => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry)
      if (statSync(path).isDirectory()) {
        walk(path)
      } else if (entry.endsWith('.json')) {
        found.push(relative(dir, path).split(sep).join('/'))
      }
    }
  }
  walk(dir)
  return found.sort()
}

/** The differences of one array: `where` names it in a message. */
const compareArray = (published, current, where) => {
  const errors = []
  if (!Array.isArray(current)) {
    return [`${where}: is no longer an array.`]
  }
  for (const item of published) {
    if (named(item)) {
      const found = current.filter(
        other => named(other) && other.name === item.name
      )
      if (found.length === 0) {
        errors.push(`${where}: example "${item.name}" was removed.`)
      } else if (!isDeepStrictEqual(found[0], item)) {
        errors.push(`${where}: example "${item.name}" was changed.`)
      }
    } else if (!current.some(other => isDeepStrictEqual(other, item))) {
      errors.push(
        `${where}: the item ${JSON.stringify(item)} was changed or removed.`
      )
    }
  }
  return errors
}

/**
 * The differences between a published fixture file and the current one: a
 * list of messages, empty when every published example is still there.
 */
export const compareFile = (published, current, file) => {
  if (Array.isArray(published)) {
    return compareArray(published, current, file)
  }
  if (!isPlainObject(published)) {
    return isDeepStrictEqual(published, current)
      ? []
      : [`${file}: was changed.`]
  }
  if (!isPlainObject(current)) {
    return [`${file}: is no longer an object.`]
  }
  const errors = []
  for (const [key, value] of Object.entries(published)) {
    if (!Object.hasOwn(current, key)) {
      errors.push(`${file}: "${key}" was removed.`)
    } else if (Array.isArray(value)) {
      errors.push(...compareArray(value, current[key], `${file} ${key}`))
    } else if (!isDeepStrictEqual(value, current[key])) {
      errors.push(`${file}: "${key}" was changed.`)
    }
  }
  return errors
}

/**
 * The differences between two `fixtures/remote/` folders, the published one
 * and the current one.
 */
export const compareFolders = (publishedDir, currentDir) => {
  const errors = []
  const current = new Set(jsonFiles(currentDir))
  for (const file of jsonFiles(publishedDir)) {
    if (!current.has(file)) {
      errors.push(`${file}: was removed.`)
      continue
    }
    const read = dir => JSON.parse(readFileSync(join(dir, file), 'utf8'))
    errors.push(...compareFile(read(publishedDir), read(currentDir), file))
  }
  return errors
}

/**
 * Unpacks `archive` (a `remote-fixtures-*.tar.gz`) and compares its
 * `fixtures/remote/` with `currentDir`.
 */
export const checkArchive = (archive, currentDir, run = execFileSync) => {
  const dir = mkdtempSync(join(tmpdir(), 'remote-fixtures-'))
  try {
    run('tar', ['-xzf', archive, '-C', dir])
    return compareFolders(join(dir, 'fixtures', 'remote'), currentDir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Thrown when GitHub cannot be read; the check may be run again. */
export class NetworkError extends Error {}

/**
 * The tag and the fixture asset of the latest published release, `null` when
 * there is no release or it has no such asset. `gh` is called through `run`.
 */
export const latestAsset = (run = execFileSync) => {
  let text
  try {
    text = run('gh', ['release', 'view', '--json', 'tagName,assets'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    const said = `${error?.stderr ?? ''}${error?.message ?? ''}`
    if (/release not found/iu.test(said)) {
      return null
    }
    throw new NetworkError(
      `Could not read the latest release with gh (${said.trim().split('\n')[0]}).`
    )
  }
  const { tagName, assets } = JSON.parse(text)
  const asset = (assets ?? []).find(item => assetPattern.test(item.name))
  return asset ? { tag: tagName, name: asset.name } : null
}

/**
 * The whole check: the messages of the differences, empty when it passes.
 * `log` says what was compared.
 */
export const checkFrozen = (root, run = execFileSync, log = console.log) => {
  const asset = latestAsset(run)
  if (asset === null) {
    log(
      'The latest release has no remote-fixtures archive: nothing to compare.'
    )
    return []
  }
  const dir = mkdtempSync(join(tmpdir(), 'remote-fixtures-download-'))
  try {
    try {
      run(
        'gh',
        [
          'release',
          'download',
          asset.tag,
          '--pattern',
          asset.name,
          '--dir',
          dir
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch (error) {
      throw new NetworkError(
        `Could not download ${asset.name} of ${asset.tag} (${`${error?.message ?? ''}`.trim().split('\n')[0]}).`
      )
    }
    log(`Comparing fixtures/remote/ with ${asset.name} of ${asset.tag}.`)
    return checkArchive(
      join(dir, asset.name),
      join(root, 'fixtures', 'remote'),
      run
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  try {
    const errors = checkFrozen(root)
    if (errors.length > 0) {
      for (const error of errors) {
        console.error(`::error::${error}`)
      }
      console.error(
        'A published fixture example is never changed or removed: add a new example with a new name (fixtures/remote/README.md).'
      )
      process.exit(1)
    }
    console.log('Every published fixture example is unchanged.')
  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(
        `::error::${error.message} Run the check again; it does not pass without the comparison.`
      )
      process.exit(1)
    }
    throw error
  }
}
