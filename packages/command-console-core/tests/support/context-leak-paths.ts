// The C-36 paths of the context feature: a sensitive line that ends while a
// context is open, or whose run sees the context change. Run them with a
// console that has `contextFeature` (see `context.spec.ts`).
import type { Console, OptionalFeatures } from '@dolusoft/command-console-core'
import type { ConsoleEntry, ContextFrame } from '@dolusoft/command-protocol'

import type { LeakConsole, LeakPath } from './leak-matrix'

const frame: ContextFrame = { id: 'db', prompt: 'db>', data: { path: 'db' } }

const withContext = (console: LeakConsole) =>
  console as Console<OptionalFeatures>

export const contextLeakPaths: LeakPath[] = [
  {
    name: 'submit in a context',
    drive: async ({ console, probe, secret }) => {
      withContext(console).pushContext(frame)
      await console.run(`login admin ${secret}`)
      probe.check(console, 'submit in a context', true)
    }
  },
  {
    name: 'cancel in a context',
    drive: ({ console, secret }) => {
      withContext(console).pushContext(frame)
      console.setInput(`login admin ${secret}`)
      console.cancel()
    }
  },
  {
    name: 'context method during a run',
    drive: async ({ console, probe, secret, slow }) => {
      const done = console.run(`slow admin ${secret}`)
      withContext(console).pushContext(frame)
      probe.check(console, 'context method during a run: aborted')
      slow.resolve({
        output: 'done',
        effects: [{ type: 'push-context', frame: { id: 'x', prompt: 'x>' } }]
      })
      await done
    }
  },
  {
    name: 'external context during a run',
    // Context and entries controlled; the context report is dropped, the
    // consumer replaces the context itself.
    options: () => ({
      state: { entries: [] as ConsoleEntry[], context: [] as ContextFrame[] },
      onContextChange: () => undefined
    }),
    drive: async ({ console, secret, slow }) => {
      const done = console.run(`slow admin ${secret}`)
      withContext(console).setOptions(old => ({
        ...old,
        state: { ...old.state, context: [frame] }
      }))
      slow.resolve({ effects: [{ type: 'reset-context' }] })
      await done
    }
  },
  {
    name: 'reset in a context',
    drive: async ({ console, secret }) => {
      withContext(console).pushContext(frame)
      const done = console.run(`slow admin ${secret}`)
      console.reset()
      await done
    }
  }
]
