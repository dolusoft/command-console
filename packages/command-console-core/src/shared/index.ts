// shared/: the contract the features talk through (ADR 0002).
//
// | Hook                                   | Registered by            | Called by                         |
// | -------------------------------------- | ------------------------ | --------------------------------- |
// | `onLineSubmitted`                      | recall                   | dispatch                          |
// | `onLineCleared`                        | recall, completion       | dispatch (every line end), reset  |
// | `onInputChange`                        | recall, completion       | input (`setInput`, `writeInput`)  |
// | `provideInputWriter` / `writeInput`    | input                    | recall, completion                |
// | `onKey`                                | completion               | `handleKey`                       |
// | `registerKeyAction` / `runKeyAction`   | dispatch, recall, compl. | `handleKey`                       |
// | `handleEffect` / `applyEffect`         | entries, console, recall, context | dispatch                 |
// | `providePrompt` / `promptOf`           | context                  | dispatch, `getPrompt`             |
// | `provideContext` / `contextOf`         | context                  | dispatch, completion              |
// | `onContextChange` / `contextChanged`   | dispatch                 | context                           |
// | `onControlledChange`                   | recall, context          | `setOptions`                      |
// | `provideCommandLookup` / `lookupOf`    | dispatch                 | completion, recall                |
// | `onReset`                              | dispatch, context, …     | `reset`                           |
// | `onDispose`                            | every feature            | `dispose`                         |
// | `assignMethods`                        | every feature            | the engine (no overwrite, no-op after dispose) |
export {
  contextChanged,
  contextOf,
  controlledChanged,
  inputChanged,
  keyPressed,
  lineCleared,
  lineSubmitted,
  lookupOf,
  onContextChange,
  onControlledChange,
  onInputChange,
  onKey,
  onLineCleared,
  onLineSubmitted,
  promptOf,
  provideCommandLookup,
  provideContext,
  provideInputWriter,
  providePrompt,
  writeInput,
  type CommandLookup,
  /** @public for the optional features */
  type ContextProvider,
  type ControlledChange,
  /** @public for the optional features */
  type EffectHandler,
  type InputChange,
  type InputOrigin,
  /** @public for the optional features */
  type InputWriter
} from './hooks'
export { applyEffect, contextEffects, handleEffect } from './effects'
export {
  actionsFor,
  registerKeyAction,
  runKeyAction,
  /** @public for the optional features */
  type KeyActionName,
  type KeyInput
} from './keys'
export {
  assignMethods,
  disposeShared,
  onDispose,
  onReset,
  resetHooks
} from './lifecycle'
export {
  createRecord,
  isDisposed,
  liveRecord,
  recordOf,
  type ConsoleStore,
  type SharedRecord
} from './registry'
