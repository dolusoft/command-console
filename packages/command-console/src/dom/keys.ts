// KeyboardEvent → KeyInput (spec §5.2): the adapter's whole share of the
// key map. Core never sees a DOM event.
import type { KeyInput } from '@dolusoft/command-console-core'

import { selectionOf } from './selection'

/** The key press `event` on `input`, inside the console `root`. */
export const keyInputOf = (
  event: KeyboardEvent,
  input: HTMLInputElement,
  root: Element | null
): KeyInput => ({
  key: event.key,
  ctrlKey: event.ctrlKey,
  shiftKey: event.shiftKey,
  altKey: event.altKey,
  metaKey: event.metaKey,
  // 229: the key an IME holds while it composes (older engines do not set
  // `isComposing` on the keydown that starts a composition).
  isComposing: event.isComposing || event.keyCode === 229,
  selection: selectionOf(input, root)
})
