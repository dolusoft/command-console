# 0012 The envelope and the gate

Status: Accepted (2026-11-04)

## Context

The terminal of `dolusoft/frontendx` becomes the entry of an AI panel: the user, the application's own assistant and
an agent in the browser (through WebMCP) use one list of commands. Every command goes through the backend: the console
sends it, the backend hands it back to the same user's connections (the echo), and only then does it run. In its first
stage the backend only carries and distributes, to the connections of the user who sent it
([gecko-project-backend#1966](https://github.com/dolusoft/gecko-project-backend/issues/1966)). The design is the
[AI terminal specification](https://github.com/dolusoft/frontend-v2-design/blob/0647f795f59100c02ba0a81d9c660e808c8cdb18/design/ai-terminal.md); the work
is [#13](https://github.com/dolusoft/command-console/issues/13).

So a command must be described as data (a schema for its input, the danger of running it), carried as data (an
envelope), and run from its echo. The console must stay what ADR 0001, ADR 0006 and P1 make it: three packages, a core
without DOM, clock or timer, no network or storage in any package, and no input handed to the callbacks.

## Decision

- **The envelope lives in the protocol and knows no transport.** `Envelope` (version 1, `kind: 'request'` only), its
  limits (`envelopeMaxBytes`, `inputLimits`) and `parseEnvelope` are plain JSON and pure functions in
  `@dolusoft/command-protocol`. So are the command input schema (`InputSchema`, `checkInputSchema`, `validateInput`),
  the option line (`parseOptions`, `formatCommandLine`), `danger`, `Actor`, `CommandOutcome` and `ErrorCode`. The
  validator is our own, a small subset of JSON Schema: no dependency (P11).
- **The core gets a `gate`; the network stays with the consumer (P1).** The gate is an interface the consumer passes
  to `createConsole`: the tab id, `send(envelope)`, `subscribe(listener)` and `schedule(ms, fn)`. The consumer's
  transport (SignalR in frontendx) implements it; the core never imports a transport.
- **The gate's `schedule` is the core's only clock.** The echo timeout is scheduled through it, so the core keeps the
  timer-free shape of ADR 0001; tests pass a fake clock, and `dispose()` cancels what is scheduled.
- **The echo runs the local record.** The sender keeps each pending operation's envelope. When its echo comes back
  with the same `command`, `args` and `target`, the local record runs, not the echo's content; a different echo closes
  the operation with `id-conflict`. Closed ids are remembered in memory, so a late echo runs nothing.
- **WebMCP: the core makes DOM-free tool definitions; the consumer registers them.** The core produces plain objects
  (name, description, input schema, annotations, `execute`); the line that touches `document.modelContext` is the
  consumer's. The three packages of ADR 0001 stay; no fourth package is added.
- **Inputs are not opened to `RunInfo`.** `beforeRun`, the error and recording callbacks keep receiving `RunInfo`
  without arguments (ADR 0006, C-33); only the command's own `run` sees its input.

This record decides the shape; the core's code follows in a later change, with its own rules.

## Consequences

- A consumer without a gate has the 1.0 console: every addition is optional, and the 1.x line only adds (ADR 0009).
- The protocol grows by the schema, the option line and the envelope; its size budget is raised with the fixture that
  uses them (P8).
- A command without `input` or `danger` cannot be called through an envelope; the user can still type it, and it runs
  locally as in 1.0.
- The core's tests drive the echo, the timeout and the cancellation through a fake gate; the transport's own tests
  live with the consumer.

## Trade-off

Every command waits for a round trip through the backend, even one that only reads: a little latency is accepted for
one path that the backend can later check, log and authorize. Keeping the transport outside the core means the
consumer writes the gate and its reconnection; in exchange the core keeps no socket, no timer and no storage, and the
same core runs with an in-page gate in tests and in development.

## Addendum (2026-11-04): a command's own outcome

The first consumer (the Data View commands of frontendx) found that a caller could not tell why a command failed: a
command that finds no tab wants to say `target-not-found`, but every throw resolved `failed`.

- **A command ends with a code by throwing a `CommandError`.** The class lives in the core, next to
  `CommandDefinition`: it is a runtime value, not JSON, so it stays out of the protocol, and `ErrorCode` stays the
  protocol's type. `new CommandError(code, message?, options?)` is an `Error`; the run fails as with any error
  (`onError`, `formatError` or `command-failed`, C-18), only the outcome changes (C-86).
- **A command may give only the codes it can mean:** `target-not-found`, `invalid-args`, `failed`. The other codes
  name what the core saw (`busy`, `timeout`, `id-conflict`, `connection-lost`, `cancelled`, …); a command that claims
  one would lie to the caller, so it gives `failed`. A `CommandError` thrown by `beforeRun`, `normalize` or
  `createEnvelopeId` is not the command's answer and gives `failed` too.
- The error's message never reaches the outcome or the entries (ADR 0006); the code is the whole answer.
- **A response in the `error` tone is not `ok`.** A command that reports its failure as output instead of a throw is
  drawn as before, but its outcome is `failed` (C-87): the caller and the user must not read one run two ways.

## Addendum (2026-11-05): what an agent reads back

A live test with the Data View commands of frontendx (1.2.0) showed an agent that could not repair its own call: it
got `invalid-args` while the reason ("an internal source takes no filter") was drawn only in the terminal; `{ command }`
without `args` was refused; `help` listed translation keys, because the summary was made when the command was defined
and the translations came later; `"columns": "a,b"` was refused before the command's `normalize` could split it; and
one flat `help` list does not hold the 15 to 30 commands that come next.

- **An error outcome may say what to fix (C-89).** This replaces "the error's message never reaches the outcome"
  above. The message of a `CommandError` from the command's own `run`, and the schema's refusal in words (which field,
  what it wants, a near known field), go to the outcome's `message`, cut to 300 code points. The entries still get
  only the code (ADR 0006); a message is for the caller and is never drawn, so P7 (no hardcoded text in what is drawn)
  holds. Any other error stays `failed` without a message: its text is internal. A refused line the console would
  redact, and any input value, are never repeated (P16).
- **No `args` is `{}`.** `request({ command })` and the `run` tool take a command without input.
- **A summary may be a function (C-90).** It is called when a spec is made, not at registration. `CommandSpec`, the
  JSON type, keeps a string summary: the function lives on `CommandDefinition` only.
- **A string for a list of strings is a list of one (C-91),** before the check, on the `{ command, args }` path. The
  core does not split it: what a separator means is the command's.
- **`help` is paged (C-92).** It lists namespaces (a name up to its first dot) with their counts and one page of
  commands, kept within 8 KB, with an opaque `nextCursor`; `prefix` keeps one namespace. The output of `help` without
  `command` changes from an array to that object; its one consumer is frontendx, and the change is in the release
  notes.

## Addendum (2026-11-05): which namespace, and why not

A pilot with frontendx (1.3.0, 24 tasks) lost four tasks for two reasons. The agent did not find the right module:
`help` gave namespaces as names and counts, nothing said that `updater` knows images and restarts or that `syslogs`
holds the services' own logs, and the agent answered that the tools could not do it. And the agent did not know what
`danger` means: asked to stop every task it tried `tasks.stop`, got a bare `not-allowed` and told the user nothing;
in another task it offered to start a command itself with `--yes`, which only the user may run.

- **A `not-allowed` says why, and a `change` command's gives the line (C-93).** The outcome becomes
  `{ status: 'error', code: 'not-allowed', message, line? }`. `line` is the canonical line of the input, the text
  the input entry would hold (before `normalize`, the history's form), so what the agent suggests is what the user
  will see in the history. It follows P16 as the rest of `request` does: a line that `isSensitive` marks, typed or
  canonical, is never handed back, and options the schema refuses give no line (a wrong line is worse than none).
  `irreversible` stays refused without a line: such work never runs from the console. A `beforeRun` refusal is the
  consumer's and stays bare.
- **The tools say what `danger` means.** The `help` and `run` descriptions tell the agent that it runs `read`
  commands, that a `change` command is run only by the user typing it, and that it should suggest the line rather
  than retry. A description is the one text every agent reads before its first call.
- **A namespace may carry one line on what it is for (C-94).** It is a console option,
  `namespaces: [{ name, summary? }]`, next to `commands`, and not a `registerNamespace()` call or a field on each
  command: the console takes everything it knows as options (`commands`, `gate`, `activeView`), replaced whole by
  `setOptions`, and has no registration method to copy; a field on each command would let two commands of one
  namespace disagree. The summary may be a function, read when it is used, as a command's summary is (C-90).
  `getNamespaces()` hands the summaries to the consumer's own `help` command, so the terminal and the agent read the
  same text. The agent's `help` lists them in `namespaces` cut to 160 code points; the 8 KB page holds, with
  commands leaving first and then summaries from the last namespace. The Vue composable does not take the option,
  as it does not take `gate`: a console with agent tools is created with the core and handed to it (C-84).
- **The terminal's `help` command and its table stay the consumer's.** The library ships no `help` command (README);
  `help <namespace>` and the layout of its table are frontendx's.
