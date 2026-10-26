// The completion paths of the C-36 leak matrix (spec §6.5 step 2, §12). Run
// them with a console that has the completion feature:
// `runLeakPath(path, options => createConsole({ ...options, features: { completionFeature } }))`.
//
// Each path types a sensitive line, presses Tab where the secret is (or
// where it is not yet), and ends the line. The probe scans every state a
// subscriber is handed (the completion session included) and, through the
// `complete` provider each path installs, every request a provider receives.
import type {
  CommandDefinition,
  CompletionAPI,
  KeyInput
} from '@dolusoft/command-console-core'

import {
  leakConsoleOptions,
  type LeakConsole,
  type LeakContext,
  type LeakOptions,
  type LeakPath
} from './leak-matrix'

const tab: KeyInput = {
  key: 'Tab',
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  selection: 'none'
}

/** The requests the providers of the current path received. */
let requests: unknown[] = []

/**
 * The matrix's commands, each with a provider that records its request and
 * offers two candidates, one of which would carry the secret if a provider
 * ever saw it.
 */
const withProviders = (): Partial<LeakOptions> => {
  requests = []
  const complete: CommandDefinition['complete'] = request => {
    requests.push(request)
    return [`${request.prefix}-one`, `${request.prefix}-two`, 'password']
  }
  const { commands } = leakConsoleOptions(() => undefined)
  return { commands: commands.map(definition => ({ ...definition, complete })) }
}

type Completing = LeakConsole & CompletionAPI

/** Types `value` with the caret at `|` (or at the end) and presses Tab. */
const typeAndTab = (console: LeakConsole, value: string) => {
  const caret = value.indexOf('|')
  const line = value.replace('|', '')
  console.editInput(line, caret === -1 ? line.length : caret)
  console.handleKey(tab)
}

/** Scans what the providers received, then the state. */
const check = ({ console, probe }: LeakContext, where: string) => {
  probe.scan(requests, `${where}:provider requests`)
  probe.check(console, where)
}

export const completionLeakPaths: LeakPath[] = [
  {
    name: 'completion at fromArg, then submit',
    options: withProviders,
    drive: async context => {
      const { console, secret } = context
      typeAndTab(console, `set password ${secret}`)
      check(context, 'completion at fromArg')
      await console.submit()
    }
  },
  {
    name: 'completion at a safe position before the secret, then cancel',
    options: withProviders,
    drive: context => {
      const { console, secret } = context
      typeAndTab(console, `set pa| ${secret}`)
      ;(console as Completing).completeNext()
      check(context, 'completion before the secret')
      console.cancel()
    }
  },
  {
    name: 'completion on a sensitive: true command',
    options: withProviders,
    drive: async context => {
      const { console, secret } = context
      typeAndTab(console, `login ${secret}`)
      check(context, 'completion on login')
      await console.submit()
    }
  },
  {
    name: 'completion on a case-insensitive sensitive name',
    options: withProviders,
    drive: async context => {
      const { console, secret } = context
      typeAndTab(console, `LOGIN admin ${secret}`)
      check(context, 'completion on LOGIN')
      await console.submit()
    }
  },
  {
    name: 'completion on a predicate match',
    options: () => ({
      ...withProviders(),
      isSensitive: line => line.includes('--token')
    }),
    drive: async context => {
      const { console, secret } = context
      typeAndTab(console, `${secret}| --token`)
      typeAndTab(console, `echo ${secret} --token`)
      check(context, 'completion on a predicate match')
      await console.submit()
    }
  },
  {
    name: 'session open, then the secret typed, then reset',
    options: withProviders,
    drive: context => {
      const { console, secret } = context
      typeAndTab(console, 'set pa')
      console.editInput(`set password ${secret}`, 13 + secret.length)
      console.handleKey(tab)
      check(context, 'session then secret')
      console.reset()
    }
  }
]
