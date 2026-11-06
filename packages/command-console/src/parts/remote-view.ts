// The remote entry (ADR 0014): the bound CLI with its "Disconnect" button
// (C-102), the approval window of a change from the CLI (C-103) and the
// pairing question (C-104). Plain elements; the consumer's CSS places them.
import { h, type VNode } from 'vue'

import type { RemoteState } from '@dolusoft/command-console-core'

import type { ConsoleLabels, PairingRequest } from '../contract'

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
    button('cc-remote-detach', labels.remote.detach, onDetach)
  ])

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
