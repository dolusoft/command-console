import type { ContextFrame } from '@dolusoft/command-protocol'

/**
 * The id sequence of `frames`, as one comparable string. Two stacks with the
 * same ids in the same order are the same context (core README: Controlled
 * slices).
 */
export const idsOf = (frames: readonly ContextFrame[]): string =>
  JSON.stringify(frames.map(frame => frame.id))

/** `frames` with `frame` on top. */
export const pushFrame = (
  frames: ContextFrame[],
  frame: ContextFrame
): ContextFrame[] => [...frames, frame]

/**
 * `frames` without its top `count` frames; stops at the root. `count` is
 * rounded down; a count below 1 (or `NaN`) pops nothing, and nothing popped
 * gives `frames` back unchanged.
 */
export const popFrames = (
  frames: ContextFrame[],
  count: number
): ContextFrame[] => {
  const n = Number.isNaN(count) ? 0 : Math.floor(count)
  if (n < 1 || frames.length === 0) {
    return frames
  }
  return frames.slice(0, Math.max(0, frames.length - n))
}

/** The root: no frame. `frames` itself when it is already empty. */
export const resetFrames = (frames: ContextFrame[]): ContextFrame[] =>
  frames.length === 0 ? frames : []
