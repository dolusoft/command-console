# Command Console

A headless command console for Vue 3: a scrollback of entries above one input line with a prompt. The user types a line, the console parses it, runs the consumer's command for it and appends what the command returns. The library owns the console's behavior (line editing keys, recall, completion, dispatch, cancellation, redaction of sensitive lines, a context stack that changes the prompt); the consumer owns the commands, their meaning, every product text and all styling. It ships no CSS.

It is not a terminal emulator: no PTY, no ANSI escape handling, no cursor addressing.

> Work in progress: 1.0 is being built. The packages below are not published yet.

| Package                                                           | Contents                                                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`@dolusoft/command-protocol`](packages/command-protocol)         | JSON types of entries, output blocks, command specs, responses, effects and context frames; the line tokenizer |
| [`@dolusoft/command-console-core`](packages/command-console-core) | the console engine (`createConsole`) and its features                                                          |
| [`@dolusoft/command-console`](packages/command-console)           | `useCommandConsole` and the `CommandConsole` component                                                         |

- [PRINCIPLES.md](PRINCIPLES.md): the boundaries of the library.
- [contract/rules.md](contract/rules.md) and the generated [CONTRACT.md](CONTRACT.md): the behavior rules and the public contract.
- [docs/decisions/](docs/decisions/README.md): the architecture decisions.
- [CONTRIBUTING.md](CONTRIBUTING.md): layout, commands, measuring, releasing.

## License

[MIT](LICENSE.md)
