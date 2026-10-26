// The C-36 paths of the recall feature: the secret must reach neither the
// recall list nor the recall draft, whatever ends the line. Each path runs on
// a console with `recallFeature` (the factory adds it) and is reusable by the
// Vue specs with a mounted console.
import type { Console, OptionalFeatures } from '@dolusoft/command-console-core'

import type { LeakContext, LeakPath } from './leak-matrix'

const arrowUp = {
  key: 'ArrowUp',
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  selection: 'none'
} as const
const arrowDown = { ...arrowUp, key: 'ArrowDown' } as const

const withRecall = (context: LeakContext) =>
  context.console as Console<Pick<OptionalFeatures, 'recallFeature'>>

/** Browses the whole list up and back down, checking the state each step. */
const browse = (context: LeakContext, where: string) => {
  const console = withRecall(context)
  const { probe } = context
  let step = 0
  while (console.handleKey(arrowUp)) {
    probe.check(console, `${where}: up ${step++}`, true)
  }
  while (console.handleKey(arrowDown)) {
    probe.check(console, `${where}: down ${step++}`, true)
  }
}

/** The recall paths of C-36; the console has `recallFeature`. */
export const recallLeakPaths: LeakPath[] = [
  {
    name: 'recall draft',
    options: () => ({ initialState: { recall: ['echo one'] } }),
    drive: context => {
      const { console, probe, secret } = context
      console.setInput(`login admin ${secret}`)
      withRecall(context).recallPrevious()
      probe.check(console, 'recall draft: browsing', true)
      browse(context, 'recall draft')
    }
  },
  {
    name: 'recall draft (fromArg)',
    options: () => ({ initialState: { recall: ['echo one'] } }),
    drive: context => {
      context.console.setInput(`set password ${context.secret}`)
      browse(context, 'recall draft (fromArg)')
    }
  },
  {
    name: 'recall draft (predicate)',
    options: () => ({
      initialState: { recall: ['echo one'] },
      isSensitive: line => line.includes('--token')
    }),
    drive: context => {
      context.console.setInput(`echo ${context.secret} --token`)
      browse(context, 'recall draft (predicate)')
    }
  },
  {
    name: 'recall after submit (controlled recall)',
    options: () => ({
      state: { entries: [], recall: [] },
      onRecallChange: () => undefined,
      shouldRecord: () => true
    }),
    drive: async context => {
      const { console, secret } = context
      await console.run('echo visible')
      await console.run(`login admin ${secret}`)
      await console.run(`set password ${secret}`)
      await console.run(`Login ${secret}`)
      await console.run(`login "${secret}`)
      browse(context, 'recall after submit')
    }
  },
  {
    name: 'recall after cancel, interrupt and failure',
    options: () => ({ shouldRecord: () => true }),
    drive: async context => {
      const { console, secret, slow } = context
      await console.run('echo visible')
      console.setInput(`login admin ${secret}`)
      console.cancel()
      const interrupted = console.run(`slow admin ${secret}`)
      console.cancel()
      await interrupted
      const failed = console.run(`slow admin ${secret}`)
      slow.reject(new Error('backend said no'))
      await failed
      browse(context, 'recall after cancel, interrupt and failure')
    }
  },
  {
    name: 'recall draft, then reset',
    options: () => ({ initialState: { recall: ['echo one'] } }),
    drive: context => {
      const { console, probe, secret } = context
      console.setInput(`login admin ${secret}`)
      withRecall(context).recallPrevious()
      console.reset()
      probe.check(console, 'recall draft, then reset', true)
    }
  }
]
