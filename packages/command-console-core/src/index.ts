// @dolusoft/command-console-core: the engine of a headless command console.
// No framework and no DOM: an adapter turns DOM events into method calls and
// renders the state (P14).

export { consoleFeatures, createConsole } from './helpers/consoleFeatures'
export { agentTools } from './helpers/agentTools'
export { CommandError } from './core/dispatch/commandError'
export type { CommandErrorCode } from './core/dispatch/commandError'
export type {
  AgentTool,
  AgentToolAnnotations,
  AgentToolsOptions
} from './helpers/agentTools'
export { contextFeature } from './features/context/contextFeature'
export { recallFeature } from './features/recall/recallFeature'
export { completionFeature } from './features/completion/completionFeature'

export type {
  CompletionAPI,
  CompletionFeature,
  CompletionSession,
  Console,
  ConsoleOptions,
  ConsoleState,
  ContextAPI,
  ContextFeature,
  ControllableState,
  CoreConsoleAPI,
  FeatureAPIsOf,
  InputState,
  OptionalFeatures,
  RecallAPI,
  RecallFeature,
  RequestInput,
  RunningCommand
} from './core/console/console.types'
export type {
  BeforeRunResult,
  CommandDefinition,
  CommandRequest,
  CommandReturn,
  CompletionRequest,
  CompletionResult,
  ConsoleGate,
  NamespaceDefinition,
  NamespaceSpec,
  RunContext,
  RunInfo
} from './core/dispatch/dispatch.types'
export type { KeyInput } from './shared/keys'
export type { Updater } from './store/action'
