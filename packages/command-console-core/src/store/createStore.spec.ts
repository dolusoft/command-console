import { describe, expect, it, vi } from 'vitest'

import type { Step } from './action'
import { createStore } from './createStore'

interface S {
  list: number[]
  count: number
}

const setup = (controlled?: () => number[] | undefined) => {
  const reports: Step<number[]>[] = []
  const errors: unknown[] = []
  const store = createStore<S, 'list'>({
    initial: { list: [], count: 0 },
    controllable: ['list'],
    external: () => controlled?.(),
    report: (_key, step) => reports.push(step),
    onCallbackError: error => errors.push(error)
  })
  return { store, reports, errors }
}

describe('store', () => {
  it('commits once per outermost action and joins nested ones', () => {
    const { store } = setup()
    const listener = vi.fn()
    store.subscribe(listener)
    store.action(() => {
      store.update('count', n => n + 1)
      store.action(() => store.update('count', n => n + 1))
      expect(store.getState().count).toBe(0)
      expect(store.read().count).toBe(2)
    })
    expect(listener).toHaveBeenCalledOnce()
    expect(store.getState().count).toBe(2)
  })

  it('an action that changes nothing notifies nobody', () => {
    const { store } = setup()
    const listener = vi.fn()
    store.subscribe(listener)
    store.action(() => store.update('count', n => n))
    expect(listener).not.toHaveBeenCalled()
  })

  it('a change outside an action throws', () => {
    const { store } = setup()
    expect(() => store.update('count', () => 1)).toThrow(/inside an action/)
    expect(() => store.afterCommit(() => undefined)).toThrow()
  })

  it('reports a controlled slice once, with an updater that replays the steps', () => {
    const external: number[] = [9]
    const { store, reports } = setup(() => external)
    store.action(() => {
      store.update('list', l => [...l, 1])
      store.update('list', l => [...l, 2])
    })
    expect(reports).toHaveLength(1)
    expect(reports[0]([])).toEqual([1, 2])
    expect(reports[0]([9])).toEqual([9, 1, 2])
    expect(store.getState().list).toBe(external)
  })

  it('the base is the last report until the next tick or a delivery', async () => {
    let external: number[] = []
    const { store, reports } = setup(() => external)
    store.action(() => store.update('list', l => [...l, 1]))
    store.action(() => store.update('list', l => [...l, 2]))
    expect(reports[1]([])).toEqual([2])
    // Built on [1], the report of the first action.
    store.action(() => {
      expect(store.read().list).toEqual([1, 2])
    })
    await Promise.resolve()
    await Promise.resolve()
    store.action(() => {
      expect(store.read().list).toBe(external)
    })
    store.action(() => store.update('list', l => [...l, 3]))
    external = [7]
    store.action(() => {
      store.deliver(['list'])
      expect(store.read().list).toEqual([7])
    })
  })

  it('callbacks run after the reports and before the listeners; errors are reported', () => {
    const order: string[] = []
    const { store, errors } = setup()
    store.subscribe(() => order.push('listener'))
    store.action(() => {
      store.update('count', () => 1)
      store.afterCommit(() => {
        order.push('callback')
        throw new Error('callback')
      })
    })
    expect(order).toEqual(['callback', 'listener'])
    expect(errors).toHaveLength(1)
  })

  it('clear drops listeners and sets the state', () => {
    const { store } = setup()
    const listener = vi.fn()
    store.subscribe(listener)
    store.clear({ list: [], count: 5 })
    store.action(() => store.update('count', () => 6))
    expect(listener).not.toHaveBeenCalled()
    expect(store.getState().count).toBe(6)
  })
})
