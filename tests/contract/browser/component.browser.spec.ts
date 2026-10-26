// `<CommandConsole>` in a real browser: busy (C-44), accessibility (C-48),
// focus (C-51), input replacement (C-54), scroll (C-58), no form (C-69).
import axe from 'axe-core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { h } from 'vue'

import { settle } from '../../support/console-fixture'
import { mountConsole, unmountAll } from '../../support/mount-console'

afterEach(() => {
  unmountAll()
  document.head
    .querySelectorAll('style[data-test]')
    .forEach(style => style.remove())
  window.getSelection()?.removeAllRanges()
})

const frame = () =>
  new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

describe('C-44 busy', () => {
  test('C-44 while a run exists: data-busy, the busy label, a readonly input, no aria-busy', async () => {
    const view = mountConsole()
    expect(view.root.hasAttribute('data-busy')).toBe(false)
    expect(view.input().readOnly).toBe(false)
    void view.api.run('slow')
    await settle()
    expect(view.root.getAttribute('data-busy')).toBe('')
    expect(view.status().textContent).toBe('Running…')
    expect(view.input().readOnly).toBe(true)
    expect(view.log().hasAttribute('aria-busy')).toBe(false)
    view.slow.current!.resolve('done')
    await settle()
    expect(view.root.hasAttribute('data-busy')).toBe(false)
    expect(view.status().textContent).toBe('')
    expect(view.input().readOnly).toBe(false)
  })

  test('C-44 the busy slot and the busy label replace the default text', async () => {
    const view = mountConsole({ props: { labels: { busy: 'Wait' } } })
    void view.api.run('slow')
    await settle()
    expect(view.status().textContent).toBe('Wait')
    view.slow.current!.resolve('done')
    const slotted = mountConsole({ slots: { busy: () => h('b', 'working') } })
    void slotted.api.run('slow')
    await settle()
    expect(slotted.status().querySelector('b')?.textContent).toBe('working')
  })
})

describe('C-48 accessibility', () => {
  const violations = async (root: Element) => {
    const result = await axe.run(root)
    return result.violations.map(violation => violation.id)
  }

  test('C-48 axe finds no violation with output of every kind and the list closed', async () => {
    const view = mountConsole()
    await view.api.run('blocks')
    await view.api.run('quiet')
    await view.api.run('login admin secret')
    await view.api.run('fail')
    await settle()
    expect(await violations(view.root)).toEqual([])
    void view.api.run('slow')
    await settle()
    expect(await violations(view.root)).toEqual([])
  })

  test('C-48 a named log, a named and described combobox, valid references only', async () => {
    const view = mountConsole()
    await settle()
    const log = view.log()
    expect(log.getAttribute('role')).toBe('log')
    expect(log.getAttribute('aria-label')).toBe('Console output')
    const input = view.input()
    expect(input.getAttribute('role')).toBe('combobox')
    expect(input.getAttribute('aria-label')).toBe('Command')
    expect(input.getAttribute('aria-description')).not.toBe('')
    for (const name of ['aria-controls', 'aria-activedescendant']) {
      const id = input.getAttribute(name)
      if (id !== null) {
        expect(document.getElementById(id)).not.toBeNull()
      }
    }
    expect(input.hasAttribute('aria-controls')).toBe(false)
    expect(view.status().getAttribute('role')).toBe('status')
  })

  const openList = async (view: ReturnType<typeof mountConsole>) => {
    await userEvent.click(view.input())
    await userEvent.keyboard('e{Tab}')
    await settle()
  }

  test('C-48 axe finds no violation with the list open, with and without a selection', async () => {
    const view = mountConsole()
    await openList(view)
    expect(view.root.querySelector('[role="listbox"]')).not.toBeNull()
    expect(await violations(view.root)).toEqual([])
    await userEvent.keyboard('{Tab}')
    await settle()
    expect(await violations(view.root)).toEqual([])
  })

  test('C-48 aria-controls and aria-activedescendant point to the open list and its selected option', async () => {
    const view = mountConsole()
    await openList(view)
    const input = view.input()
    const list = view.root.querySelector('.cc-completions')!
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(list.id)
    expect(document.getElementById(list.id)).toBe(list)
    expect(list.getAttribute('aria-label')).toBe('Suggestions')
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
    expect(
      [...list.querySelectorAll('[role="option"]')].map(
        option => option.textContent
      )
    ).toEqual(['echo', 'exit'])

    await userEvent.keyboard('{Tab}')
    await settle()
    const active = input.getAttribute('aria-activedescendant')!
    expect(document.getElementById(active)?.textContent).toBe('echo')
    expect(document.getElementById(active)?.getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(input.value).toBe('echo')

    await userEvent.keyboard('{ArrowDown}')
    await settle()
    const next = input.getAttribute('aria-activedescendant')!
    expect(document.getElementById(next)?.textContent).toBe('exit')
    expect(input.value).toBe('exit')

    // Enter accepts the selection: the list closes, nothing is submitted.
    await userEvent.keyboard('{Enter}')
    await settle()
    expect(view.root.querySelector('.cc-completions')).toBeNull()
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.hasAttribute('aria-controls')).toBe(false)
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
    expect(input.value).toBe('exit ')
    expect(view.root.querySelectorAll('.cc-entry')).toHaveLength(0)
  })

  test('C-48 Escape restores the typed text; typing closes the list', async () => {
    const view = mountConsole()
    await openList(view)
    await userEvent.keyboard('{Tab}')
    await settle()
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(view.input().value).toBe('e')
    expect(view.root.querySelector('.cc-completions')).toBeNull()

    await userEvent.keyboard('{Tab}')
    await settle()
    expect(view.root.querySelector('.cc-completions')).not.toBeNull()
    await userEvent.keyboard('c')
    await settle()
    expect(view.root.querySelector('.cc-completions')).toBeNull()
    expect(view.input().value).toBe('ec')
  })

  test('C-48 the completion slot renders inside the option', async () => {
    const view = mountConsole({
      slots: {
        completion: (props: { candidate: string; active: boolean }) =>
          h('b', `${props.candidate}${props.active ? '*' : ''}`)
      }
    })
    await openList(view)
    await userEvent.keyboard('{Tab}')
    await settle()
    const options = [...view.root.querySelectorAll('.cc-completion')]
    expect(options.map(option => option.innerHTML)).toEqual([
      '<b>echo*</b>',
      '<b>exit</b>'
    ])
  })

  test('C-48 a recalled line is written to the status element', async () => {
    const view = mountConsole({
      props: { initialState: { recall: ['echo one', 'echo two'] } }
    })
    await userEvent.click(view.input())
    await userEvent.keyboard('{ArrowUp}')
    await settle()
    expect(view.input().value).toBe('echo two')
    expect(view.status().textContent).toBe('echo two')
    await userEvent.keyboard('{ArrowUp}')
    await settle()
    expect(view.input().value).toBe('echo one')
    expect(view.status().textContent).toBe('echo one')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await settle()
    expect(view.input().value).toBe('')
    expect(view.status().textContent).toBe('')
  })

  test('C-48 quiet entries are aria-live off, others inherit the log', async () => {
    const view = mountConsole()
    await view.api.run('quiet')
    await view.api.run('echo loud')
    await settle()
    const outputs = [
      ...view.root.querySelectorAll('.cc-entry[data-kind="output"]')
    ]
    expect(outputs.map(entry => entry.getAttribute('aria-live'))).toEqual([
      'off',
      null
    ])
  })
})

