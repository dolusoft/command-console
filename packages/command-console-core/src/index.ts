// @dolusoft/command-console-core: the engine of a headless command console.
// No framework and no DOM: an adapter turns DOM events into method calls and
// renders the state (P14).

export { consoleFeatures, createConsole } from './helpers/consoleFeatures'
export { recallFeature } from './features/recall/recallFeature'

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
  RunningCommand
} from './core/console/console.types'
export type {
  BeforeRunResult,
  CommandDefinition,
  CommandRequest,
  CommandReturn,
  CompletionRequest,
  CompletionResult,
  RunContext,
  RunInfo
} from './core/dispatch/dispatch.types'
export type { KeyInput } from './shared/keys'
export type { Updater } from './store/action'
