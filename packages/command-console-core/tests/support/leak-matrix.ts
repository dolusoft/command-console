// The leak matrix of C-36: a secret typed on a sensitive line must not reach
// anything the library keeps or hands out.
//
// The harness is shared. The feature specs (recall, completion, context) and
// the Vue specs reuse it:
// - pass their own console factory to `runLeakPath` (a console with their
//   feature, or one mounted in a component);
// - add their own paths (`[...coreLeakPaths, ...recallLeakPaths]`);
// - look at their own places (the DOM, the accessibility tree, the input
//   element) with `probe.scan(value, where)` inside `drive`.
//
// What a probe looks at by itself:
// - every callback of the options, at call time: each argument, with updaters
//   resolved against the value they update, and errors read through their own
//   properties, `message`, `name` and `cause`;
// - every state a subscriber is handed (the live input excluded, see below);
// - the state after the path, live input included, once the promises
//   settled.
//
// The live input is the one place the secret may be while it is typed, so
// `probe.check` skips it unless asked. The command's `run` and the
// `isSensitive` predicate receive the line by design (spec §6.8) and are not
// wrapped.
import type {
  CommandDefinition,
  Console,
  ConsoleOptions,
  ConsoleState,
  OptionalFeatures
} from '@dolusoft/command-console-core'
import type { ConsoleEntry } from '@dolusoft/command-protocol'

/** Any console a factory makes (with or without optional features). */
/** @public for the feature and Vue leak paths */
export type LeakConsole = Console<OptionalFeatures> | Console
/** Options in the widest shape; a factory narrows them as it needs. */
export type LeakOptions = ConsoleOptions<OptionalFeatures>
/** Makes the console of one path from the probed options. */
export type LeakConsoleFactory = (options: LeakOptions) => LeakConsole

/** One place the secret was found. */
export interface LeakFinding {
  /** Where: `onError[0].message`, `after:state.entries.2.text`… */
  where: string
  /** The string that contained the secret. */
  value: string
}

const collect = (
  value: unknown,
  path: string,
  out: [string, string][],
  visited: Set<unknown>
): void => {
  if (typeof value === 'string') {
    out.push([path, value])
    return
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    out.push([path, String(value)])
    return
  }
  if (typeof value === 'function') {
    out.push([`${path}.name`, value.name])
    return
  }
  if (typeof value !== 'object' || value === null || visited.has(value)) {
    return
  }
  visited.add(value)
  if (value instanceof Error) {
    // `message`, `name` and `cause` are not always own properties.
    out.push([`${path}.message`, value.message])
    out.push([`${path}.name`, value.name])
    collect(value.cause, `${path}.cause`, out, visited)
  }
  if (value instanceof AbortSignal) {
    collect(value.reason, `${path}.reason`, out, visited)
    return
  }
  for (const key of Reflect.ownKeys(value)) {
    const name = typeof key === 'symbol' ? key.toString() : key
    out.push([`${path}[key ${name}]`, name])
    let child: unknown
    try {
      child = (value as Record<PropertyKey, unknown>)[key]
    } catch {
      continue
    }
    collect(child, `${path}.${name}`, out, visited)
  }
}

/**
 * Every string reachable from `value`, with its path: own properties
 * (symbols included), property names, Error `message` / `name` / `cause`,
 * an `AbortSignal`'s reason.
 */
export const stringsOf = (
  value: unknown,
  path = 'value'
): [string, string][] => {
  const out: [string, string][] = []
  collect(value, path, out, new Set())
  return out
}

/**
 * The callbacks a probe wraps, with the slice each one's updater updates.
 * A feature with its own callback adds it here.
 */
/** @public for the feature and Vue leak paths */
export const probedCallbacks: Record<string, keyof ConsoleState | null> = {
  onEntriesChange: 'entries',
  onRecallChange: 'recall',
  onContextChange: 'context',
  onError: null,
  onClose: null,
  beforeRun: null,
  formatError: null,
  shouldRecord: null,
  createId: null
}

export interface Probe {
  readonly secret: string
  /** Everything found so far. */
  readonly findings: LeakFinding[]
  /** Records every string reachable from `value` that holds the secret. */
  scan(value: unknown, where: string): void
  /** Scans the state; `liveInput` also scans `state.input`. */
  check(
    console: { getState(): ConsoleState },
    where: string,
    liveInput?: boolean
  ): void
  /**
   * Wraps every callback `options` gives, so each call's arguments are
   * scanned; `current` gives the state updaters are resolved against.
   * Callbacks the options lack stay absent: absence changes behavior.
   */
  wrap<O extends object>(options: O, current: () => ConsoleState): O
  /** Scans every state a subscriber is handed, the live input excluded. */
  watch(console: Pick<LeakConsole, 'subscribe'>): () => void
}

