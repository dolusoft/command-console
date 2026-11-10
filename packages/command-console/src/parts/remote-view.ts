// The remote entry (ADR 0014): the bound CLI with its "Disconnect" button
// (C-102), the approval window of a change from the CLI (C-103), the
// pairing question (C-104) and the CLI row without a binding (C-119). Plain
// elements; the consumer's CSS places them.
import { h, type VNode } from 'vue'

import type { RemoteLevel, RemoteState } from '@dolusoft/command-console-core'

import type { AttachCode, ConsoleLabels, PairingRequest } from '../contract'

const button = (className: string, text: string, onClick: () => void): VNode =>
  h(
    'button',
    {
      class: className,
      type: 'button',
      onClick: (event: MouseEvent) => {
        // The root's click would move the focus to the input (C-51).
        event.stopPropagation()
        onClick()
      }
    },
    text
  )

/** `div.cc-remote` while a CLI is bound. */
export const renderRemote = (
  remote: RemoteState,
  labels: ConsoleLabels,
  onDetach: () => void
): VNode =>
  h('div', { class: 'cc-remote' }, [
    h('span', { class: 'cc-remote-text' }, [
      labels.remote.connected,
      ' ',
      labels.remote.approvedAt(labels.formatTime(remote.approvedAt))
    ]),
    h('span', { class: 'cc-remote-level' }, levelText(remote.level, labels)),
    button('cc-remote-detach', labels.remote.detach, onDetach)
  ])

const levelText = (level: RemoteLevel, labels: ConsoleLabels): string =>
  level === 'never-ask'
    ? labels.remote.levelNeverAsk
    : labels.remote.levelAskServer

/** What the CLI row without a binding draws (C-119). */
export interface AttachView {
  /** The name the radio buttons share, unique per console. */
  group: string
  /** The level chosen now. */
  level: RemoteLevel
  /** The line the shell gave, if any. */
  code: AttachCode | null
  /** The page's clock, in ms since the epoch. */
  now: number
  /** Whether the line was copied. */
  copied: boolean
}

/** What the CLI row without a binding does (C-119). */
export interface AttachActions {
  choose(level: RemoteLevel): void
  start(): void
  copy(line: string, element: Element | null): void
}

const levels: readonly RemoteLevel[] = ['ask-server', 'never-ask']

/**
 * `div.cc-attach` while the user may connect a CLI and none is bound: the
 * level choice, "Connect CLI", and the line once the shell gave one.
 */
export const renderAttach = (
  view: AttachView,
  labels: ConsoleLabels,
  actions: AttachActions
): VNode => {
  const { remote } = labels
  const choice = h('fieldset', { class: 'cc-attach-levels' }, [
    h('legend', { class: 'cc-attach-legend' }, remote.levelLegend),
    ...levels.map(level =>
      h('label', { class: 'cc-attach-level' }, [
        h('input', {
          class: 'cc-attach-radio',
          type: 'radio',
          name: view.group,
          value: level,
          checked: view.level === level,
          onChange: () => actions.choose(level)
        }),
        levelText(level, labels),
        level === 'never-ask'
          ? h('span', { class: 'cc-attach-hint' }, [
              ' ',
              remote.neverAskWarning
            ])
          : null
      ])
    )
  ])
  return h('div', { class: 'cc-attach' }, [
    choice,
    button(
      'cc-attach-start',
      view.code ? remote.attachAgain : remote.attach,
      () => actions.start()
    ),
    view.code ? renderCode(view, view.code, labels, actions) : null
  ])
}

/** `div.cc-attach-code`: the line, its copy button, the warning, the time. */
const renderCode = (
  view: AttachView,
  code: AttachCode,
  labels: ConsoleLabels,
  actions: AttachActions
): VNode => {
  const { remote } = labels
  const line = remote.attachLine(code.code)
  const left = Math.max(0, Math.ceil((code.expiresAt - view.now) / 1000))
  return h(
    'div',
    {
      class: 'cc-attach-code',
      role: 'group',
      'aria-label': remote.attachCode,
      'data-expired': left === 0 ? '' : undefined
    },
    [
      h('code', { class: 'cc-attach-line' }, line),
      h(
        'button',
        {
          class: 'cc-attach-copy',
          type: 'button',
          onClick: (event: MouseEvent) => {
            // The root's click would move the focus to the input (C-51).
            event.stopPropagation()
            const panel = (event.currentTarget as Element).parentElement
            actions.copy(line, panel?.querySelector('.cc-attach-line') ?? null)
          }
        },
        view.copied ? remote.copied : remote.copy
      ),
      h('span', { class: 'cc-attach-warning' }, remote.attachWarning),
      h(
        'span',
        { class: 'cc-attach-expires' },
        left === 0 ? remote.expired : remote.expiresIn(left)
      )
    ]
  )
}

/** `div.cc-approval` while a change from the CLI waits for the user. */
export const renderApproval = (
  remote: RemoteState,
  labels: ConsoleLabels,
  answer: (requestId: string, approved: boolean) => void
): VNode | null => {
  const plan = remote.approval
  if (!plan) {
    return null
  }
  return h(
    'div',
    {
      class: 'cc-approval',
      role: 'alertdialog',
      'aria-label': labels.remote.approval
    },
    [
      h('span', { class: 'cc-approval-source' }, [
        labels.remote.fromCli,
        ' ',
        labels.remote.approvedAt(labels.formatTime(remote.approvedAt))
      ]),
      h('span', { class: 'cc-approval-preview' }, plan.preview ?? plan.line),
      plan.targets.length > 0
        ? h(
            'span',
            { class: 'cc-approval-targets' },
            labels.remote.targets(plan.targets)
          )
        : null,
      button('cc-approve', labels.remote.approve, () =>
        answer(plan.requestId, true)
      ),
      button('cc-reject', labels.remote.reject, () =>
        answer(plan.requestId, false)
      )
    ]
  )
}

/** `div.cc-pairing` while the consumer asks for a pairing. */
export const renderPairing = (
  pairing: PairingRequest,
  labels: ConsoleLabels,
  answer: (accepted: boolean) => void
): VNode =>
  h(
    'div',
    {
      class: 'cc-pairing',
      role: 'alertdialog',
      'aria-label': labels.remote.pairing
    },
    [
      h('span', { class: 'cc-pairing-text' }, [
        labels.remote.pairing,
        ' ',
        labels.remote.pairingDetails(
          labels.formatTime(pairing.createdAt),
          pairing.environment
        )
      ]),
      button('cc-pair-accept', labels.remote.pairAccept, () => answer(true)),
      button('cc-pair-decline', labels.remote.pairDecline, () => answer(false))
    ]
  )
