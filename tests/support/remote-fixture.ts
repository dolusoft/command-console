// A console bound to a fake CLI for the browser specs: every optional
// feature, a gate that only delivers, a fixed clock, and a change command
// with a plan, so the approval window can be opened on demand.
import {
  completionFeature,
  consoleFeatures,
  contextFeature,
  createConsole,
  recallFeature,
  type ConsoleGate
} from '@dolusoft/command-console-core'

export const boundConsole = () => {
  const listeners = new Set<(raw: unknown) => void>()
  const now = Date.UTC(2026, 10, 7, 9, 30)
  const gate: ConsoleGate = {
    tab: 't1',
    send: () => Promise.resolve(),
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    schedule: () => () => {}
  }
  const console = createConsole({
    features: consoleFeatures({
      recallFeature,
      completionFeature,
      contextFeature
    }),
    gate,
    now: () => now,
    commands: [
      {
        name: 'tasks.stop',
        run: () => ({ summary: 'stopped' }),
        input: {
          type: 'object',
          properties: { id: { type: 'integer' }, yes: { type: 'boolean' } },
          required: ['id']
        },
        danger: 'change',
        confirm: { field: 'yes' },
        plan: () => ({ targets: ['8812'], preview: '1 task stops' })
      }
    ]
  })
  console.attachRemote({
    bindingId: 'b1',
    grantId: 'g1',
    approvedAt: Date.UTC(2026, 10, 7, 9, 0),
    send: () => undefined
  })
  /** Opens the approval window of `tasks.stop --id 8812 --yes`. */
  const askApproval = () => {
    for (const listener of [...listeners]) {
      listener({
        v: 1,
        kind: 'cli-request',
        id: 'r1',
        line: 'tasks.stop --id 8812 --yes',
        origin: { kind: 'cli', grantId: 'g1', bindingId: 'b1' },
        stampedAt: now,
        expiresAt: now + 30_000
      })
    }
  }
  return { console, askApproval }
}
