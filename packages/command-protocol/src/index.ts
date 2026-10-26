// @dolusoft/command-protocol: the JSON types of a command console (entries,
// output blocks, command specs, responses, effects, context frames) and the
// line tokenizer. Zero dependencies, no framework, no DOM (P11).

export type { JsonPrimitive, JsonValue } from './json'
export { isJsonValue } from './json'

export type { ConsoleEntry, InputEntry, OutputEntry } from './entry'
export type {
  CustomBlock,
  JsonBlock,
  ListBlock,
  MessageBlock,
  MessageCode,
  MessageParams,
  OutputBlock,
  TableBlock,
  TableColumn,
  TextBlock
} from './block'
export type { CommandResponse, CommandSpec, ConsoleEffect } from './command'
export type { ContextFrame } from './context'

export type { Token, TokenizeError, TokenizeResult } from './syntax/tokenize'
export { tokenize } from './syntax/tokenize'
export { quoteArgument } from './syntax/quote'
