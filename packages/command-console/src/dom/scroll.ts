// Scroll (spec §7.4, Q-08, C-58): the log sticks to the bottom while the user
// is within 2 px of it, and after the user's own submit; new output does not
// move a view the user scrolled up. `scrollTop` is the only style-related
// write of the package (P5).
import { nextTick, onBeforeUnmount, onMounted, type ShallowRef } from 'vue'

/** How close to the bottom still counts as at the bottom, in px. */
const slack = 2

export interface StickToBottom {
  /** The user's own submit: stick again and show the bottom now. */
  stick(): void
  /** The log's `scroll` event. */
  onScroll(): void
}

export const useStickToBottom = (
  log: Readonly<ShallowRef<HTMLElement | null>>,
  entries: Readonly<ShallowRef<HTMLElement | null>>
): StickToBottom => {
  let stuck = true
  let observer: ResizeObserver | null = null
  let mounted = false

  const toBottom = () => {
    const element = log.value
    if (mounted && element) {
      element.scrollTop = element.scrollHeight
    }
  }

  onMounted(() => {
    mounted = true
    // One observer on the entries; a late callback after unmount does
    // nothing (D-04).
    if (typeof ResizeObserver !== 'undefined' && entries.value) {
      observer = new ResizeObserver(() => {
        if (stuck) {
          toBottom()
        }
      })
      observer.observe(entries.value)
    }
  })

  onBeforeUnmount(() => {
    mounted = false
    observer?.disconnect()
    observer = null
  })

  return {
    stick() {
      stuck = true
      void nextTick(toBottom)
    },
    onScroll() {
      const element = log.value
      if (element) {
        stuck =
          element.scrollHeight - element.scrollTop - element.clientHeight <=
          slack
      }
    }
  }
}
