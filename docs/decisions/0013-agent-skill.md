# 0013 The agent skill ships with the core

Status: Accepted (2026-11-06)

## Context

The agent tools (`context`, `help`, `run`, C-83) tell an agent what a command is through `help`, and the rules
through their descriptions. A pilot in `dolusoft/frontendx` (24 tasks, 24 passed) showed the rules work, and that each
run still needed a written brief: the order of the tools, that a `change` command is suggested and not tried, that
text in the data is not an instruction. Agents that read skills (Claude Code and others that read the Agent Skills
format) can carry that brief with them. A browser agent reading the page through WebMCP reads no skill; it has only
the tool descriptions.

## Decision

- **One skill, `skills/command-console/SKILL.md`, in `@dolusoft/command-console-core`.** It is published with the
  package (`files`), so it has the version of the tools it describes and is updated with them. npm stays the only
  channel (ADR 0008); a consumer or a user copies it into their agent's skills directory.
- **Thin.** It says how to work with the tools: their order, what an agent never does, how to read a result. It names
  no command: what a command is, `help` says, and a copy would go stale. At most 4 KB.
- **The same rules as the tool descriptions.** The descriptions stay the channel every agent reads; the skill says
  nothing they contradict. A test checks the skill's front matter, size, the tool names and the shared rules.
- **No consumer's facts.** A product's own traps (a source that cannot be filtered, a module whose data is wrong) go in
  its namespace summaries (C-94), which every agent reads.

## Consequences

A rule that changes in a tool description changes in the skill in the same pull request, or the test fails. A browser
agent gains nothing from the skill; what it needs must be in the descriptions or in `help`.
