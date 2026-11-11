import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import {
  completionFeature,
  consoleFeatures,
  contextFeature,
  createConsole,
  recallFeature,
  type ConsoleGate,
  type RemoteBinding
} from '@dolusoft/command-console-core'
import type { CliReply, InputEntry } from '@dolusoft/command-protocol'

import { mountConsole, unmountAll } from '../../support/mount-console'

afterEach(unmountAll)

/** A console bound to a fake CLI, with a hand-moved clock. */
const bound = () => {
  const listeners = new Set<(raw: unknown) => void>()
  const clock = { now: Date.UTC(2026, 10, 7, 9, 30) }
  const gate: ConsoleGate = {
    tab: 't1',
    send: () => Promise.resolve(),
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    schedule: () => () => {}
  }
  const run = vi.fn(() => ({ summary: 'stopped' }))
  const console = createConsole({
    features: consoleFeatures({
      recallFeature,
      completionFeature,
      contextFeature
    }),
    gate,
    now: () => clock.now,
    commands: [
      {
        name: 'tasks.stop',
        run,
        input: {
          type: 'object',
          properties: { id: { type: 'integer' }, yes: { type: 'boolean' } },
          required: ['id']
        },
        danger: 'change',
        confirm: { field: 'yes' },
        plan: input => ({
          targets: [JSON.stringify(input.id)],
          preview: '1 task stops'
        })
      }
    ]
  })
  const replies: CliReply[] = []
  const binding: RemoteBinding = {
    bindingId: 'b1',
    grantId: 'g1',
    approvedAt: Date.UTC(2026, 10, 7, 9, 0),
    send: reply => {
      replies.push(reply)
    },
    publishCapabilities: () => undefined
  }
  const request = (id: string, line: string) => {
    for (const listener of [...listeners]) {
      listener({
        v: 1,
        kind: 'cli-request',
        id,
        line,
        origin: { kind: 'cli', grantId: 'g1', bindingId: 'b1' },
        stampedAt: clock.now,
        expiresAt: clock.now + 30_000
      })
    }
  }
  return { console, binding, clock, replies, request, run }
}

describe('C-102 CLI marker (Vue)', () => {
  it('a line from the CLI is marked CLI before its prompt', () => {
    const line: InputEntry = {
      id: 'a',
      kind: 'input',
      prompt: '>',
      text: 'tasks.list',
      redacted: false,
      status: 'submitted',
      actor: 'cli'
    }
    const view = mountConsole({ model: { entries: [line] } })
    const entry = view.root.querySelector('.cc-entry')!
    expect(entry.getAttribute('data-actor')).toBe('cli')
    expect(entry.textContent).toBe('CLI>tasks.list')
  })

  it('shows the bound CLI and asks the consumer to disconnect it', async () => {
    const t = bound()
    const view = mountConsole({
      props: { console: t.console, commands: undefined }
    })
    expect(view.root.querySelector('.cc-remote')).toBeNull()
    t.console.attachRemote(t.binding)
    await nextTick()
    const remote = view.root.querySelector('.cc-remote')!
    expect(remote.querySelector('.cc-remote-text')?.textContent).toBe(
      'A CLI is connected to this tab. Connection approved at 2026-11-07T09:00:00.000Z.'
    )
    const button = remote.querySelector<HTMLButtonElement>('.cc-remote-detach')!
    expect(button.type).toBe('button')
    button.click()
    expect(view.emitted('detach-remote')).toHaveLength(1)
    t.console.detachRemote()
    await nextTick()
    expect(view.root.querySelector('.cc-remote')).toBeNull()
  })
})

