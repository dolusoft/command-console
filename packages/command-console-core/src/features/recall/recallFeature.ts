// The recall feature (README: Recall, Keyboard): the submitted lines, oldest →
// newest, browsed with ArrowUp / ArrowDown. The list is a controllable slice
// (`recall`); the cursor and the draft are internal and die with the line.
//
// A sensitive line never reaches the list (dispatch does not call
// `onLineSubmitted` for it) and never becomes the draft: browsing away from a
// sensitive input keeps an empty draft and replaces the input element (C-31).
import { limitOf, recordLine, defaultRecallLimit } from './recall.utils'
import type {
  AnyConsole,
  ConsoleFeature,
  RecallFeature
} from '../../core/console/console.types'
import {
  assignMethods,
  handleEffect,
  liveRecord,
  lookupOf,
  onControlledChange,
  onInputChange,
  onLineCleared,
  onLineSubmitted,
  registerKeyAction,
  writeInput
} from '../../shared'

/** Ends browsing: drops the cursor and the draft, keeps the input. */
const endBrowsing = (console: object): void => {
  const { store } = liveRecord(console)
  store.update('recallCursor', () => null)
  store.update('recallDraft', () => null)
}

/** Shows `line` in the input, the caret at its end. */
const show = (console: object, line: string): void =>
  writeInput(console, line, line.length, 'recall')

/** ArrowUp: keeps the draft on the first press, then goes older. */
const previous = (console: object): boolean => {
  const { store } = liveRecord(console)
  return store.action(() => {
    const { running, recall, recallCursor, input } = store.read()
    if (running !== null || recall.length === 0) {
      return false
    }
    let next: number
    if (recallCursor === null) {
      const sensitive =
        input.value.trim() !== '' && lookupOf(console).isSensitive(input.value)
      if (sensitive) {
        // A programmatic clear replaces the element that held the line
        // (README: Sensitive lines), so its undo history goes with it.
        writeInput(console, '', 0, 'recall')
      }
      store.update('recallDraft', () => (sensitive ? '' : input.value))
      next = recall.length - 1
    } else {
      next = Math.min(recallCursor, recall.length) - 1
      if (next < 0) {
        return false
      }
    }
    store.update('recallCursor', () => next)
    show(console, recall[next])
    return true
  })
}

/** ArrowDown: goes newer; past the newest restores the draft. */
const following = (console: object): boolean => {
  const { store } = liveRecord(console)
  return store.action(() => {
    const { running, recall, recallCursor, recallDraft } = store.read()
    if (running !== null || recallCursor === null) {
      return false
    }
    const next = recallCursor + 1
    if (next >= recall.length) {
      endBrowsing(console)
      show(console, recallDraft ?? '')
      return true
    }
    store.update('recallCursor', () => next)
    show(console, recall[next])
    return true
  })
}

/** Empties the list and ends browsing (README: Recall, C-23). */
const clear = (console: object): void => {
  const { store } = liveRecord(console)
  store.update('recall', old => (old.length === 0 ? old : []))
  endBrowsing(console)
}

/**
 * Records a submitted line. `shouldRecord` runs first; a throwing
 * `shouldRecord` records nothing and its error goes to `onError` after the
 * action, like any callback's.
 */
const record = (console: object, line: string): void => {
  const { store, options } = liveRecord(console)
  let keep: boolean
  try {
    keep = options.shouldRecord?.(line) ?? true
  } catch (error) {
    keep = false
    store.afterCommit(() => {
      throw error
    })
  }
  if (!keep) {
    return
  }
  const limit = limitOf(options.recallLimit)
  store.update('recall', old => recordLine(old, line, limit))
}

const feature: ConsoleFeature & RecallFeature = {
  name: 'recall',

  getDefaultOptions: () => ({ recallLimit: defaultRecallLimit }),

  constructConsoleAPIs(console: AnyConsole) {
    assignMethods(
      console,
      {
        recallPrevious: () => previous(console),
        recallNext: () => following(console),
        clearRecall() {
          const { store } = liveRecord(console)
          store.action(() => clear(console))
        }
      },
      { recallPrevious: false, recallNext: false }
    )
  },

  init(console: AnyConsole) {
    registerKeyAction(console, 'recallPrevious', () => previous(console))
    registerKeyAction(console, 'recallNext', () => following(console))
    handleEffect(console, 'clear-recall', () => clear(console))
    onLineSubmitted(console, line => record(console, line))
    onLineCleared(console, () => endBrowsing(console))
    onInputChange(console, change => {
      // Any edit that is not recall's own ends browsing; a caret move does
      // not, and the edited text stays.
      if (change.origin !== 'recall' && change.value !== change.previousValue) {
        endBrowsing(console)
      }
    })
    onControlledChange(console, change => {
      if (change.slice === 'recall') {
        endBrowsing(console)
      }
    })
  }
}

/**
 * The recall feature: ArrowUp / ArrowDown browse the submitted lines
 * (`recallPrevious`, `recallNext`, `clearRecall`). Options: `recallLimit`
 * (default 100), `shouldRecord`.
 *
 * @example
 * ```ts
 * const console = createConsole({ features: { recallFeature }, commands })
 * ```
 */
export const recallFeature: RecallFeature = feature
