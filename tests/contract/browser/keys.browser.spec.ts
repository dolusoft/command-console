// Keys through real key events (Playwright): C-52 keys scoped to the input,
// C-59 the keyboard can always leave the console.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import { settle } from '../../support/console-fixture'
import { mountConsole, unmountAll } from '../../support/mount-console'

afterEach(() => {
  unmountAll()
  window.getSelection()?.removeAllRanges()
})

/** Records whether each keydown reached the window prevented. */
const watchKeydowns = () => {
  const seen: { key: string; prevented: boolean }[] = []
  const listener = (event: KeyboardEvent) => {
    seen.push({ key: event.key, prevented: event.defaultPrevented })
  }
  window.addEventListener('keydown', listener)
  return {
    seen,
    stop: () => window.removeEventListener('keydown', listener)
  }
}

const kinds = (root: Element) =>
  [...root.querySelectorAll('.cc-entry')].map(
    entry =>
      `${entry.getAttribute('data-kind')}:${entry.getAttribute('data-status') ?? entry.getAttribute('data-tone')}`
  )

describe('C-52 keys scoped to the input', () => {
  test('Enter on the input submits; Enter elsewhere does nothing', async () => {
    const view = mountConsole()
    const outside = document.createElement('button')
    outside.textContent = 'outside'
    document.body.append(outside)

    await userEvent.click(view.input())
    await userEvent.keyboard('echo hi')
    await userEvent.keyboard('{Enter}')
    await settle()
    expect(kinds(view.root)).toEqual(['input:submitted', 'output:default'])

    view.api.console.setInput('echo again')
    outside.focus()
    await userEvent.keyboard('{Enter}')
    await settle()
    expect(kinds(view.root)).toHaveLength(2)
  })

  test('every listener is on the console elements, none remains after unmount', async () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener')
    const disconnect = vi.spyOn(ResizeObserver.prototype, 'disconnect')
    const view = mountConsole()
    await view.api.run('echo a')
    await settle()
    const targets = add.mock.contexts as EventTarget[]
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      expect(target).toBeInstanceOf(Element)
      expect(view.root.contains(target as Element)).toBe(true)
    }
    const root = view.root
    view.unmount()
    add.mockRestore()
    // The elements that carried listeners left the document with the
    // console; the observer is disconnected.
    expect(root.isConnected).toBe(false)
    expect(disconnect).toHaveBeenCalled()
    disconnect.mockRestore()
    const keys = watchKeydowns()
    await userEvent.keyboard('{Enter}')
    expect(keys.seen.every(key => !key.prevented)).toBe(true)
    keys.stop()
  })

  test('Ctrl+C with a selection in the input is not prevented and cancels nothing', async () => {
    const view = mountConsole()
    await userEvent.click(view.input())
    await userEvent.keyboard('echo copy me')
    view.input().setSelectionRange(5, 9)
    const keys = watchKeydowns()
    await userEvent.keyboard('{Control>}c{/Control}')
    keys.stop()
    await settle()
    expect(keys.seen.find(key => key.key === 'c')?.prevented).toBe(false)
    expect(kinds(view.root)).toEqual([])
    expect(view.input().value).toBe('echo copy me')
  })

  test('Ctrl+C with text selected in the log is not prevented', async () => {
    const view = mountConsole()
    await view.api.run('echo some output')
    await settle()
    view.api.console.setInput('echo pending')
    view.api.focus()
    await settle()
    // Selected after the focus, which would otherwise move the selection
    // into the input; the input keeps focus.
    const range = document.createRange()
    range.selectNodeContents(view.root.querySelector('.cc-block')!)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    const keys = watchKeydowns()
    await userEvent.keyboard('{Control>}c{/Control}')
    keys.stop()
    await settle()
    expect(keys.seen.find(key => key.key === 'c')?.prevented).toBe(false)
    expect(kinds(view.root)).toEqual(['input:submitted', 'output:default'])
  })

  test('Ctrl+C without a selection cancels the line and is prevented', async () => {
    const view = mountConsole()
    await userEvent.click(view.input())
    await userEvent.keyboard('echo half')
    const keys = watchKeydowns()
    await userEvent.keyboard('{Control>}c{/Control}')
    keys.stop()
    await settle()
    expect(keys.seen.find(key => key.key === 'c')?.prevented).toBe(true)
    expect(kinds(view.root)).toEqual(['input:cancelled'])
    expect(view.root.querySelector('.cc-cancelled')?.textContent).toBe('^C')
  })

  test('Ctrl+Shift+C and Cmd+C are not taken over', async () => {
    const view = mountConsole()
    await userEvent.click(view.input())
    await userEvent.keyboard('echo x')
    const keys = watchKeydowns()
    await userEvent.keyboard('{Control>}{Shift>}C{/Shift}{/Control}')
    await userEvent.keyboard('{Meta>}c{/Meta}')
    keys.stop()
    await settle()
    expect(keys.seen.filter(key => key.prevented)).toEqual([])
    expect(kinds(view.root)).toEqual([])
  })
})

describe('C-59 focus exit', () => {
  const surround = () => {
    const before = document.createElement('button')
    before.textContent = 'before'
    const after = document.createElement('button')
    after.textContent = 'after'
    document.body.prepend(before)
    document.body.append(after)
    return { before, after }
  }

  test('Tab on an empty input moves focus on, and is not prevented', async () => {
    const view = mountConsole()
    const { after } = surround()
    view.api.focus()
    const keys = watchKeydowns()
    await userEvent.keyboard('{Tab}')
    keys.stop()
    expect(keys.seen[0].prevented).toBe(false)
    expect(document.activeElement).toBe(after)
  })

  test('Shift+Tab without a session moves focus back', async () => {
    const view = mountConsole()
    const { before } = surround()
    await userEvent.click(view.input())
    await userEvent.keyboard('echo a')
    const keys = watchKeydowns()
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    keys.stop()
    expect(keys.seen.find(key => key.key === 'Tab')?.prevented).toBe(false)
    expect(document.activeElement).toBe(before)
  })
})
