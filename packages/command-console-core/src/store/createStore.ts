// The store and the action boundary (spec §3.3, §3.4; ADR 0001, ADR 0003).
//
// An action is one synchronous step. Inside it every change goes to a working
// copy of the state; a call made while an action is open joins it. When the
// outermost action ends:
//
// 1. each controlled slice that changed is reported once, through an updater
//    that replays the action's changes of that slice in order;
// 2. the other slices are committed;
// 3. the callbacks queued by the action run;
// 4. subscribers are notified once.
//
// The base of a controlled slice is the value last reported, until the
// consumer delivers one (`deliver`) or the microtask after the report runs;
// then it is the consumer's value again. The store knows no console type: it
// is generic over the state and the names of the controllable slices.
import { composeSteps, type Step } from './action'

export interface StoreConfig<S extends object, C extends keyof S> {
  /** The state on creation, controllable slices included. */
  initial: S
  /** The slices the consumer may control. */
  controllable: readonly C[]
  /** The consumer's value of slice `key`, `undefined` when not controlled. */
  external(key: C): S[C] | undefined
  /** Reports the changes of a controlled slice to the consumer. */
  report(key: C, step: Step<S[C]>): void
  /** A callback, report or subscriber threw. */
  onCallbackError(error: unknown): void
}

export interface Store<S extends object, C extends keyof S> {
  /**
   * The committed state; controlled slices read from the consumer. The same
   * object until the next commit or delivery.
   */
  getState(): S
  /** Calls `listener` after every action that changed something. */
  subscribe(listener: (state: S) => void): () => void
  /** Runs `fn` as an action, or as part of the open one. */
  action<R>(fn: () => R): R
  /** Whether an action is open. */
  inAction(): boolean
  /** The state as the open action sees it; the committed state outside one. */
  read(): S
  /** Changes one slice inside the open action. */
  update<K extends keyof S>(key: K, step: Step<S[K]>): void
  /** Queues `callback` to run after the open action's commit. */
  afterCommit(callback: () => void): void
  /**
   * The consumer delivered new options: `keys` are the controlled slices
   * whose value it passed. Their last reported value stops being the base.
   * Must run inside an action, which then notifies.
   */
  deliver(keys: readonly C[]): void
  /** Whether slice `key` is controlled now. */
  isControlled(key: C): boolean
  /** Drops every listener and pending base and sets `state` (dispose). */
  clear(state: S): void
}

interface OpenAction<S, C extends keyof S> {
  working: S
  steps: Map<C, Step<S[C]>[]>
  callbacks: (() => void)[]
  changed: boolean
}

export function createStore<S extends object, C extends keyof S>(
  config: StoreConfig<S, C>
): Store<S, C> {
  let committed: S = { ...config.initial }
  let snapshot: S | null = null
  let open: OpenAction<S, C> | null = null
  const pending = new Map<C, S[C]>()
  const listeners = new Set<(state: S) => void>()

  const isControlled = (key: C) => config.external(key) !== undefined
  const isControllable = (key: keyof S): key is C =>
    (config.controllable as readonly (keyof S)[]).includes(key)

  /** Where an action starts for a controlled slice. */
  const base = (key: C): S[C] =>
    pending.has(key) ? (pending.get(key) as S[C]) : config.external(key)!

  const getState = (): S => {
    if (snapshot === null) {
      const state = { ...committed }
      for (const key of config.controllable) {
        if (isControlled(key)) {
          state[key] = config.external(key)!
        }
      }
      snapshot = state
    }
    return snapshot
  }

  const guarded = (fn: () => void) => {
    try {
      fn()
    } catch (error) {
      config.onCallbackError(error)
    }
  }

  const commit = (action: OpenAction<S, C>) => {
    const reports: [C, Step<S[C]>][] = []
    for (const [key, steps] of action.steps) {
      if (isControlled(key)) {
        reports.push([key, composeSteps(steps)])
        pending.set(key, action.working[key])
      }
    }
    committed = action.working
    if (action.changed) {
      snapshot = null
    }
    for (const [key, step] of reports) {
      guarded(() => config.report(key, step))
      const reported = action.working[key]
      // The only scheduling the core does (spec §3.3): after this tick the
      // consumer's own value is the base again.
      void Promise.resolve().then(() => {
        if (pending.get(key) === reported) {
          pending.delete(key)
        }
      })
    }
    for (const callback of action.callbacks) {
      guarded(callback)
    }
    if (action.changed) {
      const state = getState()
      for (const listener of [...listeners]) {
        guarded(() => listener(state))
      }
    }
  }

  const requireOpen = (): OpenAction<S, C> => {
    if (open === null) {
      throw new Error('A state change must run inside an action.')
    }
    return open
  }

  return {
    getState,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    action(fn) {
      if (open !== null) {
        return fn()
      }
      const working = { ...committed }
      for (const key of config.controllable) {
        if (isControlled(key)) {
          working[key] = base(key)
        }
      }
      const action: OpenAction<S, C> = {
        working,
        steps: new Map(),
        callbacks: [],
        changed: false
      }
      open = action
      try {
        return fn()
      } finally {
        open = null
        commit(action)
      }
    },
    inAction: () => open !== null,
    read: () => (open === null ? getState() : open.working),
    update(key, step) {
      const action = requireOpen()
      const old = action.working[key]
      const next = step(old)
      if (Object.is(old, next)) {
        return
      }
      action.working[key] = next
      action.changed = true
      if (isControllable(key) && isControlled(key)) {
        const steps = action.steps.get(key) ?? []
        steps.push(step as unknown as Step<S[C]>)
        action.steps.set(key, steps)
      }
    },
    afterCommit(callback) {
      requireOpen().callbacks.push(callback)
    },
    deliver(keys) {
      const action = requireOpen()
      snapshot = null
      action.changed = true
      for (const key of keys) {
        pending.delete(key)
        if (isControlled(key)) {
          // The action's own changes so far, replayed on the delivered value.
          action.working[key] = composeSteps(action.steps.get(key) ?? [])(
            base(key)
          )
        }
      }
    },
    isControlled,
    clear(state) {
      committed = { ...state }
      snapshot = null
      pending.clear()
      listeners.clear()
    }
  }
}
