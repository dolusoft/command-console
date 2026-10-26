# Contributing

Read [`PRINCIPLES.md`](./PRINCIPLES.md) first: it lists the boundaries of the packages and the check behind each one. A change that crosses a principle changes the principle first.

## Layout

A pnpm workspace with three packages under `packages/`, versioned together (P9):

- `packages/command-protocol/` (`@dolusoft/command-protocol`): JSON types and the line tokenizer.
- `packages/command-console-core/` (`@dolusoft/command-console-core`): the engine. `src/core/` holds the core features (`console`, `entries`, `input`, `dispatch`), `src/features/<name>/` the optional ones (`recall`, `completion`, `context`), `src/shared/` the contract they talk through, `src/store/` the store and the action boundary, `src/helpers/` the feature sets, `src/index.ts` the entry. Feature-level specs go to `tests/`, one `describe` per rule.
- `packages/command-console/` (`@dolusoft/command-console`): `use-command-console.ts`, `command-console.vue`, `parts/` (render functions), `dom/` (scroll, selection, keys, focus), `labels.ts`, `contract.ts` (the public props, events, slots and exposed types).

Each package has its own `README.md`, `LICENSE.md`, `vite.config.ts` (library mode, ESM, one entry), `tsconfig.build.json` (declarations into `dist/types/`) and `api-extractor.json` (the reviewed report in `etc/`). A folder exists only when it holds a file.

The repository around them:

- `contract/`: `rules.md` (the behavior rules) and `dom.ts` (the DOM hooks); `CONTRACT.md` is generated from them and the Vue package's contract.
- `docs/decisions/`: the architecture decisions.
- `tests/contract/unit/` (happy-dom) and `tests/contract/browser/` (Chromium): the Vue behavior specs that use only the public API. `tests/repo/`: the repository checks. `tests/fixtures/`: the size fixtures (`consumer/`, `packages/`) and the frontendx-shaped command set. `tests/support/`: helpers (the DOM collector, the leak matrix).
- `scripts/`: the checks below.

Tests import the packages by name, never `packages/*/src/` (except the internal specs next to the code). `vitest.config.ts` and `tsconfig.json` point each name at its `src/index.ts`.

## Commands

- `pnpm build`: the `dist/` of the three packages.
- `pnpm lint`, `pnpm typecheck`.
- `pnpm test`: the `unit` project (happy-dom): internal specs in `packages/*/src`, package specs in `packages/*/tests`, `tests/contract/unit` and `tests/repo`. `pnpm test:coverage` adds coverage (below).
- `pnpm test:browser`: the `browser` project (Vitest Browser Mode, Playwright Chromium), `*.browser.spec.ts` in `tests/contract/browser` and `packages/*/tests`. Headed by default; `pnpm test:browser:headless` (or `HEADLESS=1`, or `CI=true`) runs without a window. First run: `pnpm exec playwright install chromium`. The script runs Vitest under a time limit and retries once on an infrastructure failure; with no browser spec yet it passes (`--passWithNoTests`). The server listens on `127.0.0.1:51325`; `VITEST_BROWSER_PORT` moves it so two clones can run at once. `pnpm test:browser:inspect` keeps the browser and the dev server up (CDP on `127.0.0.1:9333`).
- `pnpm contract:gen` writes `CONTRACT.md`; `pnpm contract:check` fails when it is stale. Until `packages/command-console/src/command-console.vue` and `src/contract.ts` both exist, the component part of `CONTRACT.md` is a placeholder.
- `pnpm api:update` writes the API reports (`packages/*/etc/*.api.md`) from the built declarations; `pnpm api:check` fails when one differs. A changed report is reviewed like code (P9).
- `pnpm check:deps`: the dependency allow-list of every package (`scripts/check-deps.mjs`, P11).
- `pnpm knip`: unused files, exports and dependencies. While the core and the Vue package are empty, `knip.json` ignores their `@dolusoft/*` dependencies and the Vue package's `vue`; the piece that first imports one removes it from `ignoreDependencies`.
- `pnpm check:package`: publint and Are the Types Wrong on each package, and no `.css` in `dist/` or the tarball. `pnpm check:no-css-leak`: no stylesheet or scripted animation in any form in `dist/` or the tarball (P5).
- `pnpm pack-install`: packs the three packages, installs the tarballs into a new Vite app outside the workspace with no alias and no `optimizeDeps`, checks that each installed package holds its README and license, typechecks and builds the app (C-49). `PACK_INSTALL_DIR` sets where the app goes, `PACK_INSTALL_KEEP=1` keeps it.

