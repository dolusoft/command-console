// @dolusoft/command-protocol: the JSON types of a command console (entries,
// output blocks, command specs, responses, effects, context frames, input
// schemas, the envelope), the line tokenizer and the pure functions over
// them. Zero dependencies, no framework, no DOM (P11).

export type { JsonPrimitive, JsonValue } from './json'
export { isJsonValue } from './json'

export type { Actor, ConsoleEntry, InputEntry, OutputEntry } from './entry'
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
export type {
  CommandResponse,
  CommandSpec,
  ConsoleEffect,
  Danger
} from './command'
export type { ContextFrame } from './context'
export type { CommandOutcome, ErrorCode } from './outcome'
export { dataMaxBytes } from './outcome'

export type {
  ArrayInputSchema,
  BooleanInputSchema,
  InputSchema,
  InputSchemaNode,
  NumberInputSchema,
  StringInputSchema
} from './input/schema'
export { inputLimits } from './input/schema'
export { checkInputSchema } from './input/check'
export type { InputError, InputErrorCode, InputResult } from './input/validate'
export { validateInput } from './input/validate'

export type { Token, TokenizeError, TokenizeResult } from './syntax/tokenize'
export { tokenize } from './syntax/tokenize'
export { quoteArgument } from './syntax/quote'
export { formatCommandLine, parseOptions } from './syntax/options'

export type { Envelope, EnvelopeErrorCode, EnvelopeResult } from './envelope'
export { envelopeBytes, envelopeMaxBytes, parseEnvelope } from './envelope'

export type {
  AwaitingApprovalReply,
  CancelReply,
  CapabilitiesReply,
  ChunkReply,
  CliCancel,
  CliMessage,
  CliMessageResult,
  CliReply,
  CliRequest,
  FinishedReply,
  ReceivedReply,
  RemoteCommandSpec,
  RemoteOrigin,
  RemoteOutcome,
  RemoteStamp
} from './remote'
export {
  chunkData,
  isCliReply,
  joinChunks,
  parseCliMessage,
  remoteBytes,
  remoteChunksMax,
  remoteLineMax,
  remoteVersion
} from './remote'
