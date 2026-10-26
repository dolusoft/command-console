// Replays the B-items of spec §8 that need only the core features against
// the frontendx-shaped command set (tests/fixtures/frontendx).
import { describe, expect, it, vi } from 'vitest'

import { createConsole, type RunInfo } from '@dolusoft/command-console-core'
import type { ConsoleEntry } from '@dolusoft/command-protocol'

import { ctrlC, deferred, enter, outputs, withoutIds } from './helpers'
import {
  banner,
  fakeConfig,
  frontendxCommands
} from '../../../tests/fixtures/frontendx/commands'

const setup = (
  extra: Parameters<typeof createConsole>[0] extends infer O
    ? Partial<O>
    : never = {}
) => {
  const config = fakeConfig()
  let entries: ConsoleEntry[] = banner
  const onClose = vi.fn()
  const console = createConsole({
    commands: frontendxCommands(config),
    prompt: 'gecko>',
    state: { entries },
    onEntriesChange: updater => {
      entries = typeof updater === 'function' ? updater(entries) : updater
      console.setOptions(old => ({ ...old, state: { entries } }))
    },
    onClose,
    ...extra
  })
  return { console, config, onClose }
}

describe('frontendx replay (core features) C-09 C-25 C-30', () => {
  it('B-04, B-09: banner first, Enter submits the trimmed line', async () => {
    const { console } = setup()
    expect(console.getState().entries).toEqual(banner)
    console.setInput('  show mail.host ')
    console.handleKey(enter)
    await Promise.resolve()
    expect(withoutIds(console.getState().entries.slice(1))).toEqual([
      {
        kind: 'input',
        prompt: 'gecko>',
        text: 'show mail.host',
        redacted: false,
        status: 'submitted'
      },
      {
        kind: 'output',
        tone: 'default',
        blocks: [{ type: 'json', value: { 'mail.host': 'smtp.example' } }],
        inputId: 'c1'
      }
    ])
  })

  it('B-21, B-22: set is redacted before anything, beforeRun gets no value', async () => {
    const infos: RunInfo[] = []
    const { console, config } = setup({
      beforeRun: info => {
        infos.push(info)
        return undefined
      }
    })
    await console.run('set ldap.password n3w-secret')
    expect(config.saved).toEqual([['ldap.password', 'n3w-secret']])
    expect(JSON.stringify(console.getState())).not.toContain('n3w-secret')
    expect(JSON.stringify(infos)).not.toContain('n3w-secret')
    expect(infos[0]).toMatchObject({
      command: 'set',
      sensitive: true,
      name: null
    })
    expect(outputs(console.getState().entries).at(-1)).toMatchObject({
      tone: 'notice',
      blocks: [{ type: 'text', text: 'Saved ldap.password.' }]
    })
  })

  it('B-22: a refused run stops silently', async () => {
    const { console, config } = setup({ beforeRun: () => false as const })
    await console.run('set mail.host x')
    expect(config.saved).toEqual([])
    expect(outputs(console.getState().entries)).toEqual([...banner])
  })

  it('B-23: the save is asynchronous; Ctrl+C interrupts it and nothing is saved', async () => {
    const { console, config } = setup()
    const done = console.run('set mail.host other')
    expect(console.getState().running).toMatchObject({ command: 'set' })
    expect(console.handleKey(enter)).toBe(false)
    console.handleKey(ctrlC)
    await done
    await Promise.resolve()
    expect(config.saved).toEqual([])
    expect(outputs(console.getState().entries).at(-1)?.blocks).toEqual([
      { type: 'message', code: 'interrupted' }
    ])
  })

  it('B-24..B-28: show, help, unknown command', async () => {
    const { console } = setup()
    await console.run('show')
    await console.run('help')
    await console.run('shw')
    const out = outputs(console.getState().entries).slice(1)
    expect(out.map(e => e.blocks[0].type)).toEqual(['table', 'list', 'message'])
    expect(JSON.stringify(out[0])).not.toContain('hunter2')
    expect(out[2].blocks[0]).toEqual({
      type: 'message',
      code: 'command-not-found',
      params: { name: 'shw' }
    })
  })

  it('B-29, B-36: clear empties the screen, exit closes', async () => {
    const { console, onClose } = setup()
    await console.run('help')
    await console.run('cls')
    expect(console.getState().entries).toEqual([])
    await console.run('exit')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('config and end without the context feature run and change nothing', async () => {
    const { console } = setup()
    await console.run('config ldap')
    await console.run('end')
    expect(console.getPrompt()).toBe('gecko>')
    expect(console.getState().context).toEqual([])
  })

  it('B-07: reset while a save waits cancels it first, then clears', async () => {
    const gate = deferred<undefined>()
    const { console, config } = setup({ beforeRun: () => gate.promise })
    const done = console.run('set mail.host other')
    console.reset()
    gate.resolve(undefined)
    await done
    await Promise.resolve()
    expect(config.saved).toEqual([])
    // Controlled entries without initialState: their initial value is [].
    expect(console.getState().entries).toEqual([])
  })
})
