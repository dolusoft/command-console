import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The same rule runs in CI (scripts/check-release-version.mjs, no flag) and in
// the `version` job of release.yml (`--release`): a release is the next minor
// or the next patch of the latest released version, never a major; the first
// release is 1.0.0 and the packages are 0.0.0 until then (ADR 0009).

type Check = (
  version: string,
  tags: string[],
  release?: boolean
) => string | null

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'check-release-version.mjs'
)
const { releaseVersionError } = (await import(/* @vite-ignore */ script)) as {
  releaseVersionError: Check
}

const tags = ['v1.9.0', 'v1.10.0', 'v1.11.0', 'v1.11.1']

describe('release version gate', () => {
  it('accepts the next minor and the next patch of the latest release', () => {
    expect(releaseVersionError('1.12.0', tags)).toBeNull()
    expect(releaseVersionError('1.11.2', tags)).toBeNull()
  })

  it('orders tags by semver, not by text', () => {
    const old = ['v1.9.0', 'v1.10.0']
    expect(releaseVersionError('1.11.0', old)).toBeNull()
    expect(releaseVersionError('1.10.1', old)).toBeNull()
    expect(releaseVersionError('1.10.0', old, true)).toBeNull()
  })

  it('rejects another major', () => {
    expect(releaseVersionError('2.0.0', tags)).toMatch(/major/)
    expect(releaseVersionError('0.99.0', tags)).toMatch(/major/)
  })

  it('rejects a skipped number', () => {
    expect(releaseVersionError('1.13.0', tags)).toMatch(/neither/)
    expect(releaseVersionError('1.11.3', tags)).toMatch(/neither/)
    expect(releaseVersionError('1.12.1', tags)).toMatch(/neither/)
  })

  it('rejects a version that is not greater and a pre-release', () => {
    expect(releaseVersionError('1.10.5', tags)).toMatch(/not greater/)
    expect(releaseVersionError('1.12.0-rc.1', tags)).toMatch(/plain/)
  })

  it('lets a version that already is a released tag pass in CI', () => {
    expect(releaseVersionError('1.11.1', tags)).toBeNull()
    expect(releaseVersionError('1.11.0', tags)).toBeNull()
  })

  it('judges a release without its own tag, so a re-run passes', () => {
    expect(releaseVersionError('1.12.0', [...tags, 'v1.12.0'], true)).toBeNull()
    expect(releaseVersionError('1.11.1', tags, true)).toBeNull()
    expect(releaseVersionError('2.0.0', [...tags, 'v2.0.0'], true)).toMatch(
      /major/
    )
    expect(releaseVersionError('1.13.0', [...tags, 'v1.13.0'], true)).toMatch(
      /neither/
    )
  })

  describe('first release', () => {
    it('accepts the unreleased 0.0.0 and the first release 1.0.0 in CI while no tag exists', () => {
      expect(releaseVersionError('0.0.0', [])).toBeNull()
      expect(releaseVersionError('1.0.0', [])).toBeNull()
      expect(releaseVersionError('0.0.0', ['latest', 'v1-draft'])).toBeNull()
    })

    it('accepts only 1.0.0 as the first release', () => {
      expect(releaseVersionError('1.0.0', [], true)).toBeNull()
      expect(releaseVersionError('1.0.0', ['v1.0.0'], true)).toBeNull()
      expect(releaseVersionError('0.0.0', [], true)).toMatch(/first one/)
      expect(releaseVersionError('0.0.0', ['v0.0.0'], true)).toMatch(
        /first one/
      )
    })

    it('rejects any other version while no tag exists', () => {
      expect(releaseVersionError('1.1.0', [])).toMatch(/no v\* tag/i)
      expect(releaseVersionError('0.1.0', [])).toMatch(/no v\* tag/i)
      expect(releaseVersionError('2.0.0', [], true)).toMatch(/first one/)
    })

    it('rejects 0.0.0 once 1.0.0 is released', () => {
      expect(releaseVersionError('0.0.0', ['v1.0.0'])).toMatch(/major/)
      expect(releaseVersionError('1.0.1', ['v1.0.0'])).toBeNull()
      expect(releaseVersionError('1.1.0', ['v1.0.0'])).toBeNull()
    })
  })
})
