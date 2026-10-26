// C-45 / C-46: the console renders exactly the hooks of `contract/dom.ts`,
// each on its element, no `style` attribute, and every hook of the contract
// shows up in some state.
import { afterEach, describe, expect, test } from 'vitest'
import { h } from 'vue'

import { settle } from '../../support/console-fixture'
import { createCollector, slotMarker } from '../../support/dom-collector'
import { mountConsole, unmountAll } from '../../support/mount-console'

afterEach(unmountAll)

// The completion list needs the completion feature.
// TODO(features): drop this once the feature is wired.
const unreachable = [
  'cc-completions',
  'cc-completion',
  'id',
  'aria-selected',
  'aria-controls',
  'aria-activedescendant'
]

describe('C-45 DOM contract', () => {
  test('the rendered DOM matches the contract in every state', async () => {
    const dom = createCollector()

    // Every block type, a redacted line, a cancelled line, a quiet entry, an
    // error, a running command.
    const view = mountConsole({
      model: { context: [{ id: 'a', prompt: 'a>' }] }
    })
    await view.api.run('blocks')
    await view.api.run('login admin hunter2')
    await view.api.run('quiet')
    await view.api.run('fail')
    view.api.console.setInput('echo half')
    view.api.cancel()
    void view.api.run('slow')
    await settle()
    dom.collect()
    view.slow.current!.resolve('done')
    await settle()
    dom.collect()
    view.unmount()

    // Slots: their content is the consumer's, the elements around it are
    // still the library's.
    const slotted = mountConsole({
      slots: {
        prompt: () => h('em', { [slotMarker]: '', style: 'color: red' }, '>'),
        'block-text': () =>
          h('b', { [slotMarker]: '', class: 'mine', 'data-x': '1' }, 'x'),
        busy: () => h('i', { [slotMarker]: '' }, 'wait')
      }
    })
    await slotted.api.run('echo a')
    void slotted.api.run('slow')
    await settle()
    dom.collect()

    dom.expectNothingOutsideContract()
    dom.expectNoStyle()
    dom.expectEntriesRendered(unreachable)
  })

  test('the input is a text combobox with its fixed attributes', async () => {
    const view = mountConsole()
    await settle()
    const input = view.input()
    expect(input.type).toBe('text')
    expect(input.getAttribute('role')).toBe('combobox')
    expect(input.getAttribute('aria-autocomplete')).toBe('list')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.hasAttribute('aria-controls')).toBe(false)
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
  })
})

describe('C-46 no styles', () => {
  test('no element has a style attribute, and nothing sets a size or overflow', async () => {
    const view = mountConsole()
    await view.api.run('many 50')
    await view.api.run('blocks')
    await settle()
    const dom = createCollector()
    dom.collect()
    dom.expectNoStyle()
    const log = view.log()
    // The log has no size of its own: without the consumer's CSS it grows
    // with its content and does not scroll.
    expect(getComputedStyle(log).overflowY).toBe('visible')
    expect(log.scrollHeight).toBe(log.clientHeight)
    expect(getComputedStyle(view.root).overflow).toBe('visible')
    expect(view.root.querySelectorAll('style, link')).toHaveLength(0)
  })
})
