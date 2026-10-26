// The component's DOM handlers in happy-dom: the browser specs prove the
// behavior with real keys, focus and layout; these drive the same handlers
// through synthetic events, so the unit run covers them too.
import { afterEach, describe, expect, it } from 'vitest'
import { h, nextTick } from 'vue'

import { clickFocusesInput } from '../../../packages/command-console/src/dom/focus'
import { selectionOf } from '../../../packages/command-console/src/dom/selection'
import {
  messageText,
  resolveLabels
} from '../../../packages/command-console/src/labels'
import { settle } from '../../support/console-fixture'
import { mountConsole, unmountAll } from '../../support/mount-console'

afterEach(() => {
  unmountAll()
  document.getSelection()?.removeAllRanges()
})

const key = (init: KeyboardEventInit) =>
  new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })

/** Types `value` into the input as a DOM `input` event would report it. */
const type = (input: HTMLInputElement, value: string) => {
  input.value = value
  input.setSelectionRange(value.length, value.length)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('C-52 keys on the input (synthetic)', () => {
  it('C-52 Enter submits what was typed and is prevented', async () => {
    const view = mountConsole()
    type(view.input(), 'echo hi')
    const enter = key({ key: 'Enter' })
    view.input().dispatchEvent(enter)
    await settle()
    expect(enter.defaultPrevented).toBe(true)
    expect(view.api.state.entries.map(entry => entry.kind)).toEqual([
      'input',
      'output'
    ])
    expect(view.emitted('submit')).toHaveLength(1)
  })

  it('C-52 a key during composition is left to the browser', async () => {
    const view = mountConsole()
    type(view.input(), 'echo hi')
    const enter = key({ key: 'Enter', isComposing: true })
    view.input().dispatchEvent(enter)
    const ime = key({ key: 'Process', keyCode: 229 })
    view.input().dispatchEvent(ime)
    await settle()
    expect(enter.defaultPrevented).toBe(false)
    expect(ime.defaultPrevented).toBe(false)
    expect(view.api.state.entries).toEqual([])
  })

  it('C-52 a caret move reaches the console; an unchanged one does not', () => {
    const view = mountConsole()
    const input = view.input()
    type(input, 'echo abc')
    input.setSelectionRange(2, 2)
    input.dispatchEvent(new Event('keyup'))
    expect(view.api.state.input.caret).toBe(2)
    const before = view.api.console.getState()
    input.dispatchEvent(new Event('click'))
    expect(view.api.console.getState()).toBe(before)
    // A value the console has not seen yet is the `input` event's to report.
    input.value = 'echo abcd'
    input.dispatchEvent(new Event('keyup'))
    expect(view.api.state.input.value).toBe('echo abc')
  })

  it('C-52 Ctrl+C with the input text selected is not prevented', async () => {
    const view = mountConsole()
    const input = view.input()
    type(input, 'echo abc')
    input.setSelectionRange(0, 4)
    const copy = key({ key: 'c', ctrlKey: true })
    input.dispatchEvent(copy)
    await settle()
    expect(copy.defaultPrevented).toBe(false)
    expect(view.api.state.entries).toEqual([])
  })
})

describe('C-48 completion and recall (synthetic)', () => {
  it('C-48 Tab opens the list; the selection drives aria-activedescendant', async () => {
    const view = mountConsole({
      slots: {
        completion: (props: { candidate: string }) => h('b', props.candidate)
      }
    })
    const input = view.input()
    input.focus()
    type(input, 'e')
    input.dispatchEvent(key({ key: 'Tab' }))
    await nextTick()
    const list = view.root.querySelector('.cc-completions')!
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(list.id)
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
    input.dispatchEvent(key({ key: 'Tab' }))
    await nextTick()
    const active = input.getAttribute('aria-activedescendant')!
    expect(view.root.querySelector(`[id="${active}"]`)?.textContent).toBe(
      'echo'
    )
    expect(input.value).toBe('echo')
    expect(input.selectionStart).toBe(4)
    input.dispatchEvent(key({ key: 'Escape' }))
    await nextTick()
    expect(view.root.querySelector('.cc-completions')).toBeNull()
    expect(input.value).toBe('e')
  })

  it('C-48 a recalled line is in the status element while browsing', async () => {
    const view = mountConsole({ model: { recall: ['echo one'] } })
    const input = view.input()
    input.focus()
    input.dispatchEvent(key({ key: 'ArrowUp' }))
    await nextTick()
    expect(input.value).toBe('echo one')
    expect(view.status().textContent).toBe('echo one')
    input.dispatchEvent(key({ key: 'ArrowDown' }))
    await nextTick()
    expect(view.status().textContent).toBe('')
  })
})

describe('C-51 focus (synthetic)', () => {
  it('C-51 autofocus focuses the input on mount', () => {
    const view = mountConsole({ props: { autofocus: true } })
    expect(document.activeElement).toBe(view.input())
  })

  it('C-51 a click anywhere in the console focuses the input, not on a button or with a selection', async () => {
    const view = mountConsole({
      slots: { 'block-text': () => h('button', { type: 'button' }, 'act') }
    })
    await view.api.run('echo a')
    await view.api.run('blocks')
    await settle()
    const root = view.root
    for (const target of [
      view.log(),
      view.status(),
      root.querySelector('.cc-input-line')!,
      root.querySelector('.cc-input-line .cc-prompt')!,
      root
    ]) {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(document.activeElement).toBe(view.input())
      view.input().blur()
    }
    // The completion list too.
    type(view.input(), 'e')
    view.input().dispatchEvent(key({ key: 'Tab' }))
    await nextTick()
    view.input().blur()
    root
      .querySelector('.cc-completions [role="option"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.activeElement).toBe(view.input())
    view.input().dispatchEvent(key({ key: 'Escape' }))
    await nextTick()

    const button = root.querySelector('button')!
    expect(clickFocusesInput(button, root)).toBe(false)
    expect(clickFocusesInput(button.firstChild, root)).toBe(false)
    // The input's own click is the browser's.
    expect(clickFocusesInput(view.input(), root)).toBe(false)
    expect(clickFocusesInput(null, root)).toBe(true)
    // An interactive element around the console does not count.
    const outer = document.createElement('a')
    outer.append(root)
    document.body.append(outer)
    expect(clickFocusesInput(root, root)).toBe(true)

    const range = document.createRange()
    range.selectNodeContents(root.querySelector('.cc-block[data-type="json"]')!)
    document.getSelection()!.addRange(range)
    expect(clickFocusesInput(root, root)).toBe(false)
    expect(selectionOf(view.input(), view.root)).toBe('document')
    expect(selectionOf(view.input(), null)).toBe('none')
    document.getSelection()!.removeAllRanges()
    expect(selectionOf(view.input(), view.root)).toBe('none')
  })
})

describe('C-58 scroll (synthetic)', () => {
  it('C-58 a scroll event away from the bottom unsticks, and a submit sticks again', async () => {
    const view = mountConsole()
    const log = view.log()
    log.dispatchEvent(new Event('scroll'))
    await view.api.run('echo a')
    await nextTick()
    view.unmount()
    log.dispatchEvent(new Event('scroll'))
    expect(log.scrollTop).toBe(0)
  })
})

describe('C-47 labels (helpers)', () => {
  it('C-47 command-not-found without a name, and a message without params', () => {
    const labels = resolveLabels()
    expect(
      messageText(labels, {
        type: 'message',
        code: 'command-not-found',
        params: { name: null }
      })
    ).toBe('command not found')
    const custom = resolveLabels({
      messages: { 'command-not-found': params => `nope ${String(params.name)}` }
    })
    expect(
      messageText(custom, {
        type: 'message',
        code: 'command-not-found'
      } as never)
    ).toBe('nope undefined')
  })
})
