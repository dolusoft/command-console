// Effects (spec §4, §6.1). Each effect type is applied by the feature that
// owns it: `clear` (entries), `close` (console), `push-context`,
// `pop-context`, `reset-context` (context), `clear-recall` (recall). Dispatch
// applies a run's effects in order, before the run's output, inside the
// action of the run's end; an effect whose feature is absent is ignored.
// Context effects of a run whose context changed by someone else are dropped
// by dispatch before they reach the handler (spec §6.7).
import type { ConsoleEffect } from '@dolusoft/command-protocol'

import type { EffectHandler } from './hooks'
import { liveRecord, recordOf } from './registry'

/** The effect types that change the context stack. */
export const contextEffects: ReadonlySet<ConsoleEffect['type']> = new Set([
  'push-context',
  'pop-context',
  'reset-context'
])

/** Registers the handler of effect `type` (one feature per type). */
export const handleEffect = <T extends ConsoleEffect['type']>(
  console: object,
  type: T,
  handler: EffectHandler<T>
): void => {
  const effects = liveRecord(console).hooks.effects
  if (effects[type]) {
    throw new Error(`The ${type} effect already has a handler.`)
  }
  ;(effects as Record<string, unknown>)[type] = handler
}

/** Applies one effect; `false` when no feature handles its type. */
export const applyEffect = (
  console: object,
  effect: ConsoleEffect
): boolean => {
  const handler = recordOf(console)?.hooks.effects[effect.type] as
    ((effect: ConsoleEffect) => void) | undefined
  if (!handler) {
    return false
  }
  handler(effect)
  return true
}