export const createProbe = (secret: string): Probe => {
  const findings: LeakFinding[] = []
  const scan = (value: unknown, where: string) => {
    for (const [path, text] of stringsOf(value, where)) {
      if (text.includes(secret)) {
        findings.push({ where: path, value: text })
      }
    }
  }
  return {
    secret,
    findings,
    scan,
    check(console, where, liveInput = false) {
      const { input, ...rest } = console.getState()
      scan(rest, `${where}:state`)
      if (liveInput) {
        scan(input, `${where}:state.input`)
      }
    },
    wrap<O extends object>(options: O, current: () => ConsoleState): O {
      const wrapped: Record<string, unknown> = { ...options } as Record<
        string,
        unknown
      >
      for (const [name, slice] of Object.entries(probedCallbacks)) {
        const original = wrapped[name]
        if (typeof original !== 'function') {
          continue
        }
        wrapped[name] = (...args: unknown[]) => {
          args.forEach((arg, index) => {
            const value =
              slice !== null && typeof arg === 'function'
                ? (arg as (old: unknown) => unknown)(current()[slice])
                : arg
            scan(value, `${name}[${index}]`)
          })
          const result: unknown = (original as (...a: unknown[]) => unknown)(
            ...args
          )
          scan(result, `${name}:return`)
          return result
        }
      }
      return wrapped as O
    },
    watch(console) {
      let count = 0
      return console.subscribe(state => {
        const rest: Partial<ConsoleState> = { ...state }
        delete rest.input
        scan(rest, `subscribe[${count++}]`)
      })
    }
  }
}

/** Settles the pending run of the matrix's `slow` command. */
/** @public for the feature and Vue leak paths */
export interface SlowRun {
  resolve(value: unknown): void
  reject(error: unknown): void
}

/** What a path drives. */
/** @public for the feature and Vue leak paths */
export interface LeakContext {
  console: LeakConsole
  probe: Probe
  secret: string
  slow: SlowRun
}

/** One path of the matrix: ends a sensitive line one way. */
export interface LeakPath {
  name: string
  /** Options merged over the matrix's own (`leakConsoleOptions`). */
  options?: () => Partial<LeakOptions>
  /** Drives the console; may `probe.check` / `probe.scan` along the way. */
  drive(context: LeakContext): Promise<void> | void
}

/** The default secret: a value no command, prompt or message contains. */
export const leakSecret = 's3cr3t-Vt7q'

const banner: ConsoleEntry = {
  id: 'banner',
  kind: 'output',
  tone: 'default',
  blocks: [{ type: 'text', text: 'welcome' }]
}

/**
 * The options every matrix console starts from: `login` (sensitive), `set`
 * (`fromArg: 1`), `slow` (sensitive, pending until the path settles it),
 * `echo`, controlled entries (each report goes to `accept`), `onError` and
 * `onClose`.
 */
/** @public for the feature and Vue leak paths */
export const leakConsoleOptions = (
  slow: (handle: SlowRun) => void,
  accept: (updater: unknown) => void = () => undefined
): LeakOptions & { commands: CommandDefinition[] } => ({
  commands: [
    {
      name: 'login',
      sensitive: true,
      run: request => `welcome, ${request.args.length} arguments`
    },
    { name: 'set', sensitive: { fromArg: 1 }, run: () => 'saved' },
    {
      name: 'slow',
      sensitive: true,
      run: () =>
        new Promise((resolve, reject) => slow({ resolve: resolve, reject }))
    },
    { name: 'echo', run: () => 'echo' }
  ],
  state: { entries: [banner] },
  onEntriesChange: updater => accept(updater),
  onError: () => undefined,
  onClose: () => undefined
})

const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

/**
 * Runs one path on a fresh console from `create` and returns what leaked.
 * `extra` adds options (a feature's options, `features`).
 */