describe('C-51 focus', () => {
  test('C-51 autofocus focuses the input on mount, and only with the prop', async () => {
    const plain = mountConsole()
    await settle()
    expect(document.activeElement).not.toBe(plain.input())
    const focused = mountConsole({ props: { autofocus: true } })
    await settle()
    expect(document.activeElement).toBe(focused.input())
  })

  test('C-51 a click in the log focuses the input', async () => {
    const view = mountConsole()
    await view.api.run('echo some output')
    await settle()
    await userEvent.click(view.root.querySelector('.cc-block')!)
    expect(document.activeElement).toBe(view.input())
  })

  test('C-51 a click with text selected or on something interactive does not', async () => {
    const view = mountConsole({
      slots: {
        'block-text': () => h('button', { type: 'button' }, 'act')
      }
    })
    await view.api.run('echo some')
    await view.api.run('blocks')
    await settle()
    const button = view.root.querySelector('button')!
    await userEvent.click(button)
    expect(document.activeElement).toBe(button)

    button.blur()
    const pre = view.root.querySelector('.cc-block[data-type="json"]')!
    const range = document.createRange()
    range.selectNodeContents(pre)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    pre.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.activeElement).not.toBe(view.input())
    expect(window.getSelection()!.toString()).not.toBe('')
  })
})

