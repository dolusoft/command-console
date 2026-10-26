// C-36, the Vue half of the leak matrix: every path of the core matrix runs
// on a console mounted in `<CommandConsole>`, and after it the secret is
// absent from the DOM text, every attribute value, the input element (the
// one that held the line included), the accessibility tree and every event
// the component emitted. The probe's own checks (callbacks, state) still run.
import { afterEach, describe, expect, test } from 'vitest'
import { commands, userEvent } from 'vitest/browser'

import type { ConsoleEntry, ContextFrame } from '@dolusoft/command-console'

import { completionLeakPaths } from '../../../packages/command-console-core/tests/support/completion-leak-paths'
import { contextLeakPaths } from '../../../packages/command-console-core/tests/support/context-leak-paths'
import {
  coreLeakPaths,
  leakSecret,
  runLeakPath,
  type LeakConsole,
  type LeakOptions,
  type LeakPath,
  type Probe
} from '../../../packages/command-console-core/tests/support/leak-matrix'
import { recallLeakPaths } from '../../../packages/command-console-core/tests/support/recall-leak-paths'
import { settle } from '../../support/console-fixture'
import {
  mountConsole,
  unmountAll,
  type Mounted,
  type MountOptions
} from '../../support/mount-console'

afterEach(unmountAll)

let current: Mounted | null = null

/**
 * The matrix factory: the probed options become the component's props; the
 * controlled entries are bound like `v-model`, and each report also reaches
 * the probed `onEntriesChange`.
 */
const mountFromOptions = (options: LeakOptions): LeakConsole => {
  const { onEntriesChange, onRecallChange, onContextChange, onClose } = options
  const state = options.state ?? {}
  const model: MountOptions['model'] = {}
  if (state.entries) {
    model.entries = state.entries
  }
  if (state.recall) {
    model.recall = state.recall
  }
  if (state.context) {
    model.context = state.context
  }
  current = mountConsole({
    commands: options.commands,
    model,
    props: {
      initialState: options.initialState,
      beforeRun: options.beforeRun,
      formatError: options.formatError,
      isSensitive: options.isSensitive,
      shouldRecord: options.shouldRecord,
      recallLimit: options.recallLimit,
      onError: options.onError,
      createId: options.createId
    },
    on: {
      'update:entries': value => onEntriesChange?.(value as ConsoleEntry[]),
      'update:recall': value => onRecallChange?.(value as string[]),
      'update:context': value => onContextChange?.(value as ContextFrame[]),
      close: () => onClose?.()
    }
  })
  return current.api.console
}

/** Scans what the browser shows and what the component emitted. */
const scanView = async (view: Mounted, probe: Probe, where: string) => {
  await settle()
  probe.scan(view.root.textContent, `${where}:dom.text`)
  for (const element of [view.root, ...view.root.querySelectorAll('*')]) {
    for (const name of element.getAttributeNames()) {
      probe.scan(element.getAttribute(name), `${where}:dom[${name}]`)
    }
  }
  probe.scan(view.input().value, `${where}:input.value`)
  probe.scan(
    await commands.ariaSnapshot('.cc-console'),
    `${where}:accessibility tree`
  )
  for (const name of [
    'update:entries',
    'update:recall',
    'update:context',
    'submit',
    'close'
  ]) {
    probe.scan(view.emitted(name), `${where}:emit ${name}`)
  }
}

/** A core path, followed by the scan of the mounted view. */
const vuePath = (path: LeakPath): LeakPath => ({
  ...path,
  drive: async context => {
    await path.drive(context)
    // After `dispose` the component is still mounted and shows the
    // cleared state.
    await scanView(current!, context.probe, path.name)
  }
})

/** Paths only a component has: the line typed into the real input. */
const typedPaths: LeakPath[] = [
  {
    name: 'typed and submitted with Enter',
    drive: async ({ probe, secret }) => {
      const view = current!
      const held = view.input()
      await userEvent.click(held)
      await userEvent.keyboard(`login admin ${secret}`)
      await userEvent.keyboard('{Enter}')
      await settle()
      expect(view.input()).not.toBe(held)
      probe.scan(held.value, 'typed:old input.value')
      await scanView(view, probe, 'typed')
    }
  },
  {
    name: 'typed and cancelled with Ctrl+C',
    drive: async ({ probe, secret }) => {
      const view = current!
      const held = view.input()
      await userEvent.click(held)
      await userEvent.keyboard(`set password ${secret}`)
      await userEvent.keyboard('{Control>}c{/Control}')
      await settle()
      probe.scan(held.value, 'typed cancel:old input.value')
      await scanView(view, probe, 'typed cancel')
    }
  },
  {
    name: 'typed while a sensitive command runs, then interrupted',
    drive: async ({ probe, secret, slow }) => {
      const view = current!
      await userEvent.click(view.input())
      await userEvent.keyboard(`slow ${secret}`)
      await userEvent.keyboard('{Enter}')
      await settle()
      await scanView(view, probe, 'running')
      await userEvent.keyboard('{Control>}c{/Control}')
      slow.resolve('late')
      await scanView(view, probe, 'interrupted')
    }
  }
]

describe('C-36 leak matrix (Vue)', () => {
  const paths = [
    ...[
      ...coreLeakPaths,
      ...recallLeakPaths,
      ...completionLeakPaths,
      ...contextLeakPaths
    ].map(vuePath),
    ...typedPaths
  ]
  test.each(paths.map(path => [path.name, path] as const))(
    'C-36 %s leaves no trace in the DOM, the input or the accessibility tree',
    async (_name, path) => {
      expect(await runLeakPath(path, mountFromOptions)).toEqual([])
    }
  )

  test('C-36 the scan finds a secret that is shown', async () => {
    // The harness itself: a line that is not sensitive is shown, and found.
    const path: LeakPath = {
      name: 'not sensitive',
      drive: async ({ console, secret, probe }) => {
        await console.run(`echo ${secret}`)
        await scanView(current!, probe, 'shown')
      }
    }
    const found = await runLeakPath(path, mountFromOptions)
    expect(
      found.some(finding => finding.where.startsWith('shown:dom.text'))
    ).toBe(true)
    expect(
      found.some(finding =>
        finding.where.startsWith('shown:accessibility tree')
      )
    ).toBe(true)
    expect(leakSecret).not.toBe('')
  })
})
