// A click anywhere in the console focuses the input (README: DOM and styling,
// C-51), unless the user is selecting text or clicked something of its own.

const interactive =
  'a, button, input, select, textarea, [tabindex], [contenteditable]'

/**
 * Whether a click on `target` inside `root` should focus the input: not when
 * text is selected, not inside an interactive element (the input included:
 * a click on it is the browser's).
 */
export const clickFocusesInput = (
  target: EventTarget | null,
  root: Element
): boolean => {
  const selection = root.ownerDocument.getSelection()
  if (selection && !selection.isCollapsed && selection.toString() !== '') {
    return false
  }
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null
  const found = element?.closest(interactive)
  return !(found && root.contains(found))
}