describe('C-54 input replaced', () => {
  test('C-54 after a sensitive line: a new, empty element, focused because the old one was', async () => {
    const view = mountConsole()
    const old = view.input()
    await userEvent.click(old)
    await userEvent.keyboard('login admin hunter2')
    await userEvent.keyboard('{Enter}')
    await settle()
    const next = view.input()
    expect(next).not.toBe(old)
    expect(old.isConnected).toBe(false)
    expect(next.value).toBe('')
    expect(document.activeElement).toBe(next)
    // A native undo in the new element brings nothing back.
    document.execCommand('undo')
    await settle()
    expect(view.input().value).toBe('')
    expect(view.api.state.input.value).toBe('')
  })

  test('C-54 replaced without focus when the old one had none', async () => {
    const view = mountConsole()
    const old = view.input()
    view.api.console.setInput('login admin hunter2')
    await settle()
    await view.api.run('login admin hunter2')
    view.api.console.setInput('echo x')
    await settle()
    view.api.reset()
    await settle()
    expect(view.input()).not.toBe(old)
    expect(document.activeElement).not.toBe(view.input())
  })

  test('C-54 reset and a programmatic clear replace a non-empty input', async () => {
    const view = mountConsole()
    view.api.focus()
    await userEvent.keyboard('echo typed')
    const typed = view.input()
    view.api.reset()
    await settle()
    expect(view.input()).not.toBe(typed)
    expect(view.input().value).toBe('')
    expect(document.activeElement).toBe(view.input())

    await userEvent.keyboard('echo again')
    const again = view.input()
    view.api.console.setInput('')
    await settle()
    expect(view.input()).not.toBe(again)
    expect(view.input().value).toBe('')
    document.execCommand('undo')
    await settle()
    expect(view.input().value).toBe('')
  })

  test('C-54 a normal submit and a user backspace keep the element', async () => {
    const view = mountConsole()
    const input = view.input()
    await userEvent.click(input)
    await userEvent.keyboard('echo a')
    await userEvent.keyboard('{Enter}')
    await settle()
    expect(view.input()).toBe(input)
    expect(input.value).toBe('')
    await userEvent.keyboard('ab{Backspace}{Backspace}')
    await settle()
    expect(view.input()).toBe(input)
    expect(input.value).toBe('')
  })

  test('C-54 a programmatic write shows its value and caret', async () => {
    const view = mountConsole()
    view.api.focus()
    view.api.console.setInput('echo written')
    await settle()
    expect(view.input().value).toBe('echo written')
    expect(view.input().selectionStart).toBe('echo written'.length)
    expect(view.input().hasAttribute('value')).toBe(false)
  })
})

describe('C-58 scroll', () => {
  const sized = () => {
    const style = document.createElement('style')
    style.setAttribute('data-test', '')
    style.textContent = '.cc-log { height: 120px; overflow-y: auto; }'
    document.head.append(style)
  }

  const atBottom = (log: HTMLElement) =>
    log.scrollHeight - log.scrollTop - log.clientHeight <= 2

  test('C-58 the log follows new output while it is at the bottom', async () => {
    sized()
    const view = mountConsole()
    await view.api.run('many 40')
    await settle()
    await frame()
    await frame()
    const log = view.log()
    expect(log.scrollHeight).toBeGreaterThan(log.clientHeight)
    expect(atBottom(log)).toBe(true)
    view.api.console.run('many 5').catch(() => undefined)
    await settle()
    await frame()
    await frame()
    expect(atBottom(log)).toBe(true)
  })

  test('C-58 a log scrolled up stays put; the user submit brings it back', async () => {
    sized()
    const view = mountConsole()
    await view.api.run('many 40')
    await settle()
    await frame()
    const log = view.log()
    log.scrollTop = 10
    log.dispatchEvent(new Event('scroll'))
    await view.api.console.run('many 5')
    await settle()
    await frame()
    await frame()
    expect(log.scrollTop).toBe(10)

    await userEvent.click(view.input())
    await userEvent.keyboard('many 3')
    await userEvent.keyboard('{Enter}')
    await settle()
    await frame()
    await frame()
    expect(atBottom(log)).toBe(true)
  })

  test('C-58 scrollTop is the only style-related write', async () => {
    sized()
    const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute')
    const view = mountConsole()
    await view.api.run('many 40')
    await view.api.run('blocks')
    await settle()
    await frame()
    expect(setProperty).not.toHaveBeenCalled()
    expect(
      setAttribute.mock.calls.filter(([name]) => name === 'style')
    ).toEqual([])
    expect(view.log().scrollTop).toBeGreaterThan(0)
    setProperty.mockRestore()
    setAttribute.mockRestore()
  })

  test('C-58 the observer is disconnected on unmount, and a late callback does nothing', async () => {
    sized()
    let callback: ResizeObserverCallback | null = null
    const Original = window.ResizeObserver
    const disconnect = vi.fn()
    window.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        callback = cb
      }
      observe() {}
      unobserve() {}
      disconnect = disconnect
    }
    try {
      const view = mountConsole()
      await view.api.run('many 40')
      await settle()
      const log = view.log()
      view.unmount()
      expect(disconnect).toHaveBeenCalled()
      const scrollTop = vi.spyOn(log, 'scrollTop', 'set')
      callback!([], {} as ResizeObserver)
      expect(scrollTop).not.toHaveBeenCalled()
    } finally {
      window.ResizeObserver = Original
    }
  })
})

describe('C-69 no form, no name', () => {
  test('C-69 the input is outside any form, unnamed, with typing aids off', async () => {
    const view = mountConsole()
    await settle()
    const input = view.input()
    expect(input.form).toBeNull()
    expect(view.root.querySelector('form')).toBeNull()
    expect(input.hasAttribute('name')).toBe(false)
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('autocorrect')).toBe('off')
    expect(input.getAttribute('autocapitalize')).toBe('off')
    expect(input.getAttribute('spellcheck')).toBe('false')
  })
})
