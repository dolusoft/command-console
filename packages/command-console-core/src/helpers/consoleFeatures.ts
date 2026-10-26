import { coreFeatures } from './coreFeatures'
import type {
  Console,
  ConsoleOptions,
  OptionalFeatures
} from '../core/console/console.types'
import { constructConsole } from '../core/console/constructConsole'

/**
 * Keeps the type of a features object, so it can be declared once, outside
 * a component, and passed to `createConsole` (ADR 0002).
 *
 * @example
 * ```ts
 * const features = consoleFeatures({ recallFeature, contextFeature })
 * const console = createConsole({ features, commands })
 * ```
 */
export function consoleFeatures<T extends Partial<OptionalFeatures>>(
  features: T
): T {
  return features
}

/**
 * Creates a console with the core features and the optional ones in
 * `options.features`. Nothing runs and nothing is called on creation.
 * Throws when a command name is invalid or repeats (C-56).
 */
// `{}` and not its constraint: without `features` the console has no
// optional method (ADR 0002, C-01).
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export function createConsole<T extends Partial<OptionalFeatures> = {}>(
  options: ConsoleOptions<T>
): Console<T> {
  return constructConsole(options, coreFeatures) as unknown as Console<T>
}
