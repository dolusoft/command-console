// The context feature (README: Context; core README: Controlled slices): a
// stack of frames, bottom → top, with an implicit root. The top frame sets the
// prompt of the next input entry. A run takes a snapshot of the frames and the
// revision at its start; dispatch drops the context effects of a run whose
// context changed by someone else, and this feature tells it when that happens.
import type { ContextFrame } from '@dolusoft/command-protocol'

import { idsOf, popFrames, pushFrame, resetFrames } from './context.utils'
import type {
  AnyConsole,
  ConsoleFeature,
  ContextFeature
} from '../../core/console/console.types'
import {
  assignMethods,
  contextChanged,
  handleEffect,
  liveRecord,
  onControlledChange,
  provideContext,
  providePrompt
} from '../../shared'

/** What the feature keeps per console: the revision and the ids it counts. */
interface Revision {
  value: number
  /** The id sequence the value was counted for. */
  ids: string
}

const revisions = new WeakMap<object, Revision>()

const framesOf = (console: object): ContextFrame[] =>
  liveRecord(console).store.read().context

/**
 * The revision now. It changes whenever the id sequence differs from the one
 * it was last counted for, so a change nobody announced (a controlled value
 * the consumer did not hand back) still counts.
 */
const revisionOf = (console: object): number => {
  const revision = revisions.get(console)!
  const ids = idsOf(framesOf(console))
  if (ids !== revision.ids) {
    revision.ids = ids
    revision.value++
  }
  return revision.value
}

/** A known change: always a new revision, even if the ids come back. */
const markChanged = (console: object) => {
  const revision = revisions.get(console)!
  revision.ids = idsOf(framesOf(console))
  revision.value++
}

/**
 * Changes the stack in the open action. `byOther`: the change does not come
 * from a run's effects, so a running command's context is stale (C-62).
 */
const change = (
  console: object,
  step: (frames: ContextFrame[]) => ContextFrame[],
  byOther: boolean
) => {
  const { store } = liveRecord(console)
  const before = store.read().context
  store.update('context', step)
  if (store.read().context === before) {
    return
  }
  markChanged(console)
  if (byOther) {
    contextChanged(console)
  }
}

const feature = {
  name: 'context',

  constructConsoleAPIs(console: AnyConsole) {
    const act = (step: (frames: ContextFrame[]) => ContextFrame[]): void => {
      liveRecord(console).store.action(() => change(console, step, true))
    }
    assignMethods(console, {
      pushContext: (frame: ContextFrame) =>
        act(frames => pushFrame(frames, frame)),
      popContext: (count = 1) => act(frames => popFrames(frames, count)),
      resetContext: () => act(resetFrames)
    })
  },

  init(console: AnyConsole) {
    revisions.set(console, { value: 0, ids: idsOf(framesOf(console)) })
    providePrompt(console, () => framesOf(console).at(-1)?.prompt ?? null)
    provideContext(console, {
      snapshot: () => [...framesOf(console)],
      revision: () => revisionOf(console)
    })
    handleEffect(console, 'push-context', effect =>
      change(console, frames => pushFrame(frames, effect.frame), false)
    )
    handleEffect(console, 'pop-context', effect =>
      change(console, frames => popFrames(frames, effect.count ?? 1), false)
    )
    handleEffect(console, 'reset-context', () =>
      change(console, resetFrames, false)
    )
    // An external `context` with another id sequence is a context change; a
    // new array with the same ids is not (core README: Controlled slices).
    onControlledChange(console, controlled => {
      if (
        controlled.slice === 'context' &&
        idsOf(controlled.previous) !== idsOf(controlled.next)
      ) {
        markChanged(console)
        contextChanged(console)
      }
    })
  }
} satisfies ConsoleFeature

/**
 * The context feature: a stack of frames whose top sets the prompt. Adds
 * `pushContext`, `popContext` and `resetContext`, and applies the
 * `push-context`, `pop-context` and `reset-context` effects.
 *
 * @example
 * ```ts
 * const console = createConsole({ features: { contextFeature }, commands })
 * console.pushContext({ id: 'db', prompt: 'db>' })
 * ```
 */
export const contextFeature: ContextFeature = feature
