import type { JsonValue } from './json'

/**
 * One level of the context stack. The stack runs bottom → top; the root is
 * implicit and has no frame. The prompt of a new input entry is the top
 * frame's `prompt`. What a frame means is the consumer's (`data`).
 */
export interface ContextFrame {
  /** Identifies the frame; a change of the id sequence is a context change. */
  id: string
  /** The prompt shown while this frame is on top. */
  prompt: string
  /** The consumer's data for this frame. */
  data?: JsonValue
}
