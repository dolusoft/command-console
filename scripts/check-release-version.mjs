// Fails when the version in package.json is not a legal next release: the
// next minor (1.2.0 -> 1.3.0) or the next patch (1.2.0 -> 1.2.1) of the
// latest released version. Major versions are not released (ADR 0009): a
// breaking need enters as an opt-in addition in a minor.
//
// The first release (no `v*` tag yet) is 1.0.0. Until the pull request that
// prepares it, the packages stay at the unreleased 0.0.0: in CI both 0.0.0
// and 1.0.0 pass while no tag exists; a release (`--release`) with no other
// tag passes only as 1.0.0. Once `v1.0.0` exists, 0.0.0 is no longer greater
// than the latest release and fails like any other step back.
//
// Two modes, one rule:
//   (default)   CI: compared with the latest `v*` tag. A version that already
//               is a released tag (no bump) passes.
//   --release   the `version` job of release.yml: the tag being released is
//               left out of the comparison, so the first run and a re-run of
//               the same tag are judged alike.
//
// Tags must be fetched first (`fetch-depth: 0` of actions/checkout).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const plain = /^(\d+)\.(\d+)\.(\d+)$/u

/** The version of the first release, and of the packages before it. */
const firstRelease = '1.0.0'
const unreleased = '0.0.0'

/** `[major, minor, patch]` of a plain `x.y.z`, or null. */
const parse = text => {
  const match = plain.exec(text)
  return match === null ? null : match.slice(1).map(Number)
}

/** The parsed versions of the plain `v<x.y.z>` tag names. */
const versionsOf = tags =>
  tags
    .map(tag => (tag.startsWith('v') ? parse(tag.slice(1)) : null))
    .filter(parsed => parsed !== null)

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/**
 * The reason `version` is not a legal release, or null when it is.
 * `tags` are the released tags (`v3.11.1`); names that are not a plain
 * `v<major>.<minor>.<patch>` are ignored. `release` leaves the tag of
 * `version` itself out of the comparison.
 */
export const releaseVersionError = (version, tags, release = false) => {
  const next = parse(version)
  if (next === null) {
    return `Version ${version} is not a plain major.minor.patch (pre-release suffixes are not released).`
  }
  const own = `v${version}`
  const others = versionsOf(tags.filter(tag => !(release && tag === own)))
  if (others.length === 0) {
    // The first release (ADR 0009). CI checks out with `fetch-depth: 0`, so
    // no tag here means none was released.
    if (version === firstRelease || (!release && version === unreleased)) {
      return null
    }
    return release
      ? `No v* tag was released yet, so this release must be the first one, ${firstRelease}, not ${version} (ADR 0009).`
      : `No v* tag was released yet: the version must be the unreleased ${unreleased} or the first release ${firstRelease}, not ${version} (ADR 0009). If tags exist, fetch them before the check.`
  }
  if (!release && tags.includes(own)) {
    return null
  }
  const latest = others.sort(compare).at(-1)
  const name = latest.join('.')
  if (next[0] !== latest[0]) {
    return `Version ${version} changes the major of the latest release ${name}. Major versions are not released (ADR 0009): add the breaking need as an opt-in in a minor.`
  }
  if (compare(next, latest) <= 0) {
    return `Version ${version} is not greater than the latest release ${name}.`
  }
  const nextMinor = next[1] === latest[1] + 1 && next[2] === 0
  const nextPatch = next[1] === latest[1] && next[2] === latest[2] + 1
  if (!nextMinor && !nextPatch) {
    return `Version ${version} is neither the next minor (${latest[0]}.${latest[1] + 1}.0) nor the next patch (${latest[0]}.${latest[1]}.${latest[2] + 1}) of the latest release ${name} (ADR 0009).`
  }
  return null
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const { version } = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8')
  )
  const tags = execFileSync('git', ['tag', '--list', 'v*'], {
    cwd: root,
    encoding: 'utf8'
  })
    .split('\n')
    .filter(Boolean)
  const error = releaseVersionError(
    version,
    tags,
    process.argv.includes('--release')
  )
  if (error !== null) {
    console.error(`::error::${error}`)
    process.exit(1)
  }
  console.log(`Version ${version} is a legal release.`)
}
