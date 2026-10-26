# Decisions

Architecture decision records (ADRs) for Command Console. Each record states the context, the decision, its consequences and the trade-off that was accepted. A record is not edited to change its decision: a new record supersedes it and says so.

Changing a record, or adding one, needs the approval of a code owner (`.github/CODEOWNERS`).

| ID                                                | Title                                       | Status   |
| ------------------------------------------------- | ------------------------------------------- | -------- |
| [0001](0001-three-packages-own-engine.md)         | Three packages and an engine of our own     | Accepted |
| [0002](0002-fixed-feature-set-shared-contract.md) | A fixed feature set and the shared contract | Accepted |
| [0003](0003-state-ownership.md)                   | State ownership                             | Accepted |
| [0004](0004-composable-and-component.md)          | Composable and component                    | Accepted |
| [0005](0005-structured-output-blocks.md)          | Output is structured blocks, never HTML     | Accepted |
| [0006](0006-sensitive-lines.md)                   | Sensitive lines                             | Accepted |
| [0007](0007-line-syntax.md)                       | Line syntax                                 | Accepted |
| [0008](0008-npm-distribution.md)                  | npm as the only distribution channel        | Accepted |
| [0009](0009-release-versions.md)                  | Release versions                            | Accepted |
| [0010](0010-ci-hosted-runners.md)                 | CI on GitHub-hosted runners                 | Accepted |

Decided on 2026-10-26 with the 1.0 specification, after two independent reviews. The `B-nn`, `D-nn`, `S-nn` and `Q-nn` items the records name come from the inventory of the frontendx console the specification was written from.
