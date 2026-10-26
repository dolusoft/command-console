// Copy is never taken over (README: Keyboard, D-07): with text selected in
// the input, or in the console's part of the document, Ctrl+C stays the
// browser's.
import type { KeyInput } from '@dolusoft/command-console-core'

/** Whether the document has a non-empty selection inside `root`. */
const hasSelectionIn = (root: Element | null): boolean => {
  const selection = root?.ownerDocument.getSelection()
  if (!root || !selection || selection.isCollapsed) {
    return false
  }
  if (selection.toString() === '') {
    return false
  }
  const { anchorNode, focusNode } = selection
  return (
    (anchorNode !== null && root.contains(anchorNode)) ||
    (focusNode !== null && root.contains(focusNode))
  )
}

/** Where text is selected, as `KeyInput.selection` reports it. */
export const selectionOf = (
  input: HTMLInputElement,
  root: Element | null
): KeyInput['selection'] => {
  if (
    input.selectionStart !== null &&
    input.selectionStart !== input.selectionEnd
  ) {
    return 'input'
  }
  return hasSelectionIn(root) ? 'document' : 'none'
}