describe('C-103 Approval window (Vue)', () => {
  it('shows the plan, from the CLI, the binding time and no computer name', async () => {
    const t = bound()
    const view = mountConsole({
      props: {
        console: t.console,
        commands: undefined,
        labels: { formatTime: time => `@${time}` }
      }
    })
    t.console.attachRemote(t.binding)
    t.request('r1', 'tasks.stop --id 8812 --yes')
    await nextTick()
    const dialog = view.root.querySelector('.cc-approval')!
    expect(dialog.getAttribute('role')).toBe('alertdialog')
    expect(dialog.getAttribute('aria-label')).toBe(
      'Approve a change from the CLI'
    )
    expect(dialog.querySelector('.cc-approval-source')?.textContent).toBe(
      `From the CLI. Connection approved at @${t.binding.approvedAt}.`
    )
    expect(dialog.querySelector('.cc-approval-preview')?.textContent).toBe(
      '1 task stops'
    )
    expect(dialog.querySelector('.cc-approval-targets')?.textContent).toBe(
      'Targets: 8812.'
    )
  })

  it('Approve runs the plan only after the first second; Reject ends it', async () => {
    const t = bound()
    const view = mountConsole({
      props: { console: t.console, commands: undefined }
    })
    t.console.attachRemote(t.binding)
    t.request('r1', 'tasks.stop --id 8812 --yes')
    await nextTick()
    const approve = () =>
      view.root.querySelector<HTMLButtonElement>('.cc-approve')!.click()
    approve()
    expect(t.run).not.toHaveBeenCalled()
    t.clock.now += 1000
    approve()
    expect(t.run).toHaveBeenCalledTimes(1)
    await nextTick()
    expect(view.root.querySelector('.cc-approval')).toBeNull()

    t.request('r2', 'tasks.stop --id 1 --yes')
    await nextTick()
    view.root.querySelector<HTMLButtonElement>('.cc-reject')!.click()
    await nextTick()
    expect(view.root.querySelector('.cc-approval')).toBeNull()
    expect(t.run).toHaveBeenCalledTimes(1)
    const last = t.replies.at(-1)
    expect(last?.kind === 'finished' && last.outcome).toMatchObject({
      code: 'not-allowed'
    })
  })

  it('a preview shows its canonical line when the plan has no preview', async () => {
    const t = bound()
    t.console.setOptions(options => ({
      ...options,
      commands: options.commands.map(command => ({
        ...command,
        plan: undefined
      }))
    }))
    const view = mountConsole({
      props: { console: t.console, commands: undefined }
    })
    t.console.attachRemote(t.binding)
    t.request('r1', 'tasks.stop --id 3 --yes')
    await nextTick()
    expect(view.root.querySelector('.cc-approval-preview')?.textContent).toBe(
      'tasks.stop --id 3 --yes'
    )
    expect(view.root.querySelector('.cc-approval-targets')).toBeNull()
  })
})

describe('C-104 Pairing question (Vue)', () => {
  it('asks with the server facts only and answers with the pair event', async () => {
    const view = mountConsole({
      props: {
        pairing: {
          createdAt: Date.UTC(2026, 10, 7, 8, 0),
          environment: 'develop'
        }
      }
    })
    const pairing = view.root.querySelector('.cc-pairing')!
    expect(pairing.getAttribute('role')).toBe('alertdialog')
    expect(pairing.querySelector('.cc-pairing-text')?.textContent).toBe(
      'Connect this tab to the CLI? CLI access created at 2026-11-07T08:00:00.000Z for develop.'
    )
    pairing.querySelector<HTMLButtonElement>('.cc-pair-accept')!.click()
    pairing.querySelector<HTMLButtonElement>('.cc-pair-decline')!.click()
    expect(view.emitted('pair')).toEqual([[true], [false]])
    await view.wrapper.setProps({ pairing: null })
    expect(view.root.querySelector('.cc-pairing')).toBeNull()
  })

  it('a click on a button does not move the focus to the input', () => {
    const view = mountConsole({
      props: { pairing: { createdAt: 0, environment: 'develop' } }
    })
    const button =
      view.root.querySelector<HTMLButtonElement>('.cc-pair-accept')!
    button.focus()
    button.click()
    expect(document.activeElement).toBe(button)
  })
})

