// A frontendx-shaped command set (spec §12) with fake data: the settings
// console of dolusoft/frontendx#1812 reduced to what the library sees. Not
// shipped; the specs replay the B-items of spec §8 against it. The core
// piece covers what needs only the core features; the feature pieces add
// recall, completion and context replays on the same set.
//
// `config <section>` enters a section (push-context) and `end` leaves it
// (pop-context): without the context feature both effects are ignored.
import type { CommandDefinition } from '@dolusoft/command-console-core'
import type {
  ConsoleEntry,
  ContextFrame,
  OutputBlock
} from '@dolusoft/command-protocol'

/** The fake configuration the commands read and write. */
export interface FakeConfig {
  values: Map<string, string>
  /** Keys whose value is never shown (frontendx masks them, S-05). */
  secrets: Set<string>
  /** What `set` was asked to save, in order. */
  saved: [string, string][]
}

export const fakeConfig = (): FakeConfig => ({
  values: new Map([
    ['ldap.url', 'ldap://directory.example'],
    ['ldap.password', 'hunter2'],
    ['mail.host', 'smtp.example']
  ]),
  secrets: new Set(['ldap.password']),
  saved: []
})

/** The section a key lives in after `config <section>`. */
const keyOf = (context: ContextFrame[], key: string) => {
  const section = context.at(-1)?.id
  return section && !key.includes('.') ? `${section}.${key}` : key
}

const masked = (config: FakeConfig, key: string) =>
  config.secrets.has(key) ? '********' : (config.values.get(key) ?? '')

/** The welcome banner, as `initialState.entries`. */
export const banner: ConsoleEntry[] = [
  {
    id: 'banner',
    kind: 'output',
    tone: 'default',
    blocks: [{ type: 'text', text: 'Gecko settings console. Type help.' }]
  }
]

export const frontendxCommands = (config: FakeConfig): CommandDefinition[] => [
  {
    name: 'show',
    summary: 'Shows the configuration or one key.',
    usage: 'show [key]',
    run: ({ args, context }) => {
      if (args.length === 0) {
        const rows = [...config.values.keys()].map(key => ({
          key,
          value: masked(config, key)
        }))
        return [
          {
            type: 'table',
            columns: [
              { key: 'key', label: 'Key' },
              { key: 'value', label: 'Value' }
            ],
            rows
          }
        ]
      }
      const key = keyOf(context, args[0])
      if (!config.values.has(key)) {
        return { output: `No key ${key}.`, tone: 'error' }
      }
      return [{ type: 'json', value: { [key]: masked(config, key) } }]
    }
  },
  {
    name: 'config',
    summary: 'Enters a section.',
    usage: 'config <section>',
    run: ({ args }) => {
      const section = args[0]
      if (!section) {
        return { output: 'Usage: config <section>', tone: 'error' }
      }
      return {
        effects: [
          {
            type: 'push-context',
            frame: { id: section, prompt: `${section}>` }
          }
        ]
      }
    }
  },
  {
    name: 'set',
    summary: 'Sets a key.',
    usage: 'set <key> <value>',
    sensitive: { fromArg: 1 },
    run: async ({ args, context }, { signal }) => {
      const [name, value] = args
      if (name === undefined || value === undefined) {
        return { output: 'Usage: set <key> <value>', tone: 'error' }
      }
      const key = keyOf(context, name)
      // The save is asynchronous, as the backend call is.
      await Promise.resolve()
      if (signal.aborted) {
        return
      }
      config.values.set(key, value)
      config.saved.push([key, value])
      return { output: `Saved ${key}.`, tone: 'notice' }
    }
  },
  {
    name: 'end',
    summary: 'Leaves the section.',
    run: () => ({ effects: [{ type: 'pop-context' }] })
  },
  {
    name: 'exit',
    summary: 'Closes the console.',
    run: () => ({ effects: [{ type: 'close' }] })
  },
  {
    name: 'clear',
    aliases: ['cls'],
    summary: 'Clears the screen.',
    run: () => ({ effects: [{ type: 'clear' }] })
  },
  {
    name: 'help',
    summary: 'Lists the commands.',
    run: (): OutputBlock[] => [
      {
        type: 'list',
        items: [
          'show [key]',
          'config <section>',
          'set <key> <value>',
          'end',
          'exit',
          'clear',
          'help'
        ]
      }
    ]
  }
]