The checks that read `dist/` (`api:check`, `check:package`, `check:no-css-leak`, the size checks) fail when a package's `dist/` is older than its `src/` (`scripts/check-dist-fresh.mjs`): run `pnpm build` first.

## Coverage

`pnpm test:coverage` measures `packages/*/src` (specs left out) with v8 and fails under 90% of statements, branches, functions or lines. A file with no statement, branch or function (the `export {}` placeholder of a package that has no code yet) counts neither for nor against the thresholds: v8 reports `0/0`, which is 100%, and lists the file as an empty file it skipped. The thresholds bite as soon as a package has code.

## Rule traceability

Every rule in `contract/rules.md` needs a runnable test whose title, or the title of a `describe` around it, names the rule's ID (P12). `tests/repo/contract-traceability.spec.ts` reads the specs as syntax trees (`tests/repo/test-names.ts`): an empty `describe`, a `.skip` or a `.todo` covers nothing. It fails when:

- a rule that is neither withdrawn nor pending has no test;
- a test names an unknown rule, or a withdrawn one;
- the numbering has a gap;
- fewer rules than the 1.0 count, or fewer runnable tests than the floor, are found (both are constants at the top of the spec).

A rule is **withdrawn** when its title is `(withdrawn)` (C-42): its number is never reused and it needs no test.

A rule is **pending** while it is listed in `tests/repo/pending-rules.ts`. The packages are written piece by piece, so most rules start there. The list may only shrink: the spec fails when a pending rule already has a test, so the pull request that adds a rule's first test removes the rule from the list in the same change. 1.0 is released with the list empty and the test floor raised to the 1.0 count.

## Measuring

Size is a budget per consumer fixture (P8), measured as a consumer pays it: a minified app built against the packages' `dist/`, through their `exports` maps, minus the same app without them, gzipped.

- `pnpm measure:package-size` builds `tests/fixtures/packages/` (`protocol`, `core` with the core features, `core-all` with every feature) minus `empty`; `pnpm check:package-size` checks them against `scripts/package-size-budget.json`.
- `pnpm measure:consumer-size` builds `tests/fixtures/consumer/` (`composable`, `component`) minus `vue-only`; `pnpm check:size` checks them against `scripts/consumer-size-budget.json`.

A budget is the last measure plus 5%, rounded up, under an optional ceiling. A deliberate growth raises it in the same change, with a one-line reason in the budget's `history`. While a package is empty its fixtures import it as a namespace; the piece that fills the package replaces its fixtures with real use and sets the budgets from its first measure.

## Releasing

A release is a version in every `package.json` and a tag that names it; the `Release` workflow (`.github/workflows/release.yml`) does the rest.

There are no major releases ([ADR 0009](docs/decisions/0009-release-versions.md)). A version is the next minor (`1.2.0` → `1.3.0`) or the next patch (`1.2.0` → `1.2.1`) of the latest released tag. `scripts/check-release-version.mjs` enforces it: CI runs it on every pull request, and the `version` job of the `Release` workflow runs it with `--release`, which leaves the tag being released out of the comparison, so a re-run of the same tag passes. A version equal to an existing tag (no bump) passes in CI.

**The first release.** The packages carry the unreleased `0.0.0` until the pull request that prepares 1.0. While no `v*` tag exists, CI accepts `0.0.0` and `1.0.0`, and a release accepts only `1.0.0`. The first publish of the three names to npm is made by hand; after it each package on npmjs.com gets this repository and `release.yml` as its trusted publisher.

1. In the pull request that prepares the release, set `version` in the root `package.json` and in every `packages/*/package.json` to the new version, and the install line of `README.md` (`pnpm add @dolusoft/command-console@<version>`) to the same version (`tests/repo/package-manifest.spec.ts` fails when they differ; at `0.0.0` the README has no install line).
2. After the pull request is merged, tag the merge commit on `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag v<version>
   git push origin v<version>
   ```

3. The workflow checks that the tag is `v` plus the version of every `package.json` and that the version is legal (`version`), runs every check of CI (`ci`), builds and packs the three packages (`pack`), publishes them to npm in the order protocol, core, vue with trusted publishing and provenance (`npm`), and creates a GitHub Release with generated notes and no asset (`publish`). `npm` and `publish` run in the `release` environment and wait for one of its reviewers. A version already on npm is skipped and an existing GitHub Release is left as it is, so a failed run can be re-run on the same tag.