describe('C-119 CLI row (Vue)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const now = Date.UTC(2026, 10, 10, 12, 0)

  it('offers the level choice and Connect CLI only with attachable and no binding', async () => {
    const t = bound()
    const view = mountConsole({
      props: { console: t.console, commands: undefined }
    })
    expect(view.root.querySelector('.cc-attach')).toBeNull()
    await view.wrapper.setProps({ attachable: true })
    const row = view.root.querySelector('.cc-attach')!
    expect(row.querySelector('.cc-attach-legend')?.textContent).toBe(
      'When the CLI makes a change'
    )
    const radios = [
      ...row.querySelectorAll<HTMLInputElement>('.cc-attach-radio')
    ]
    expect(
      radios.map(radio => [radio.type, radio.value, radio.checked])
    ).toEqual([
      ['radio', 'ask-server', false],
      ['radio', 'never-ask', true]
    ])
    expect(radios[0].name).not.toBe('')
    expect(radios[0].name).toBe(radios[1].name)
    const levels = [...row.querySelectorAll('.cc-attach-level')]
    expect(levels.map(level => level.textContent)).toEqual([
      'Ask before changes on the server',
      'Never ask An agent in the terminal can then make changes for you without asking.'
    ])
    expect(row.querySelector('.cc-attach-code')).toBeNull()
    t.console.attachRemote(t.binding)
    await nextTick()
    expect(view.root.querySelector('.cc-attach')).toBeNull()
    expect(view.root.querySelector('.cc-remote')).not.toBeNull()
  })

  it('Connect CLI emits attach-remote with the chosen level', async () => {
    const view = mountConsole({ props: { attachable: true } })
    const start = () =>
      view.root.querySelector<HTMLButtonElement>('.cc-attach-start')!.click()
    expect(view.root.querySelector('.cc-attach-start')?.textContent).toBe(
      'Connect CLI'
    )
    start()
    const ask =
      view.root.querySelectorAll<HTMLInputElement>('.cc-attach-radio')[0]
    ask.click()
    await nextTick()
    start()
    expect(view.emitted('attach-remote')).toEqual([
      ['never-ask'],
      ['ask-server']
    ])
    expect(
      view.root.querySelectorAll<HTMLInputElement>('.cc-attach-radio')[0]
        .checked
    ).toBe(true)
  })

  it('chooses never-ask again each time the row shows again', async () => {
    const t = bound()
    const view = mountConsole({
      props: { console: t.console, commands: undefined, attachable: true }
    })
    const radios = () => [
      ...view.root.querySelectorAll<HTMLInputElement>('.cc-attach-radio')
    ]
    const chooseAskServer = async () => {
      radios()[0].click()
      await nextTick()
      expect(radios().map(radio => radio.checked)).toEqual([true, false])
    }
    await chooseAskServer()
    t.console.attachRemote({ ...t.binding, level: 'ask-server' })
    await nextTick()
    expect(view.root.querySelector('.cc-attach')).toBeNull()
    t.console.detachRemote()
    await nextTick()
    expect(radios().map(radio => radio.checked)).toEqual([false, true])

    await chooseAskServer()
    await view.wrapper.setProps({ attachable: false })
    await view.wrapper.setProps({ attachable: true })
    expect(radios().map(radio => radio.checked)).toEqual([false, true])
    view.root.querySelector<HTMLButtonElement>('.cc-attach-start')!.click()
    expect(view.emitted('attach-remote')).toEqual([['never-ask']])
  })

  it('shows the line with the warning and counts its time down', async () => {
    vi.useFakeTimers({ now })
    const view = mountConsole({
      props: {
        attachable: true,
        attachCode: { code: 'gk1_abc', expiresAt: now + 120_000 }
      }
    })
    const panel = view.root.querySelector('.cc-attach-code')!
    expect(panel.getAttribute('role')).toBe('group')
    expect(panel.getAttribute('aria-label')).toBe('Line to connect the CLI')
    expect(panel.querySelector('.cc-attach-line')?.textContent).toBe(
      'gecko attach gk1_abc'
    )
    expect(panel.querySelector('.cc-attach-warning')?.textContent).toBe(
      'This line gives access to your session; do not share it.'
    )
    const expires = () =>
      view.root.querySelector('.cc-attach-expires')?.textContent
    expect(expires()).toBe('Valid for 2:00.')
    expect(view.root.querySelector('.cc-attach-start')?.textContent).toBe(
      'New line'
    )
    vi.advanceTimersByTime(61_000)
    await nextTick()
    expect(expires()).toBe('Valid for 0:59.')
    expect(panel.hasAttribute('data-expired')).toBe(false)
    vi.advanceTimersByTime(59_000)
    await nextTick()
    expect(expires()).toBe('This line expired; ask for a new one.')
    expect(
      view.root.querySelector('.cc-attach-code')?.hasAttribute('data-expired')
    ).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('takes every text from labels', () => {
    const view = mountConsole({
      props: {
        attachable: true,
        attachCode: { code: 'gk1_x', expiresAt: Date.now() + 5000 },
        labels: {
          remote: {
            attachLine: code => `cli connect ${code}`,
            expiresIn: seconds => `${seconds} s`,
            levelNeverAsk: 'Hiç sorma',
            neverAskWarning: 'Uyarı.'
          }
        }
      }
    })
    expect(view.root.querySelector('.cc-attach-line')?.textContent).toBe(
      'cli connect gk1_x'
    )
    expect(view.root.querySelector('.cc-attach-expires')?.textContent).toMatch(
      /^\d s$/
    )
    expect(view.root.querySelectorAll('.cc-attach-level')[1].textContent).toBe(
      'Hiç sorma Uyarı.'
    )
  })

  it('Copy writes the line to the clipboard, and selects it when the clipboard refuses', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const view = mountConsole({
      props: {
        attachable: true,
        attachCode: { code: 'gk1_abc', expiresAt: Date.now() + 60_000 }
      }
    })
    const copy = () =>
      view.root.querySelector<HTMLButtonElement>('.cc-attach-copy')!
    expect(copy().textContent).toBe('Copy')
    copy().click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('gecko attach gk1_abc')
    expect(copy().textContent).toBe('Copied')
    // A new line resets the button.
    await view.wrapper.setProps({
      attachCode: { code: 'gk1_def', expiresAt: Date.now() + 60_000 }
    })
    expect(copy().textContent).toBe('Copy')

    writeText.mockImplementation(() => Promise.reject(new Error('denied')))
    copy().click()
    await flushPromises()
    expect(copy().textContent).toBe('Copy')
    expect(document.getSelection()?.toString()).toBe('gecko attach gk1_def')
    document.getSelection()?.removeAllRanges()
  })

  it('a click on its controls does not move the focus to the input', () => {
    const view = mountConsole({ props: { attachable: true } })
    const label =
      view.root.querySelectorAll<HTMLLabelElement>('.cc-attach-level')[1]
    label.click()
    expect(document.activeElement).not.toBe(view.input())
    const start =
      view.root.querySelector<HTMLButtonElement>('.cc-attach-start')!
    start.focus()
    start.click()
    expect(document.activeElement).toBe(start)
  })

  it('the bound row shows the level the shell gave', async () => {
    const t = bound()
    const view = mountConsole({
      props: { console: t.console, commands: undefined }
    })
    t.console.attachRemote({ ...t.binding, level: 'never-ask' })
    await nextTick()
    const level = () =>
      view.root.querySelector('.cc-remote .cc-remote-level')?.textContent
    expect(level()).toBe('Never ask')
    t.console.setRemoteLevel('ask-server')
    await nextTick()
    expect(level()).toBe('Ask before changes on the server')
  })
})

const flushPromises = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}
