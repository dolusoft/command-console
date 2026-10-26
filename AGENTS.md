# Agent guide

Read this before changing anything. It is short on purpose; the details live in the linked files.

## Where the rules are

- [PRINCIPLES.md](PRINCIPLES.md): the boundaries. A change that crosses one changes the principle first, in its own pull request, approved by a code owner.
- [docs/decisions/](docs/decisions/README.md): the architecture decisions (ADRs). Do not work against one; propose a new record that supersedes it.
- [contract/rules.md](contract/rules.md): the behavior rules `C-nn`. Rule, test, code and generated docs move together (P12). [contract/dom.ts](contract/dom.ts): the DOM hooks (P6).
- [CONTRIBUTING.md](CONTRIBUTING.md): layout, commands, rule traceability, measuring, releasing.
- [README.md](README.md) and the package READMEs: the behavior as a consumer uses it. They describe the code; a behavior change updates them in the same pull request.

## Branches

- `main` is the only long-lived branch. Pull requests target `main`.
- Never force push.
- No major releases: a version is the next minor or the next patch of the latest release tag; the first release is `1.0.0` and the packages are `0.0.0` until then (ADR 0009, `scripts/check-release-version.mjs`).

## Layers (P14)

protocol → core → vue. Imports point only that way (`scripts/eslint-layers.mjs`).

- `@dolusoft/command-protocol`: no dependency. JSON types and the tokenizer.
- `@dolusoft/command-console-core`: the protocol only. No DOM, no clock, no timer: it sees `KeyInput`, never a DOM event.
- `@dolusoft/command-console`: core, protocol and `vue` (peer). No listener on `window` or `document`.

Inside the core: `store/` reaches only itself; `shared/` reaches `store/`; `core/` reaches `shared/` and `store/`; a feature in `features/<name>/` reaches its own folder, `shared/` and `store/`, and `core/` for types only; `helpers/` and the entry files reach everything. A feature never imports another feature (ADR 0002).

## Do not

- Add a runtime dependency (P11).
- Ship CSS, a `style` attribute or a styling prop (P5); add an unlisted DOM hook (P6).
- Fetch or touch storage in library code (P1).
- Let a sensitive line reach state, callbacks, the DOM or the input element that held it (P16).
- Edit `CONTRACT.md` by hand (`pnpm contract:gen`).
- Change `PRINCIPLES.md`, `docs/decisions/`, `contract/rules.md`, `contract/dom.ts`, the lint layer config, the budgets, `tests/repo/` or `.github/` without a code owner's review (`.github/CODEOWNERS`).

## Pull requests

Use the template. The body must carry an `İlkeler:` line (the principles touched, or `yok`) and a `Katman:` line (the layers touched: `protocol`, `core`, `vue`, `test`, `repo`). CI fails without them. Commit messages and pull request bodies are written in Turkish; code, comments and repository docs in English. No AI co-author trailer in any commit (`scripts/check-commit-trailers.mjs`).

## Before you push

`pnpm lint && pnpm typecheck && pnpm test && pnpm test:browser:headless && pnpm contract:check`. With a build: `pnpm build && pnpm api:check && pnpm check:deps && pnpm knip && pnpm check:package && pnpm check:no-css-leak && pnpm check:size && pnpm check:package-size && pnpm pack-install`.
