// The component's props, events, slots, labels and expose (happy-dom). The
// keyboard, focus, scroll and accessibility rules are in the browser specs.
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

import {
  CommandConsole,
  type ConsoleEntry,
  type ConsoleExpose,
  type ContextFrame,
  type InputEntry
} from '@dolusoft/command-console'
import {
  completionFeature,
  consoleFeatures,
  contextFeature,
  createConsole,
  recallFeature
} from '@dolusoft/command-console-core'

import { makeCommands, settle } from '../../support/console-fixture'
import { mountConsole, unmountAll } from '../../support/mount-console'

afterEach(unmountAll)

const texts = (root: Element, selector: string) =>
  [...root.querySelectorAll(selector)].map(element => element.textContent)

describe('C-64 submit event', () => {
  it('carries only the input id and the sensitivity', async () => {
    const view = mountConsole()
    await view.api.run('echo hello')
    await view.api.run('login admin hunter2')
    await settle()
    const events = view.emitted('submit').map(args => args[0])
    const entries = view.api.console.getState().entries
    const inputs = entries.filter(entry => entry.kind === 'input')
    expect(events).toEqual([
      { inputId: inputs[0].id, sensitive: false },
      { inputId: inputs[1].id, sensitive: true }
    ])
    for (const event of events) {
      expect(Object.keys(event as object).sort()).toEqual([
        'inputId',
        'sensitive'
      ])
    }
  })

  it('is emitted for Enter on the input, not for a cancelled line', async () => {
    const view = mountConsole()
    const input = view.input()
    input.value = 'echo a'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await settle()
    expect(view.emitted('submit')).toHaveLength(1)
    view.input().value = 'echo b'
    view.input().dispatchEvent(new Event('input'))
    view
      .input()
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))
    await settle()
    expect(view.emitted('submit')).toHaveLength(1)
  })
})

describe('C-25 close event', () => {
  it('the close effect emits close', async () => {
    const view = mountConsole()
    await view.api.run('exit')
    expect(view.emitted('close')).toEqual([[]])
  })
})

describe('C-47 labels', () => {
  it('renders every text from the English defaults', async () => {
    const view = mountConsole()
    await view.api.run('nope')
    await view.api.run('login x')
    await view.api.run('echo "open')
    await settle()
    const input = view.input()
    expect(input.getAttribute('aria-label')).toBe('Command')
    expect(input.getAttribute('aria-description')).toBe(
      'Enter runs the command. Tab completes; on an empty line it leaves the console.'
    )
    expect(view.log().getAttribute('aria-label')).toBe('Console output')
    expect(texts(view.root, '.cc-block[data-type="message"]')).toEqual([
      'nope: command not found',
      'Unterminated quote.'
    ])
    expect(texts(view.root, '[data-redacted] .cc-line')).toEqual([
      '(input hidden)'
    ])
  })

  it('a partial labels.messages keeps the other defaults', async () => {
    const view = mountConsole({
      props: {
        labels: {
          log: 'Ausgabe',
          redacted: '(verborgen)',
          cancelledMarker: 'abgebrochen',
          messages: { interrupted: 'Unterbrochen.' }
        }
      }
    })
    void view.api.run('slow')
    view.api.cancel()
    await view.api.run('nope')
    view.api.console.setInput('echo x')
    view.api.cancel()
    await settle()
    expect(view.log().getAttribute('aria-label')).toBe('Ausgabe')
    expect(texts(view.root, '.cc-block[data-type="message"]')).toEqual([
      'Unterbrochen.',
      'nope: command not found'
    ])
    expect(texts(view.root, '[data-redacted] .cc-line')).toEqual([
      '(verborgen)'
    ])
    expect(texts(view.root, '.cc-cancelled')).toEqual(['abgebrochen'])
    // The input keeps its default name.
    expect(view.input().getAttribute('aria-label')).toBe('Command')
  })

  it('a message label may be a function of the parameters', async () => {
    const view = mountConsole({
      props: {
        labels: {
          messages: {
            'command-not-found': params => `unknown: ${params.name ?? '?'}`,
            'unterminated-quote': params => `quote at ${params.index ?? '?'}`
          }
        }
      }
    })
    await view.api.run('nope')
    await view.api.run('echo "x')
    await view.api.run('Login secret')
    await settle()
    expect(texts(view.root, '.cc-block[data-type="message"]')).toEqual([
      'unknown: nope',
      'quote at 5',
      'unknown: ?'
    ])
  })
})

