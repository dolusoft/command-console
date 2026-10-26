# 0010 CI on GitHub-hosted runners

Status: Accepted (2026-10-26)

## Context

Dolusoft's private repositories run CI on self-hosted runners. This repository is public: GitHub-hosted minutes are free for it, and a self-hosted runner on a public repository would run the code of a fork's pull request on our network.

## Decision

- Every job runs on `ubuntu-latest`. There is no OS matrix and no scheduled run.
- `ci.yml` has a `checks` job in dependency order (release version, install, lint, typecheck, unit tests with coverage, build, then every check that reads `dist/`: API reports, the generated contract, dependencies, unused code, packaging, CSS leak, sizes, pack-install) and a `browser` job (Chromium) in parallel. `verify` passes only when both pass and is the required status check.
- `pr-body.yml` checks the pull request template lines and refuses AI co-author trailers.

## Consequences

- The size budgets are measured locally on Windows and checked on Linux; the 5% margin of P8 covers the difference.
- A hosted runner can fail for reasons of its own (a Chromium download, a registry outage); such a failure is retried, not hidden.

## Trade-off

One OS means a Windows- or macOS-only defect is found by a developer, not by CI. The library has no file system, process or path handling, so the risk is in the browser, which the `browser` job covers in Chromium.
