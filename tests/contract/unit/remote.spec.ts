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
    }
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
