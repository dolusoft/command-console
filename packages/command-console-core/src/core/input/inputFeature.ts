// The input feature (spec §5.2, §6.1 step 4, §6.8): the live line, its caret
// and the revision the adapter keys the input element by.
import {
  assignMethods,
  inputChanged,
  lineCleared,
  liveRecord,
  provideInputWriter,
  type InputOrigin
} from '../../shared'
import type { AnyConsole, ConsoleFeature } from '../console/console.types'

const clamp = (caret: number, value: string) =>
  Number.isFinite(caret)
    ? Math.min(Math.max(0, Math.floor(caret)), value.length)
    : value.length

/**
 * Writes the input in the open action and tells the `onInputChange` hooks.
 * A programmatic clear of a non-empty input increments the revision; a user
 * edit (`programmatic: false`) never does (spec §6.8, C-54).
 */
const write = (
  console: object,
  value: string,
  caret: number,
  origin: InputOrigin,
  programmatic: boolean
): void => {
  const { store } = liveRecord(console)
  const previous = store.read().input
  const next = {
    value,
    caret: clamp(caret, value),
    revision:
      programmatic && value === '' && previous.value !== ''
        ? previous.revision + 1
        : previous.revision
  }
  if (next.value === previous.value && next.caret === previous.caret) {
    return
  }
  store.update('input', () => next)
  inputChanged(console, {
    value: next.value,
    caret: next.caret,
    previousValue: previous.value,
    previousCaret: previous.caret,
    origin
  })
}

/**
 * The line-end cleanup (spec §6.1 step 4), the same on every path that ends
 * a line: clears the input, increments the revision when the line was
 * sensitive, and calls the `onLineCleared` hooks. Runs in the open action.
 */
export const endLine = (console: object, sensitive: boolean): void => {
  const { store } = liveRecord(console)
  store.update('input', input => ({
    value: '',
    caret: 0,
    revision: sensitive ? input.revision + 1 : input.revision
  }))
  lineCleared(console)
}

/**
 * Replaces the live input with `line` for `run(line)`: a non-empty input is
 * a programmatic clear first (revision + 1), then `line` is written.
 */
export const replaceInput = (console: object, line: string): void => {
  const { store } = liveRecord(console)
  store.update('input', input => ({
    value: line,
    caret: line.length,
    revision: input.value === '' ? input.revision : input.revision + 1
  }))
}

export const inputFeature: ConsoleFeature = {
  name: 'input',

  constructConsoleAPIs(console: AnyConsole) {
    const set = (value: string, caret: number, programmatic: boolean) => {
      const { store } = liveRecord(console)
      store.action(() => {
        if (store.read().running === null) {
          write(console, value, caret, null, programmatic)
        }
      })
    }
    assignMethods(console, {
      setInput(value: string, caret?: number) {
        set(value, caret ?? value.length, true)
      },
      editInput(value: string, caret: number) {
        set(value, caret, false)
      }
    })
  },

  init(console: AnyConsole) {
    provideInputWriter(console, (value, caret, origin) => {
      const { store } = liveRecord(console)
      store.action(() => {
        if (store.read().running === null) {
          // A feature's write is programmatic (recall restoring an empty
          // draft replaces the element like any programmatic clear).
          write(console, value, caret, origin, true)
        }
      })
    })
  }
}
