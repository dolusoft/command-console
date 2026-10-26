# 0008 npm as the only distribution channel

Status: Accepted (2026-10-26)

## Context

The packages are public and meant to be installed by name, without an alias or a bundler workaround (C-49). Publishing by hand from a developer machine needs a token on that machine and leaves no record of what was built.

## Decision

- The three packages are published to npm only, from `release.yml`, on a `v*` tag.
- The `npm` job runs in the `release` environment, which waits for one of its reviewers, and publishes with trusted publishing (OIDC, no token) and `--provenance`, in dependency order: protocol, core, vue. A version already on npm is skipped, so a re-run is safe.
- The job publishes the tarballs the `pack` job built after every CI check passed; it installs nothing and runs no repository code.
- A GitHub Release with generated notes follows; it has no asset.
- The first publish of the three names is done by hand, after which each package gets this repository and `release.yml` as its trusted publisher.

## Consequences

- Every published version has provenance linking it to the commit and the workflow run.
- There is no other channel to keep in sync: no GitHub Release tarballs, no CDN build.

## Trade-off

A release needs a reviewer to approve the environment, which slows a patch down by the time it takes someone to click. The gain is that no single machine or token can publish.
