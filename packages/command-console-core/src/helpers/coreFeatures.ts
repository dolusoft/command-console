import type { ConsoleFeature } from '../core/console/console.types'
import { consoleFeature } from '../core/console/consoleFeature'
import { dispatchFeature } from '../core/dispatch/dispatchFeature'
import { entriesFeature } from '../core/entries/entriesFeature'
import { inputFeature } from '../core/input/inputFeature'

/** The features every console has, in construction order (ADR 0002). */
export const coreFeatures: readonly ConsoleFeature[] = [
  consoleFeature,
  entriesFeature,
  inputFeature,
  dispatchFeature
]
