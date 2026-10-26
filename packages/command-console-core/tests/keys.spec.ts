import { describe, expect, it, vi } from 'vitest'

import { createConsole } from '@dolusoft/command-console-core'

import { command, deferred, key, outputs } from './helpers'

describe('C-53 Key map', () => {
  const setup = () => {
    const run = vi.fn(() => 'ok')
    const console = createConsole({ commands: [command('a', run)] })
    return { console, run }
  }

  it('Enter submits and Ctrl+C cancels, with exact modifiers', () => {
    const { console, run } = setup()
    console.setInput('a')
    for (const modifier of [
      'ctrlKey',
      'shiftKey',
      'altKey',
      'metaKey'
    ] as const) {
      expect(console.handleKey(key('Enter', { [modifier]: true }))).toBe(false)
    }
    expect(run).not.toHaveBeenCalled()
    expect(console.handleKey(key('Enter'))).toBe(true)
    expect(run).toHaveBeenCalledOnce()

    console.setInput('x')
    for (const extra of [
      { ctrlKey: true, shiftKey: true },
      { ctrlKey: true, altKey: true },
      { ctrlKey: true, metaKey: true },
      {}
    ]) {
      expect(console.handleKey(key('c', extra))).toBe(false)
    }
    expect(console.getState().input.value).toBe('x')
    expect(console.handleKey(key('C', { ctrlKey: true }))).toBe(true)
    expect(console.getState().input.value).toBe('')
  })

  it('a key with isComposing is never handled', () => {
    const { console, run } = setup()
    console.setInput('a')
    const listener = vi.fn()
    console.subscribe(listener)
    expect(console.handleKey(key('Enter', { isComposing: true }))).toBe(false)
    expect(
      console.handleKey(key('c', { ctrlKey: true, isComposing: true }))
    ).toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    expect(console.getState().input.value).toBe('a')
  })

  it('keys of absent features are left to the browser', () => {
    const { console } = setup()
    console.setInput('a')
    for (const name of ['ArrowUp', 'ArrowDown', 'Tab', 'Escape']) {
      expect(console.handleKey(key(name)), name).toBe(false)
    }
    expect(console.handleKey(key('Tab', { shiftKey: true }))).toBe(false)
    expect(console.handleKey(key('x'))).toBe(false)
    expect(console.getState().input.value).toBe('a')
  })

  it('while a command runs only Ctrl+C is handled', async () => {
    const pending = deferred<string>()
    const console = createConsole({
      commands: [command('wait', () => pending.promise)]
    })
    const done = console.run('wait')
    expect(console.handleKey(key('Enter'))).toBe(false)
    expect(console.handleKey(key('c', { ctrlKey: true }))).toBe(true)
    expect(outputs(console.getState().entries)[0].blocks).toEqual([
      { type: 'message', code: 'interrupted' }
    ])
    await done
  })
})