export const runLeakPath = async (
  path: LeakPath,
  create: LeakConsoleFactory,
  extra: Partial<LeakOptions> = {},
  secret = leakSecret
): Promise<LeakFinding[]> => {
  const probe = createProbe(secret)
  let pending: SlowRun | null = null
  const slow: SlowRun = {
    resolve: value => pending?.resolve(value),
    reject: error => pending?.reject(error)
  }
  let console: LeakConsole | null = null
  // The consumer side of the controlled entries: accept every report.
  const base = leakConsoleOptions(
    handle => {
      pending = handle
    },
    updater => {
      const current = console!.getState().entries
      const entries =
        typeof updater === 'function'
          ? (updater as (old: ConsoleEntry[]) => ConsoleEntry[])(current)
          : (updater as ConsoleEntry[])
      ;(console as Console<OptionalFeatures>).setOptions(old => ({
        ...old,
        state: { ...old.state, entries }
      }))
    }
  )
  const options = probe.wrap({ ...base, ...extra, ...path.options?.() }, () =>
    console!.getState()
  )
  console = create(options)
  probe.watch(console)
  await path.drive({ console, probe, secret, slow })
  await flush()
  probe.check(console, `${path.name}: after`, true)
  return probe.findings
}

/** The C-36 paths that need only the core features. */
export const coreLeakPaths: LeakPath[] = [
  {
    name: 'submit',
    drive: async ({ console, probe, secret }) => {
      console.setInput(`login admin ${secret}`)
      await console.submit()
      probe.check(console, 'submit', true)
    }
  },
  {
    name: 'submit with fromArg',
    drive: async ({ console, secret }) => {
      await console.run(`set password ${secret}`)
    }
  },
  {
    name: 'cancel',
    drive: ({ console, probe, secret }) => {
      console.setInput(`login admin ${secret}`)
      console.cancel()
      probe.check(console, 'cancel', true)
    }
  },
  {
    name: 'parse error',
    drive: async ({ console, secret }) => {
      await console.run(`login "${secret}`)
    }
  },
  {
    name: 'unknown (case-insensitive name)',
    drive: async ({ console, secret }) => {
      await console.run(`Login ${secret}`)
    }
  },
  {
    name: 'unknown (predicate)',
    options: () => ({ isSensitive: line => line.includes('--token') }),
    drive: async ({ console, secret }) => {
      await console.run(`${secret} --token`)
    }
  },
  {
    name: 'refusal',
    options: () => ({ beforeRun: () => false as const }),
    drive: async ({ console, secret }) => {
      await console.run(`login admin ${secret}`)
    }
  },
  {
    name: 'refusal with a response',
    options: () => ({ beforeRun: () => ({ output: 'denied' }) }),
    drive: async ({ console, secret }) => {
      await console.run(`login admin ${secret}`)
    }
  },
  {
    name: 'refusal by throw',
    options: () => ({
      beforeRun: () => {
        throw new Error('not allowed')
      }
    }),
    drive: async ({ console, secret }) => {
      await console.run(`login admin ${secret}`)
    }
  },
  {
    name: 'failure',
    drive: async ({ console, probe, secret, slow }) => {
      const done = console.run(`slow admin ${secret}`)
      probe.check(console, 'failure: running')
      slow.reject(new Error('backend said no'))
      await done
    }
  },
  {
    name: 'failure with formatError',
    options: () => ({ formatError: () => ({ output: 'failed' }) }),
    drive: async ({ console, slow, secret }) => {
      const done = console.run(`slow admin ${secret}`)
      slow.reject(new Error('backend said no'))
      await done
    }
  },
  {
    name: 'interrupt',
    drive: async ({ console, secret }) => {
      const done = console.run(`slow admin ${secret}`)
      console.cancel()
      await done
    }
  },
  {
    name: 'reset',
    drive: async ({ console, probe, secret }) => {
      console.setInput(`login admin ${secret}`)
      console.reset()
      probe.check(console, 'reset', true)
      const done = console.run(`slow admin ${secret}`)
      console.reset()
      await done
    }
  },
  {
    name: 'dispose',
    drive: ({ console, secret }) => {
      void console.run(`slow admin ${secret}`)
      console.dispose()
    }
  },
  {
    name: 'late rejection',
    drive: async ({ console, secret, slow }) => {
      const done = console.run(`slow admin ${secret}`)
      console.cancel()
      await done
      // The late error mentions nothing; a stale run calls nothing anyway.
      slow.reject(new Error('late'))
    }
  },
  {
    name: 'predicate throws',
    options: () => ({
      isSensitive: () => {
        throw new Error('predicate')
      }
    }),
    drive: async ({ console, secret }) => {
      await console.run(`echo ${secret}`)
    }
  }
]