describe('C-67 slots', () => {
  it('a block slot replaces only its own block type', async () => {
    const view = mountConsole({
      slots: {
        'block-json': (props: { block: { value: unknown } }) =>
          h(
            'b',
            { 'data-test-slot': '' },
            `json:${JSON.stringify(props.block.value)}`
          )
      }
    })
    await view.api.run('blocks')
    await settle()
    const blocks = [...view.root.querySelectorAll('.cc-block')]
    expect(blocks.map(block => block.getAttribute('data-type'))).toEqual([
      'text',
      'json',
      'table',
      'list',
      'message',
      'custom'
    ])
    const json = blocks[1]
    expect(json.classList.contains('cc-block')).toBe(true)
    expect(json.querySelector('b')?.textContent).toBe(
      'json:{"a":1,"b":[true,null]}'
    )
    expect(blocks[0].tagName).toBe('PRE')
    expect(blocks[2].tagName).toBe('TABLE')
    expect(blocks[3].tagName).toBe('UL')
    expect(blocks[5].tagName).toBe('PRE')
    expect(blocks[5].textContent).toContain('"kind": "chart"')
  })

  it('prompt and busy render inside their library elements', async () => {
    const view = mountConsole({
      props: { prompt: '$' },
      slots: {
        prompt: (props: { prompt: string }) =>
          h('i', { 'data-test-slot': '' }, `[${props.prompt}]`),
        busy: (props: { running: { command: string } }) =>
          h('i', { 'data-test-slot': '' }, `busy ${props.running.command}`)
      }
    })
    await view.api.run('echo a')
    void view.api.run('slow')
    await settle()
    const prompts = [...view.root.querySelectorAll('.cc-prompt')]
    expect(prompts.map(prompt => prompt.textContent)).toEqual([
      '[$]',
      '[$]',
      '[$]'
    ])
    expect(prompts.every(prompt => prompt.tagName === 'SPAN')).toBe(true)
    expect(view.status().getAttribute('role')).toBe('status')
    expect(view.status().textContent).toBe('busy slow')
    view.slow.current!.resolve(undefined)
    await settle()
    expect(view.status().textContent).toBe('')
  })
})

describe('C-61 same-tick updates through v-model', () => {
  it('two actions in one tick build on the last emitted value', async () => {
    const view = mountConsole({ model: { entries: [] } })
    // Two actions before the parent re-renders: the second one's updater
    // resolves against the first one's emitted value.
    view.api.console.setInput('echo one')
    void view.api.console.submit()
    view.api.console.setInput('echo two')
    void view.api.console.submit()
    const emitted = view.emitted('update:entries')
    const last = emitted.at(-1)![0] as ConsoleEntry[]
    expect(
      last.map(entry => (entry.kind === 'input' ? entry.text : 'out'))
    ).toEqual(['echo one', 'out', 'echo two', 'out'])
    await settle()
    await nextTick()
    expect((view.wrapper.props() as { entries: unknown }).entries).toEqual(last)
    expect(view.root.querySelectorAll('.cc-entry')).toHaveLength(4)
  })

  it('a value the parent passes back wins', async () => {
    const view = mountConsole({ model: { entries: [] } })
    await view.api.run('echo one')
    await settle()
    await view.wrapper.setProps({ entries: [] })
    await view.api.run('echo two')
    await settle()
    const last = view.emitted('update:entries').at(-1)![0] as ConsoleEntry[]
    expect(last).toHaveLength(2)
  })

  it('an unbound slice is the console own', async () => {
    const view = mountConsole()
    await view.api.run('echo one')
    expect(view.emitted('update:entries')).toEqual([])
    expect(view.root.querySelectorAll('.cc-entry')).toHaveLength(2)
  })
})

describe('C-66 context depth', () => {
  it('data-context-depth follows the number of frames', async () => {
    const frames: ContextFrame[] = [
      { id: 'a', prompt: 'a>' },
      { id: 'b', prompt: 'b>' }
    ]
    const view = mountConsole({ model: { context: [] } })
    expect(view.root.getAttribute('data-context-depth')).toBe('0')
    await view.wrapper.setProps({ context: frames })
    expect(view.root.getAttribute('data-context-depth')).toBe('2')
    await view.wrapper.setProps({ context: frames.slice(0, 1) })
    expect(view.root.getAttribute('data-context-depth')).toBe('1')
  })

  it('follows frames a command pushes and pops, and the prompt follows the top frame', async () => {
    const { commands } = makeCommands()
    const view = mountConsole({
      props: { prompt: '$' },
      commands: [
        ...commands,
        {
          name: 'enter',
          run: request => ({
            effects: [
              {
                type: 'push-context',
                frame: { id: request.args[0], prompt: `${request.args[0]}>` }
              }
            ]
          })
        },
        { name: 'leave', run: () => ({ effects: [{ type: 'pop-context' }] }) }
      ]
    })
    const depth = () => view.root.getAttribute('data-context-depth')
    const prompt = () =>
      view.root.querySelector('.cc-input-line .cc-prompt')?.textContent
    expect([depth(), prompt()]).toEqual(['0', '$'])
    await view.api.run('enter db')
    await nextTick()
    expect([depth(), prompt()]).toEqual(['1', 'db>'])
    await view.api.run('enter users')
    await nextTick()
    expect([depth(), prompt()]).toEqual(['2', 'users>'])
    await view.api.run('leave')
    await nextTick()
    expect([depth(), prompt()]).toEqual(['1', 'db>'])
    // The input entry keeps the prompt it was typed at.
    expect(texts(view.root, '.cc-entry[data-kind="input"] .cc-prompt')).toEqual(
      ['$', 'db>', 'users>']
    )
  })
})

