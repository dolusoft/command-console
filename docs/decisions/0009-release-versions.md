# 0009 Release versions

Status: Accepted (2026-10-26)

## Context

A major version forces every consumer to read a migration guide at once. Query Table found that a breaking need can almost always enter as an opt-in addition (its ADR 0019). The three packages share one version (P9).

## Decision

- Never a major. A release is the next minor (new surface) or the next patch (fixes) of the latest `v*` tag; a breaking need enters as an opt-in in a minor.
- The first release is `1.0.0`. Until the pull request that prepares it, every `package.json` carries the unreleased `0.0.0`.
- `scripts/check-release-version.mjs` holds the rule. In CI it compares the version with the latest `v*` tag; while no tag exists it accepts `0.0.0` and `1.0.0`. In the `version` job of `release.yml` (`--release`) the tag being released is left out, so a re-run passes, and with no other tag only `1.0.0` passes. Once `v1.0.0` exists, `0.0.0` fails like any step back.
- The tag equals the version of the root and of every package.

## Consequences

- Consumers can depend on `^1.0.0` for the life of the library.
- A pull request that sets a version runs the same check in CI as the release does.

## Trade-off

An API mistake cannot be removed in a major: it is deprecated and kept, or replaced by an opt-in. The surface is kept small (P9) so that this stays rare.
