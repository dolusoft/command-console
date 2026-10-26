// Mounts `<CommandConsole>` for the Vue specs, attached to the document so
// focus, selection and layout are real in the browser project. A bound
// slice (`model`) behaves as `v-model`: every `update:*` is written back as
// the parent would, through `setProps`.
import { mount, type VueWrapper } from '@vue/test-utils'

import {
  CommandConsole,
  type CommandDefinition,
  type ConsoleEntry,
  type ConsoleExpose,
  type ConsoleProps,
  type ContextFrame
} from '@dolusoft/command-console'

import { makeCommands } from './console-fixture'

type Slice = 'entries' | 'recall' | 'context'

export interface MountOptions {
  props?: Partial<ConsoleProps>
  commands?: CommandDefinition[]
  /** Slices bound like `v-model:<slice>`, with their first value. */
  model?: {
    entries?: ConsoleEntry[]
    recall?: string[]
    context?: ContextFrame[]
  }
  /** Slot functions by name; typed loosely, the specs pass their props. */
  slots?: Record<string, (props: never) => unknown>
  /** Event listeners (`update:entries`, `close`…), called after `model`. */
  on?: Record<string, (...args: unknown[]) => void>
}

export interface Mounted {
  wrapper: VueWrapper
  /** The exposed API. */
  api: ConsoleExpose
  slow: ReturnType<typeof makeCommands>['slow']
  root: HTMLElement
  /** The input element now (it is replaced, C-54). */
  input(): HTMLInputElement
  log(): HTMLElement
  status(): HTMLElement
  /** Every value emitted per event name. */
  emitted(name: string): unknown[][]
  unmount(): void
}

const mounted = new Set<VueWrapper>()

/** Unmounts every console a spec mounted (call in `afterEach`). */
export const unmountAll = () => {
  for (const wrapper of mounted) {
    wrapper.unmount()
  }
  mounted.clear()
  document.body.innerHTML = ''
}

export const mountConsole = (options: MountOptions = {}): Mounted => {
  const fixture = makeCommands()
  const host = document.createElement('div')
  document.body.append(host)
  const props: Record<string, unknown> = {
    commands: options.commands ?? fixture.commands,
    ...options.props
  }
  for (const [name, listener] of Object.entries(options.on ?? {})) {
    props[`on${name[0].toUpperCase()}${name.slice(1)}`] = listener
  }
  for (const slice of Object.keys(options.model ?? {}) as Slice[]) {
    props[slice] = options.model![slice]
    const listener = options.on?.[`update:${slice}`]
    props[`onUpdate:${slice}`] = (value: unknown) => {
      void wrapper.setProps({ [slice]: value })
      listener?.(value)
    }
  }
  const wrapper: VueWrapper = mount(CommandConsole as never, {
    props: props as never,
    slots: options.slots as never,
    attachTo: host
  })
  mounted.add(wrapper)
  const root = wrapper.element as HTMLElement
  const one = <E extends Element>(selector: string) =>
    root.querySelector<E>(selector)!
  return {
    wrapper,
    api: wrapper.vm as unknown as ConsoleExpose,
    slow: fixture.slow,
    root,
    input: () => one<HTMLInputElement>('.cc-input'),
    log: () => one<HTMLElement>('.cc-log'),
    status: () => one<HTMLElement>('.cc-status'),
    emitted: name => wrapper.emitted(name) ?? [],
    unmount: () => {
      mounted.delete(wrapper)
      wrapper.unmount()
    }
  }
}
