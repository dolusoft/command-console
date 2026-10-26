// A click in the log focuses the input (README: DOM and styling, B-33), unless
// the user is selecting text or clicked something of its own.

const interactive =
  'a, button, input, select, textarea, [tabindex], [contenteditable]'

/**
 * Whether a click on `target` inside `log` should focus the input: not when
 * text is selected, not inside an interactive element.
 */
export const clickFocusesInput = (
  target: EventTarget | null,
  log: Element
): boolean => {
  const selection = log.ownerDocument.getSelection()
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
  return !(found && log.contains(found))
}