describe('C-85 actor', () => {
  const line = (id: string, actor?: InputEntry['actor']): InputEntry => ({
    id,
    kind: 'input',
    prompt: '>',
    text: `echo ${id}`,
    redacted: false,
    status: 'submitted',
    ...(actor ? { actor } : {})
  })
  const lines = [
    line('a'),
    line('b', 'user'),
    line('c', 'assistant'),
    line('d', 'external-agent')
  ]
  const inputs = (root: Element) => [
    ...root.querySelectorAll('.cc-entry[data-kind="input"]')
  ]

  it('an assistant or external-agent line shows its label before the prompt', () => {
    const view = mountConsole({ model: { entries: lines } })
    expect(
      inputs(view.root).map(entry => entry.getAttribute('data-actor'))
    ).toEqual([null, null, 'assistant', 'external-agent'])
    expect(inputs(view.root).map(entry => entry.textContent)).toEqual([
      '>echo a',
      '>echo b',
      'AI>echo c',
      'Agent>echo d'
    ])
    for (const entry of inputs(view.root).slice(2)) {
      expect(entry.firstElementChild?.className).toBe('cc-actor')
      expect(entry.firstElementChild?.tagName).toBe('SPAN')
    }
    expect(view.root.querySelectorAll('.cc-actor')).toHaveLength(2)
  })

  it('a partial labels.actors keeps the other default', () => {
    const view = mountConsole({
      model: { entries: lines },
      props: { labels: { actors: { assistant: 'Asistan' } } }
    })
    expect(texts(view.root, '.cc-actor')).toEqual(['Asistan', 'Agent'])
  })
})

describe('C-84 external console (component)', () => {
  const external = () =>
    createConsole({
      features: consoleFeatures({
        recallFeature,
        completionFeature,
        contextFeature
      }),
      commands: makeCommands().commands
    })
  const mountOn = (props: Record<string, unknown>) =>
    mount(CommandConsole as never, {
      props: props as never,
      attachTo: document.body
    })

  it('a remount on the same console keeps its entries and live input, and never disposes it', async () => {
    const owned = external()
    const dispose = vi.spyOn(owned, 'dispose')
    const setOptions = vi.spyOn(owned, 'setOptions')
    const first = mountOn({
      console: owned,
      labels: { log: 'Output' },
      onSubmit: () => undefined
    })
    const api = first.vm as unknown as ConsoleExpose
    expect(api.console.getState()).toBe(owned.getState())
    await api.run('echo a')
    owned.setInput('echo half')
    await settle()
    expect(first.emitted('submit')).toHaveLength(1)
    const firstRoot = first.element as Element
    expect(firstRoot.querySelector('.cc-log')?.getAttribute('aria-label')).toBe(
      'Output'
    )
    first.unmount()
    expect(dispose).not.toHaveBeenCalled()

    // The console lives on while no component shows it.
    await owned.run('echo b')
    owned.setInput('echo half')
    const second = mountOn({ console: owned })
    await settle()
    const root = second.element as Element
    expect(texts(root, '.cc-entry[data-kind="input"] .cc-line')).toEqual([
      'echo a',
      'echo b'
    ])
    expect(root.querySelector<HTMLInputElement>('.cc-input')?.value).toBe(
      'echo half'
    )
    second.unmount()
    expect(dispose).not.toHaveBeenCalled()
    expect(setOptions).not.toHaveBeenCalled()
    owned.dispose()
  })

  it('console with a console-option prop or a controlled slice throws a TypeError', () => {
    const owned = external()
    const warn = vi
      .spyOn(globalThis.console, 'warn')
      .mockImplementation(() => undefined)
    expect(() =>
      mountOn({ console: owned, commands: makeCommands().commands })
    ).toThrow(TypeError)
    expect(() => mountOn({ console: owned, prompt: '$' })).toThrow(/prompt/)
    expect(() => mountOn({ console: owned, entries: [] })).toThrow(/entries/)
    expect(() => mountOn({})).toThrow(TypeError)
    warn.mockRestore()
    owned.dispose()
  })
})

describe('expose (README: The component)', () => {
  it('a template ref reaches focus, run, cancel, reset, clear, console and state', async () => {
    const { commands } = makeCommands()
    const consoleRef = ref<ConsoleExpose | null>(null)
    const parent = defineComponent({
      setup: () => () => h(CommandConsole, { ref: consoleRef, commands })
    })
    const wrapper = mount(parent, { attachTo: document.body })
    const api = consoleRef.value!
    expect(Object.keys(api).sort()).toEqual(
      ['cancel', 'clear', 'console', 'focus', 'reset', 'run', 'state'].sort()
    )
    await api.run('echo a')
    expect(api.state.entries).toHaveLength(2)
    api.clear()
    expect(api.state.entries).toEqual([])
    void api.run('slow')
    expect(api.state.running?.command).toBe('slow')
    api.cancel()
    expect(api.state.running).toBeNull()
    api.console.setInput('echo b')
    api.reset()
    expect(api.state.entries).toEqual([])
    expect(api.state.input.value).toBe('')
    api.focus()
    expect(document.activeElement).toBe(
      (wrapper.element as Element).querySelector('.cc-input')
    )
    wrapper.unmount()
  })
})
