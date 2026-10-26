// The fixed key map (README: Keyboard, C-53). `handleKey` matches a chord and
// tries the chord's actions in order; an action returns `true` when its
// condition held and it acted, so the next one is not tried and the key counts
// as handled. An action that is not registered (its feature is absent) is
// skipped. A key no action handles is left to the browser.
import { liveRecord, recordOf } from './registry'

/** A key press as the adapter reports it; core never sees a DOM event. */
export interface KeyInput {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  /** A key during IME composition is never handled. */
  isComposing: boolean
  /** Whether text is selected in the input or in the console's document. */
  selection: 'none' | 'input' | 'document'
}

/**
 * The actions of the key map:
 *
 * - `submit`, `cancel` (dispatch);
 * - `recallPrevious`, `recallNext` (recall);
 * - `acceptCompletion`, `completeNext`, `completePrevious`, `selectNext`,
 *   `selectPrevious`, `closeCompletion` (completion).
 */
export type KeyActionName =
  | 'submit'
  | 'cancel'
  | 'recallPrevious'
  | 'recallNext'
  | 'acceptCompletion'
  | 'completeNext'
  | 'completePrevious'
  | 'selectNext'
  | 'selectPrevious'
  | 'closeCompletion'

interface Chord {
  key: string
  ctrl?: true
  shift?: true
}

/**
 * Chord → actions, tried in order. Modifiers match exactly; letters compare
 * case-insensitively. The "when" of each action (README: Keyboard) is the
 * action's own check:
 *
 * - Enter: `acceptCompletion` when a candidate is selected, else `submit`.
 * - Ctrl+C: `cancel`, only without a selection (`handleKey` checks it).
 * - ArrowUp / ArrowDown: `selectPrevious` / `selectNext` while a session is
 *   open, else `recallPrevious` / `recallNext`.
 * - Tab: `completeNext` on a non-empty input or with a session open.
 * - Shift+Tab: `completePrevious` with a session open.
 * - Escape: `closeCompletion` with a session open.
 *
 * While a command runs only Ctrl+C is handled (README: Cancelling and errors).
 */
const keyMap: readonly (readonly [Chord, readonly KeyActionName[]])[] = [
  [{ key: 'enter' }, ['acceptCompletion', 'submit']],
  [{ key: 'c', ctrl: true }, ['cancel']],
  [{ key: 'arrowup' }, ['selectPrevious', 'recallPrevious']],
  [{ key: 'arrowdown' }, ['selectNext', 'recallNext']],
  [{ key: 'tab' }, ['completeNext']],
  [{ key: 'tab', shift: true }, ['completePrevious']],
  [{ key: 'escape' }, ['closeCompletion']]
]

const matches = (chord: Chord, input: KeyInput) =>
  input.key.toLowerCase() === chord.key &&
  input.ctrlKey === (chord.ctrl ?? false) &&
  input.shiftKey === (chord.shift ?? false) &&
  !input.altKey &&
  !input.metaKey

/** The actions `input` maps to, in order; empty when it maps to none. */
export const actionsFor = (input: KeyInput): readonly KeyActionName[] =>
  keyMap.find(([chord]) => matches(chord, input))?.[1] ?? []

/**
 * Registers the action `name` (one feature per action). It runs inside the
 * `handleKey` action and returns whether it acted.
 */
export const registerKeyAction = (
  console: object,
  name: KeyActionName,
  action: () => boolean
): void => {
  const actions = liveRecord(console).hooks.keyActions
  if (actions[name]) {
    throw new Error(`The key action ${name} is already registered.`)
  }
  actions[name] = action
}

/** Runs the action `name`; `false` when it is not registered or did not act. */
export const runKeyAction = (console: object, name: KeyActionName): boolean =>
  recordOf(console)?.hooks.keyActions[name]?.() ?? false
